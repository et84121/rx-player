/**
 * Copyright 2015 CANAL+ Group
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

import log from "../../../log";
import type { IManifest } from "../../../manifest";
import { SUPPORTED_ADAPTATIONS_TYPE } from "../../../manifest";
import { StaticRepresentationIndex } from "../../../manifest/classes";
import type { ITrackType } from "../../../public_types";
import idGenerator from "../../../utils/id_generator";
import isNullOrUndefined from "../../../utils/is_null_or_undefined";
import getMonotonicTimeStamp from "../../../utils/monotonic_timestamp";
import { getFilenameIndexInUrl } from "../../../utils/url-utils";
import type {
  IParsedAdaptation,
  IParsedAdaptations,
  IParsedManifest,
  IParsedPeriod,
  IParsedRepresentation,
} from "../types";
import MetaRepresentationIndex from "./representation_index";

export type IParserResponse<T> =
  | {
      type: "needs-manifest-loader";
      value: {
        ressources: Array<{ url: string; transportType: string }>;
        continue: (loadedRessources: IManifest[]) => IParserResponse<T>;
      };
    }
  | { type: "done"; value: T };

export interface IMetaPlaylistTextTrack {
  url: string;
  language: string;
  closedCaption: boolean;
  mimeType: string;
  codecs?: string;
}

export interface IMetaPlaylist {
  type: "MPL"; // Obligatory token
  version: string; // MAJOR.MINOR
  dynamic?: boolean; // The MetaPlaylist could need to be updated
  pollInterval?: number; // Refresh interval in seconds
  contents: Array<{
    // Sub-Manifests
    url: string; // URL of the Manifest
    startTime: number; // start timestamp in seconds
    endTime: number; // end timestamp in seconds
    transport: string; // "dash" | "smooth" | "metaplaylist"
    textTracks?: IMetaPlaylistTextTrack[];
  }>;
}

/**
 * Parse playlist string to JSON.
 * Returns an array of contents.
 * @param {string} data
 * @param {Object} parserOptions
 * @returns {Object}
 */
export default function parseMetaPlaylist(
  data: unknown,
  parserOptions: {
    url?: string | undefined;
    serverSyncInfos?:
      | {
          serverTimestamp: number;
          clientTime: number;
        }
      | undefined;
  },
): IParserResponse<IParsedManifest> {
  let parsedData;
  if (typeof data === "object" && data !== null) {
    parsedData = data;
  } else if (typeof data === "string") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      parsedData = JSON.parse(data);
    } catch (_error) {
      throw new Error("MPL Parser: Bad MetaPlaylist file. Expected JSON.");
    }
  } else {
    throw new Error(
      "MPL Parser: Parser input must be either a string " +
        "or the MetaPlaylist data directly.",
    );
  }

  const { contents, version, type } = parsedData as IMetaPlaylist;

  if (type !== "MPL") {
    throw new Error(
      "MPL Parser: Bad MetaPlaylist. " + "The `type` property is not set to `MPL`",
    );
  }

  if (version !== "0.1") {
    throw new Error("MPL Parser: Bad MetaPlaylist version");
  }

  // quick checks
  if (isNullOrUndefined(contents) || contents.length === 0) {
    throw new Error("MPL Parser: No content found.");
  }
  const ressources: Array<{ url: string; transportType: string }> = [];
  for (const content of contents) {
    if (
      isNullOrUndefined(content.url) ||
      isNullOrUndefined(content.startTime) ||
      isNullOrUndefined(content.endTime) ||
      isNullOrUndefined(content.transport)
    ) {
      throw new Error("MPL Parser: Malformed content.");
    }
    ressources.push({ url: content.url, transportType: content.transport });
  }

  const metaPlaylist: IMetaPlaylist = parsedData as IMetaPlaylist;
  return {
    type: "needs-manifest-loader",
    value: {
      ressources,
      continue: function parseWholeMPL(loadedRessources: IManifest[]) {
        const parsedManifest = createManifest(
          metaPlaylist,
          loadedRessources,
          parserOptions,
        );
        return { type: "done", value: parsedManifest };
      },
    },
  };
}

/**
 * From several parsed manifests, generate a single bigger manifest.
 * Each content presents a start and end time, so that periods
 * boudaries could be adapted.
 * @param {Object} mplData
 * @param {Array<Object>} manifests
 * @param {Object} parserOptions
 * @returns {Object}
 */
function createManifest(
  mplData: IMetaPlaylist,
  manifests: IManifest[],
  parserOptions: {
    url?: string | undefined;
    serverSyncInfos?: { serverTimestamp: number; clientTime: number } | undefined;
  },
): IParsedManifest {
  const { url, serverSyncInfos } = parserOptions;
  const clockOffset =
    serverSyncInfos !== undefined
      ? serverSyncInfos.serverTimestamp - serverSyncInfos.clientTime
      : undefined;
  const generateAdaptationID = idGenerator();
  const generateRepresentationID = idGenerator();
  const { contents } = mplData;
  const minimumTime = contents.length > 0 ? contents[0].startTime : 0;
  const maximumTime = contents.length > 0 ? contents[contents.length - 1].endTime : 0;
  const isDynamic = mplData.dynamic === true;

  let firstStart: number | null = null;
  let lastEnd: number | null = null;

  const periods: IParsedPeriod[] = [];
  for (let iMan = 0; iMan < contents.length; iMan++) {
    const content = contents[iMan];
    firstStart =
      firstStart !== null ? Math.min(firstStart, content.startTime) : content.startTime;
    lastEnd = lastEnd !== null ? Math.max(lastEnd, content.endTime) : content.endTime;
    const currentManifest = manifests[iMan];
    if (currentManifest.periods.length <= 0) {
      continue;
    }
    const contentOffset = content.startTime - currentManifest.periods[0].start;
    const contentEnd = content.endTime;

    const manifestPeriods = [];
    for (let iPer = 0; iPer < currentManifest.periods.length; iPer++) {
      const currentPeriod = currentManifest.periods[iPer];
      const adaptations = SUPPORTED_ADAPTATIONS_TYPE.reduce<IParsedAdaptations>(
        (acc, type: ITrackType) => {
          const currentAdaptations = currentPeriod.adaptations[type];
          if (isNullOrUndefined(currentAdaptations)) {
            return acc;
          }

          const adaptationsForCurrentType: IParsedAdaptation[] = [];
          for (let iAda = 0; iAda < currentAdaptations.length; iAda++) {
            const currentAdaptation = currentAdaptations[iAda];

            const representations: IParsedRepresentation[] = [];
            for (let iRep = 0; iRep < currentAdaptation.representations.length; iRep++) {
              const currentRepresentation = currentAdaptation.representations[iRep];

              const baseContentMetadata = {
                isLive: currentManifest.isLive,
                manifestPublishTime: currentManifest.publishTime,
                periodStart: currentPeriod.start,
                periodEnd: currentPeriod.end,
              };

              const newIndex = new MetaRepresentationIndex(
                currentRepresentation.index,
                [contentOffset, contentEnd],
                content.transport,
                baseContentMetadata,
              );
              let supplementalCodecs: string | undefined;
              if (currentRepresentation.codecs.length > 1) {
                if (currentRepresentation.codecs.length > 2) {
                  log.warn(
                    "MP: MetaPlaylist relying on more than 2 groups of " +
                      "codecs with retro-compatibility",
                  );
                }
                supplementalCodecs = currentRepresentation.codecs[0];
              }
              const codecs =
                currentRepresentation.codecs[currentRepresentation.codecs.length - 1];
              representations.push({
                bitrate: currentRepresentation.bitrate,
                index: newIndex,
                cdnMetadata: currentRepresentation.cdnMetadata,
                id: currentRepresentation.id,
                height: currentRepresentation.height,
                width: currentRepresentation.width,
                mimeType: currentRepresentation.mimeType,
                frameRate: currentRepresentation.frameRate,
                codecs,
                supplementalCodecs,
                isSpatialAudio: currentRepresentation.isSpatialAudio,
                contentProtections: currentRepresentation.contentProtections,
              });
            }
            adaptationsForCurrentType.push({
              id: currentAdaptation.id,
              representations,
              type: currentAdaptation.type,
              audioDescription: currentAdaptation.isAudioDescription,
              closedCaption: currentAdaptation.isClosedCaption,
              isDub: currentAdaptation.isDub,
              language: currentAdaptation.language,
              isSignInterpreted: currentAdaptation.isSignInterpreted,
            });
            acc[type] = adaptationsForCurrentType;
          }
          return acc;
        },
        {},
      );

      // TODO only first period?
      const textTracks: IMetaPlaylistTextTrack[] =
        content.textTracks === undefined ? [] : content.textTracks;
      const newTextAdaptations: IParsedAdaptation[] = textTracks.map((track) => {
        const adaptationID = "gen-text-ada-" + generateAdaptationID();
        const representationID = "gen-text-rep-" + generateRepresentationID();
        const indexOfFilename = getFilenameIndexInUrl(track.url);
        const cdnUrl = track.url.substring(0, indexOfFilename);
        const filename = track.url.substring(indexOfFilename);
        return {
          id: adaptationID,
          type: "text",
          language: track.language,
          closedCaption: track.closedCaption,
          manuallyAdded: true,
          representations: [
            {
              bitrate: 0,
              cdnMetadata: [{ baseUrl: cdnUrl }],
              id: representationID,
              mimeType: track.mimeType,
              codecs: track.codecs,
              index: new StaticRepresentationIndex({ media: filename }),
            },
          ],
        };
      }, []);

      if (newTextAdaptations.length > 0) {
        if (isNullOrUndefined(adaptations.text)) {
          adaptations.text = newTextAdaptations;
        } else {
          adaptations.text.push(...newTextAdaptations);
        }
      }

      const newPeriod: IParsedPeriod = {
        id: formatId(currentManifest.id) + "_" + formatId(currentPeriod.id),
        adaptations,
        duration: currentPeriod.duration,
        start: contentOffset + currentPeriod.start,
        thumbnailTracks: currentPeriod.thumbnailTracks,
      };
      manifestPeriods.push(newPeriod);
    }

    for (let i = manifestPeriods.length - 1; i >= 0; i--) {
      const period = manifestPeriods[i];
      if (period.start >= content.endTime) {
        manifestPeriods.splice(i, 1);
      } else if (!isNullOrUndefined(period.duration)) {
        if (period.start + period.duration > content.endTime) {
          period.duration = content.endTime - period.start;
        }
      } else if (i === manifestPeriods.length - 1) {
        period.duration = content.endTime - period.start;
      }
    }
    periods.push(...manifestPeriods);
  }

  const time = getMonotonicTimeStamp();
  const isLastPeriodKnown =
    !isDynamic ||
    (mplData.pollInterval === undefined &&
      (manifests.length <= 0 || manifests[manifests.length - 1].isLastPeriodKnown));
  const manifest = {
    availabilityStartTime: 0,
    clockOffset,
    suggestedPresentationDelay: 10,
    periods,
    transportType: "metaplaylist",
    isLive: isDynamic,
    isDynamic,
    isLastPeriodKnown,
    uris: isNullOrUndefined(url) ? [] : [url],

    // TODO more precize time bounds?
    timeBounds: {
      minimumSafePosition: minimumTime,
      timeshiftDepth: null,
      maximumTimeData: {
        isLinear: false,
        maximumSafePosition: maximumTime,
        livePosition: undefined,
        time,
      },
    },
    lifetime: mplData.pollInterval,
  };

  return manifest;
}

function formatId(str: string) {
  return str.replace(/_/g, "_");
}
