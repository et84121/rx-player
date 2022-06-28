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

import { EMPTY, merge, Observable, of } from "rxjs";
import { distinct, map, mergeMap, reduce, scan, takeUntil, tap } from "rxjs/operators";

import { createBox } from "../../../../../parsers/containers/isobmff";
import { ISegmentParser } from "../../../../../transports";

// generic segment parser response
// export type ISegmentParserResponse<T> =
//   ISegmentParserInitSegment<T> |
//   ISegmentParserSegment<T>;


// import find from "../../../../../utils/array_find";
import findIndex from "../../../../../utils/array_find_index";
import { concat } from "../../../../../utils/byte_parsing";

import { IndexedDBError } from "../../utils";
import { ContentType } from "../tracksPicker/types";
import {
  ContentBufferType,
  IAbstractContextCreation,
  IContext,
  IContextRicher,
  ICustomSegment,
  IGlobalContext,
  IInitGroupedSegments,
  IManifestDBState,
  ISegmentData,
  ISegmentPipelineContext,
  IUtils,
} from "./types";


/**
 * 已廢棄之函式，哪天要移除
 * 可以改用下列 fn 取代
 * https://developers.canal-plus.com/rx-player/doc/api/Tools/StringUtils.html
 *
 * Convert a simple string to an Uint8Array containing the corresponding
 * UTF-8 code units.
 * /!\ its implementation favors simplicity and performance over accuracy.
 * Each character having a code unit higher than 255 in UTF-16 will be
 * truncated (real value % 256).
 * Please take that into consideration when calling this function.
 * @deprecated
 * @param {string} str
 * @returns {Uint8Array}
 */
function strToBytes(str : string) : Uint8Array {
  const len = str.length;
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    arr[i] = str.charCodeAt(i) & 0xFF;
  }
  return arr;
}


/**
 * Download a segment associated with a context.
 *
 * @remarks
 * We are downloading the segment 3 by 3 for now.
 * It's something that will look soon.
 *
 * @param {IContext[]} ctxs An array of segments context to download.
 * > It's possibly a number, when the segment context has already been download
 * @param {KeyContextType} contentType Tell what type of buffer it is (VIDEO/AUDIO/TEXT).
 * @param {ISegmentPipelineContext} - Segment pipeline context, values that are redundant.
 * @returns {Observable<ICustomSegment>} - An observable of a downloaded segments context.
 *
 */
export function handleSegmentPipelineFromContexts<
  KeyContextType extends keyof Omit<IGlobalContext, "manifest">
>(
  ctxs: IContext[],
  contentType: KeyContextType,
  {
    segmentPipelineCreator,
    isInitData,
    nextSegments,
    progress,
    type,
  }: ISegmentPipelineContext
): Observable<ICustomSegment> {
  const segmentFetcherForCurrentContentType = segmentPipelineCreator.createSegmentFetcher(
    contentType,
    {}
  );
  return of(...ctxs).pipe(
    mergeMap(
      (ctx, index) => {
        if (Array.isArray(ctx.segment)) {
          return EMPTY;
        }
        return segmentFetcherForCurrentContentType.createRequest(ctx, 0).pipe(
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          mergeMap(evt => {
            switch (evt.type) {
              case "chunk":
                return of(evt.parse()) ;
              default:
                return EMPTY;
            }
          }),
          reduce<ReturnType<ISegmentParser<unknown, unknown>> , ISegmentData>(
            (acc, currSegparserResp) => {
              // For init segment...
              if (currSegparserResp.segmentType === "init") {
                const {
                  initializationData,
                  // protectionDataUpdate,
                } = currSegparserResp;
                const segmentProtections = ctx.representation.contentProtections;

                // give contentProtections default value
                if (
                  acc.contentProtections === undefined &&
                  segmentProtections !== undefined
                ) {
                  acc.contentProtections = {
                    keyIds: undefined,
                    initData: [],
                  };
                }
                if (currSegparserResp.initializationData === null) {
                  return acc;
                }
                if (
                  acc.contentProtections !== undefined &&
                  segmentProtections !== undefined
                ) {
                  return {
                    data: concat(acc.data, initializationData as Uint8Array),
                    contentProtections: segmentProtections
                    ,
                  };
                }
                return {
                  ...acc,
                  data: concat(acc.data, initializationData as Uint8Array),
                };
              }
              // For simple segment
              const { chunkData } = currSegparserResp;
              if (chunkData === null) {
                return acc;
              }

              // For Text segment
              if (
                contentType === ContentType.TEXT &&
                ctx.representation.mimeType !== undefined &&
                ctx.representation.mimeType === "application/mp4"
              ) {
                return {
                  data: concat(
                    acc.data,
                    createBox("moof", new Uint8Array(0)),
                    // May be chunkData.data for subtitles...
                    createBox("mdat", strToBytes(chunkData as string))
                  ),
                };
              }
              return {
                data: concat(acc.data, chunkData as Uint8Array),
              };
            },
            { data: new Uint8Array(0) }
          ),
          map(chunkData => {
            if (nextSegments !== undefined && !isInitData) {
              (nextSegments[index]) = ctx.segment;
            }
            return {
              chunkData,
              progress,
              type,
              contentType,
              ctx,
              index,
              isInitData,
              nextSegments,
              representationID: ctx.representation.id ,
            };
          })
        );
      },
      3 // TODO: See If we limit the number of concurrent request at the same time.
    )
  );
}

/**
 * An Util function that abstract a redundant operation that consist
 * to create the different context depending a segment.
 *
 * @param IContextRicher[] - Array of IContext with few field added to it.
 * @param KeyContextType - Tell what type of buffer it is (VIDEO/AUDIO/TEXT).
 * @param IAbstractContextCreation - Usefull arguments we need to build
 * the IContext array.
 * @returns ICustomSegment - An Object of the downloaded segment.
 *
 */
function handleAbstractSegmentPipelineContextFor(
  contextsRicher: IContextRicher[],
  contentType: ContentBufferType,
  { type, progress, segmentPipelineCreator, manifest }: IAbstractContextCreation
) {
  return of(...contextsRicher).pipe(
    mergeMap(contextRicher => {
      const { nextSegments, ...ctx } = contextRicher;
      return handleSegmentPipelineFromContexts(
        nextSegments.map(segment => ({ ...ctx, segment, manifest })),
        contentType,
        {
          type,
          progress,
          nextSegments,
          segmentPipelineCreator,
          isInitData: false,
        }
      );
    })
  );
}

/**
 * The top level function downloader that should start the pipeline of
 * download for each buffer type (VIDEO/AUDIO/TEXT).
 *
 * @remarks
 * - It also store each segment downloaded in IndexedDB.
 * - Add the segment in the ProgressBarBuilder.
 * - Emit a global progress when a segment has been downloaded.
 * - Eventually, wait an event of the pause$ Subject to put the download in pause.
 *
 * @param {Observable<IInitGroupedSegments>} builderObs$ - A Observable that carry
 * all the data we need to start the download.
 * @param {IManifestDBState} builderInit - The current builder state of the download.
 * @param {IUtils} - Usefull tools to store/emit/pause the current content of the download.
 * @returns {IManifestDBState} - The state of the Manifest at the X time in the download.
 *
 */
export function segmentPipelineDownloader$(
  builderObs$: Observable<IInitGroupedSegments>,
  builderInit: IManifestDBState,
  { contentID, pause$, db, onError }: IUtils
): Observable<IManifestDBState> {
  return builderObs$.pipe(
    mergeMap(
      ({
        video,
        audio,
        text,
        segmentPipelineCreator,
        manifest,
        progress,
        type,
      }) => {
        if (manifest == null || segmentPipelineCreator == null) {
          return EMPTY;
        }
        return merge(
          handleAbstractSegmentPipelineContextFor(video, ContentType.VIDEO, {
            type,
            progress,
            segmentPipelineCreator,
            manifest,
          }),
          handleAbstractSegmentPipelineContextFor(audio, ContentType.AUDIO, {
            type,
            progress,
            segmentPipelineCreator,
            manifest,
          }),
          handleAbstractSegmentPipelineContextFor(text, ContentType.TEXT, {
            type,
            progress,
            segmentPipelineCreator,
            manifest,
          })
        );
      }
    ),
    tap(
      ({
        chunkData,
        representationID,
        ctx: {
          segment: { time, timescale },
        },
        contentType,
      }) => {
        const timeScaled = (time / timescale);
        db.put("segments", {
          contentID,
          segmentKey: `${timeScaled}--${representationID}--${contentID}`,
          data: chunkData.data,
          size: chunkData.data.byteLength,
        }).catch((err: Error) => {
          onError?.(new IndexedDBError(`
            ${contentID}: Impossible
            to store the current segment (${contentType}) at ${timeScaled}: ${err.message}
          `));
        });
      }
    ),
    scan<ICustomSegment, IManifestDBState>(
      (
        acc,
        {
          progress,
          ctx,
          contentType,
          nextSegments,
          representationID,
          chunkData,
        }
      ) => {
        if (progress !== undefined) {
          acc.progress.totalSegments = progress.totalSegments;
        }
        acc.progress.segmentsDownloaded += 1;
        const percentage =
          (acc.progress.segmentsDownloaded / acc.progress.totalSegments) * 100;
        acc.progress.percentage = percentage > 98 && percentage < 100
        ? percentage
        : Math.round(percentage);
        acc.size += chunkData.data.byteLength;
        if (nextSegments === undefined) {
          return acc;
        }
        const indexRepresentation = findIndex(
          acc[contentType],
          ({ representation }) => representation.id === representationID
        );
        if (indexRepresentation === -1) {
          acc[contentType].push({
            chunkData,
            nextSegments,
            period: ctx.period,
            adaptation: ctx.adaptation,
            representation: ctx.representation,
            id: representationID,
          });
          return { ...acc, manifest: ctx.manifest };
        }
        acc[contentType][indexRepresentation] = {
          chunkData,
          nextSegments,
          period: ctx.period,
          adaptation: ctx.adaptation,
          representation: ctx.representation,
          id: representationID,
        };
        return { ...acc, manifest: ctx.manifest };
      },
      builderInit
    ),
    distinct(({ progress }) => progress.percentage),
    takeUntil(pause$)
  );
}
