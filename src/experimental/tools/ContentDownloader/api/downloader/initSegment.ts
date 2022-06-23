/**
 * Copyright 2019 CANAL+ Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { IDBPDatabase } from "idb";
import { EMPTY, from, merge, of, Subject, throwError } from "rxjs";
import {
  bufferCount,
  catchError,
  distinctUntilChanged,
  filter,
  map,
  mapTo,
  mergeMap,
  reduce,
  retry,
  timeout,
} from "rxjs/operators";

import { ContentDecryptorState, IProtectionData } from "../../../../../core/decrypt";
import SegmentPipelineCreator from "../../../../../core/fetchers/segment/segment_fetcher_creator";
import { IInitSettings } from "../../types";
import { IOfflineDBSchema } from "../db/dbSetUp";
import ContentDecryptorTransaction from "../drm/keySystems";
import DownloadTracksPicker from "../tracksPicker/DownloadTracksPicker";
import { ContentType } from "../tracksPicker/types";
import { manifestLoader } from "./manifest";
import { handleSegmentPipelineFromContexts } from "./segment";
import { IInitGroupedSegments, IInitSegment } from "./types";

/**
 * This function take care of downloading the init segment for VIDEO/AUDIO/TEXT
 * buffer type.
 * Then, he also find out the nextSegments we have to download.
 *
 * @param {IInitSettings} initSettings Arguments we need to start the download.
 * @param {IDBPDatabase} db The current opened IndexedDB instance
 * @returns {Observable<IInitGroupedSegments>} An observable containing
 * Initialization segments downloaded and next segments to download
 *
 */
export function initDownloader$(initSettings: IInitSettings, db: IDBPDatabase<IOfflineDBSchema>) {
  const { contentID, url, transport, keySystems, filters } = initSettings;
  return manifestLoader(url, transport).pipe(
    mergeMap(({ manifest, transportPipelines }) => {
      const segmentPipelineCreator = new SegmentPipelineCreator(
        transportPipelines,
        {
          lowLatencyMode: false,
          maxRetryRegular: 5,
          maxRetryOffline: 5,
        }
      );
      const contentProtection$ = new Subject<IProtectionData>();
      const contentManager = new DownloadTracksPicker({
        manifest,
        filters,
      });
      return of(contentManager.getContextsForCurrentSession()).pipe(
        mergeMap(globalCtx => {
          const { video, audio, text } = contentManager.getContextsFormatted(
            globalCtx
          );
          return merge(
            keySystems !== undefined && Object.keys(keySystems).length > 0
            ? ContentDecryptorTransaction(keySystems, { contentID, contentProtection$, db }).pipe(
              filter((state) => state === ContentDecryptorState.ReadyForContent),
              distinctUntilChanged(),
              bufferCount(2),
              timeout(2000),
              catchError((err) => {
                if (err instanceof Error && err.name !== "TimeoutError") {
                  return throwError(err);
                }
                return of("handShakesEMEDone");
              }),
              // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
              mapTo({ type: "eme"  } as const))
            : EMPTY,
            handleSegmentPipelineFromContexts(video, ContentType.VIDEO, {
              segmentPipelineCreator,
              isInitData: true,
              type: "start",
            }),
            handleSegmentPipelineFromContexts(audio, ContentType.AUDIO, {
              segmentPipelineCreator,
              isInitData: true,
              type: "start",
            }),
            handleSegmentPipelineFromContexts(text, ContentType.TEXT, {
              segmentPipelineCreator,
              isInitData: true,
              type: "start",
            })
          );
        }),
        catchError((err) => {
          if (err instanceof Error) {
            initSettings.onError?.(err);
          }
          return EMPTY;
        }),
        mergeMap((initSegment) => {
          if (initSegment.type === "eme") {
            return EMPTY;
          }
          const initSegmentCustomSegment = initSegment;

          const protectionData = initSegmentCustomSegment.chunkData.contentProtections;

          if (protectionData !== undefined) {
            protectionData.initData.forEach(d =>  contentProtection$.next(d));

          }
          const { ctx, chunkData } = initSegmentCustomSegment;
          const { id: representationID } = ctx.representation;
          return from(
            db.put("segments", {
              contentID,
              segmentKey: `init--${representationID}--${contentID}`,
              data: chunkData.data,
              size: chunkData.data.byteLength,
            })
          ).pipe(
            retry(3),
            map(() => initSegmentCustomSegment)
          );
        }),
        map(({ ctx, contentType, chunkData }) => {
          const durationForCurrentPeriod = ctx.period.duration;
          const nextSegments = ctx.representation.index.getSegments(
            0,
            durationForCurrentPeriod !== undefined
              ? durationForCurrentPeriod
              : Number.MAX_VALUE
          );
          return {
            nextSegments,
            ctx,
            segmentPipelineCreator,
            contentType,
            chunkData,
          };
        })
      );
    }),
    reduce<IInitSegment, IInitGroupedSegments>(
      (
        acc,
        {
          nextSegments,
          ctx: { period, adaptation, representation, manifest },
          contentType,
          segmentPipelineCreator,
          chunkData,
        }
      ) => {
        acc.progress.totalSegments += nextSegments.length;
        acc[contentType].push({
          nextSegments,
          period,
          adaptation,
          representation,
          id: representation.id ,
          chunkData,
        });
        return { ...acc, segmentPipelineCreator, manifest };
      },
      {
        progress: { percentage: 0, segmentsDownloaded: 0, totalSegments: 0 },
        video: [],
        audio: [],
        text: [],
        segmentPipelineCreator: null,
        manifest: null,
        type: "start",
      }
    )
  );
}
