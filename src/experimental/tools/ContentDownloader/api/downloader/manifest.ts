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

import { Observable } from "rxjs";
import { filter, map, mergeMap } from "rxjs/operators";

import { IPersistentSessionInfo } from "../../../../../core/decrypt";
import createManifestFetcher, {
  IManifestFetcherParsedResult,
  IManifestFetcherResponse,
} from "../../../../../core/fetchers/manifest/manifest_fetcher";
import features from "../../../../../features/";
import logger from "../../../../../log";
import Manifest from "../../../../../manifest";
import { takePSSHOut } from "../../../../../parsers/containers/isobmff";
import { ILocalManifest } from "../../../../../parsers/manifest/local";
import {
  IContentProtections,
  ILocalAdaptation,
  ILocalIndexSegment,
  ILocalPeriod,
  ILocalRepresentation,
} from "../../../../../parsers/manifest/local/types";
import { ITransportPipelines } from "../../../../../transports";
import { IStoredManifest } from "../../types";
import { SegmentConstuctionError } from "../../utils";
import { IStoredContentProtection } from "../drm/types";
import {
  ContentBufferType,
  IAdaptationForPeriod,
  ISegmentForRepresentation,
  ISegmentStored,
  IUtilsOfflineLoader,
} from "./types";

/**
 * Get the TransportPipeline for current transport.
 *
 * @param {smooth|dash} transport HTTP streaming transport protocol
 *  type for current download to use.
 * @returns {ITransportPipelines} A instance of TransportPipelines
 *  for the current download.
 *
 */
export function getTransportPipelineByTransport(transport: string) {
  const transportFn = features.transports[transport];
  if (typeof transportFn !== "function") {
    throw new Error(`transport "${transport}" not supported`);
  }
  return transportFn({
    lowLatencyMode: false,
  });
}

/**
 * Get the manifest from an url.
 *
 * @param {string} manifestURL - Manifest url.
 * @param {smooth|dash} transport HTTP streaming transport protocol type to use.
 * @returns {Observable<{Manifest, ITransportPipelines}>} An observable that contain
 *  instance of Manifest for the current url and the transportPipelines associated to it.
 *
 */
export function manifestLoader(
  manifestURL: string,
  transport: string
): Observable<{ manifest: Manifest; transportPipelines: ITransportPipelines }> {
  const transportPipelines = getTransportPipelineByTransport(transport);
  const manifestPipeline = new createManifestFetcher(
    undefined,
    transportPipelines,
    {
      lowLatencyMode: false,
      maxRetryRegular: 5,
      maxRetryOffline: 5,
    }
  );
  return manifestPipeline.fetch(manifestURL).pipe(
    filter((evt): evt is IManifestFetcherResponse => evt.type === "response"),
    mergeMap((response) =>
      response.parse({ previousManifest: null, unsafeMode: false })
    ),
    filter((res): res is IManifestFetcherParsedResult => res.type === "parsed"),
    map(({ manifest }) => ({ manifest, transportPipelines }))
  );
}

/**
 * Get the adaptations for the current period.
 *
 * @param {Object} builder The global builder context for each
 * bufferType we insert in IndexedDB
 * @returns {Object} Periods associated with an array of adaptations
 *
 */
export function getBuilderFormattedForAdaptations({
  builder,
}: Pick<IStoredManifest, "builder">): IAdaptationForPeriod {
  return Object.keys(builder).reduce<IAdaptationForPeriod>((acc, curr) => {
    const ctxs = builder[curr as ContentBufferType];
    if (ctxs == null || ctxs.length === 0) {
      return acc;
    }
    for (let i = 0; i <= ctxs.length; i++) {
      const ctx = ctxs[i];
      const periodId = ctx.period.id;
      if (acc[periodId] === undefined) {
        acc[periodId] = [];
        acc[periodId].push({
          type: ctx.adaptation.type as ContentBufferType,
          audioDescription: ctx.adaptation.isAudioDescription ?? false,
          closedCaption: ctx.adaptation.isClosedCaption ?? false,
          language: ctx.adaptation.language ?? "",
          representations: [ctx.representation],
        });
        return acc;
      }
      acc[periodId].push({
        type: ctx.adaptation.type as ContentBufferType,
        audioDescription: ctx.adaptation.isAudioDescription ?? false,
        closedCaption: ctx.adaptation.isClosedCaption ?? false,
        language: ctx.adaptation.language ?? "",
        representations: [ctx.representation].map((value) => {

          value.contentProtections = {
            keyIds: value.contentProtections?.keyIds || undefined,
            initData: [
              {
                type: "cenc",
                values:
                  takePSSHOut(
                    ctx.chunkData.data
                  )
                ,
              },
            ],
          };
          return value;
        }),
      });
      return acc;
    }
    return acc;
  }, {});
}

/**
 * Get the segments for the current representation.
 *
 * @param {Pick<IStoredManifest, "builder">} builder The global builder context for each
 * bufferType we insert in IndexedDB
 * @returns {ISegmentForRepresentation} Representation associated
 *  with an array of segments.
 *
 */
export function getBuilderFormattedForSegments({
  builder,
}: Pick<IStoredManifest, "builder">) {
  return Object.keys(builder).reduce<ISegmentForRepresentation>((acc, curr) => {
    const ctxs = builder[curr as ContentBufferType];
    if (ctxs == null || ctxs.length === 0) {
      return acc;
    }
    for (let i = 0; i <= ctxs.length; i++) {
      const ctx = ctxs[i];
      const repreId = ctx.representation.id;
      acc[repreId] =
        ctx.nextSegments
          .reduce<ILocalIndexSegment[]>((accSegts, currSegment) => {
            const { time, timescale, duration } = currSegment;
            accSegts.push({
              time: (time / timescale) ,
              duration: (duration / timescale) ,
            });
            return accSegts;
          }, []);
      return acc;
    }
    return acc;
  }, {});
}

/**
 *
 */
export function getKeySystemsSessionsOffline(
  storedContentsProtections?: IStoredContentProtection[]
) {
  if (storedContentsProtections === undefined || storedContentsProtections.length === 0) {
    return undefined;
  }
  const flattenedStoredContentsProtections = storedContentsProtections.
    reduce<IPersistentSessionInfo[]>((acc, curr) => {
      return acc.concat(curr.persistentSessionInfo);
    }, []);

  return {
    drmType: storedContentsProtections[0].drmType,
    storedContentsProtections: flattenedStoredContentsProtections,
  };
}

/**
 * Returns the structure of the manifest needed by the RxPlayer transport local.
 *
 * @remarks
 * It's mandatory to rebuild again the local manifest
 * when we want to play an offline content because we lose every reference
 * when storing in IndexedDB.
 *
 * @param {Object} manifest - The Manifest we downloaded when online
 * @param {Object} adaptationsBuilder Periods associated with
 *  an array of adaptations
 * @param {Object} representationsBuilder - Representation
 *  associatedwith an array of segments.
 * @param {Object} IAdaptationForPeriod Additional utils...
 * @returns {Object} A ILocalManifest to the RxPlayer transport local
 *
 */
export function offlineManifestLoader(
  manifest: Manifest,
  adaptations: IAdaptationForPeriod,
  representations: ISegmentForRepresentation,
  { contentID, duration, isFinished, db }: IUtilsOfflineLoader
): ILocalManifest {
  return {
    type: "local",
    version: "0.2",
    minimumPosition: 0,
    maximumPosition: duration,
    periods: manifest.periods.map<ILocalPeriod>((period): ILocalPeriod => {

      console.log({ manifest });

      return {
        start: period.start,
        end:
          period.end !== undefined ? period.end : Number.MAX_VALUE,
        adaptations: adaptations[period.id].map(
          (adaptation): ILocalAdaptation => ({
            type: adaptation.type,
            audioDescription: adaptation.audioDescription,
            closedCaption: adaptation.closedCaption,
            language: adaptation.language,
            representations: adaptation.representations.map(
              ({
                mimeType,
                codec,
                id,
                contentProtections,
                ...representation
              }): ILocalRepresentation => {

                const localRepresentation: ILocalRepresentation =  ({
                  bitrate: representation.bitrate,
                  mimeType: mimeType ?? "",
                  codecs: codec ??  "",
                  width: representation.width ?? 0,
                  height: representation.height ?? 0,
                  index: {
                    loadInitSegment: ({ resolve, reject }) => {
                      db.get("segments", `init--${id}--${contentID}`)
                        .then((segment?: ISegmentStored) => {
                          if (segment === undefined) {
                            return reject(
                              new SegmentConstuctionError(`${contentID}:
                                Impossible to retrieve INIT segment in IndexedDB for
                                representation: ${id}, got: undefined`)
                            );
                          }
                          return resolve({
                            data: segment.data,
                          });
                        })
                        .catch(reject);
                    },
                    loadSegment: (
                      { time: reqSegmentTime },
                      { resolve, reject }
                    ) => {
                      logger.debug(
                        "[downloader] try to get segments ",
                        `${reqSegmentTime}--${id}--${contentID}`
                      );

                      db.get("segments", `${reqSegmentTime}--${id}--${contentID}`)
                        .then((segment) => {
                          if (segment === undefined) {
                            throw Error("no segment found");
                          }
                          return resolve({
                            data: segment.data,
                          });
                        })
                        .catch(reject);
                    },
                    segments: representations[id],
                  },
                });

                // if offline content has DRM info
                // add contentProtections info to localRepresentation
                if (contentProtections?.keyIds !== undefined) {
                  localRepresentation.contentProtections = {
                    keyIds: contentProtections.keyIds
                      .filter((keyId) => keyId.systemId !== undefined) as Exclude<typeof localRepresentation["contentProtections"], undefined>["keyIds"],
                    initData:
                      contentProtections.initData.reduce<IContentProtections["initData"]>(
                        (acc, curr) => {
                          acc[curr.type] = curr.values ;
                          return acc;
                        }, {}),
                  };
                }

                return localRepresentation;
              }
            ),
          })
        ),
      };
    }),
    isFinished,
  };
}
