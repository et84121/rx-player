import type { IProcessedProtectionData } from "../main_thread/types";
import type { IManifest, IPeriod, IAdaptation, IPeriodsUpdateResult } from "../manifest";
import type {
  IAudioRepresentation,
  IAudioTrack,
  IRepresentationFilter,
  ITextTrack,
  ITrackType,
  IVideoRepresentation,
  IVideoTrack,
} from "../public_types";
import areArraysOfNumbersEqual from "../utils/are_arrays_of_numbers_equal";
import arrayFind from "../utils/array_find";
import isNullOrUndefined from "../utils/is_null_or_undefined";
import getMonotonicTimeStamp from "../utils/monotonic_timestamp";
import { objectValues } from "../utils/object_values";
import type {
  IAdaptationMetadata,
  IManifestMetadata,
  IPeriodMetadata,
  IRepresentationMetadata,
  IThumbnailTrackMetadata,
} from "./types";

/** List in an array every possible value for the Adaptation's `type` property. */
export const SUPPORTED_ADAPTATIONS_TYPE: ITrackType[] = ["audio", "video", "text"];

/**
 * Returns the theoretical minimum playable position on the content
 * regardless of the current Adaptation chosen, as estimated at parsing
 * time.
 * @param {Object} manifest
 * @returns {number}
 */
export function getMinimumSafePosition(manifest: IManifestMetadata): number {
  const windowData = manifest.timeBounds;
  if (windowData.timeshiftDepth === null) {
    return windowData.minimumSafePosition ?? 0;
  }

  const { maximumTimeData } = windowData;
  let maximumTime: number;
  if (!windowData.maximumTimeData.isLinear) {
    maximumTime = maximumTimeData.maximumSafePosition;
  } else {
    const timeDiff = getMonotonicTimeStamp() - maximumTimeData.time;
    maximumTime = maximumTimeData.maximumSafePosition + timeDiff / 1000;
  }
  const theoricalMinimum = maximumTime - windowData.timeshiftDepth;
  return Math.max(windowData.minimumSafePosition ?? 0, theoricalMinimum);
}

/**
 * Get the position of the live edge - that is, the position of what is
 * currently being broadcasted, in seconds.
 * @param {Object} manifest
 * @returns {number|undefined}
 */
export function getLivePosition(manifest: IManifestMetadata): number | undefined {
  const { maximumTimeData } = manifest.timeBounds;
  if (!manifest.isLive || maximumTimeData.livePosition === undefined) {
    return undefined;
  }
  if (!maximumTimeData.isLinear) {
    return maximumTimeData.livePosition;
  }
  const timeDiff = getMonotonicTimeStamp() - maximumTimeData.time;
  return maximumTimeData.livePosition + timeDiff / 1000;
}

/**
 * Returns the theoretical maximum playable position on the content
 * regardless of the current Adaptation chosen, as estimated at parsing
 * time.
 * @param {Object} manifest
 * @returns {number}
 */
export function getMaximumSafePosition(manifest: IManifestMetadata): number {
  const { maximumTimeData } = manifest.timeBounds;
  if (!maximumTimeData.isLinear) {
    return maximumTimeData.maximumSafePosition;
  }
  const timeDiff = getMonotonicTimeStamp() - maximumTimeData.time;
  return maximumTimeData.maximumSafePosition + timeDiff / 1000;
}

/**
 * Returns Adaptations that contain supported Representation(s).
 * @param {string|undefined} type - If set filter on a specific Adaptation's
 * type. Will return for all types if `undefined`.
 * @returns {Array.<Adaptation>}
 */
export function getSupportedAdaptations(
  period: IPeriod,
  type?: ITrackType | undefined,
): IAdaptation[];
export function getSupportedAdaptations(
  period: IPeriodMetadata,
  type?: ITrackType | undefined,
): IAdaptationMetadata[];
export function getSupportedAdaptations(
  period: IPeriod | IPeriodMetadata,
  type?: ITrackType | undefined,
): IAdaptationMetadata[] | IAdaptation[] {
  if (type === undefined) {
    return getAdaptations(period).filter((ada) => {
      return (
        ada.supportStatus.hasSupportedCodec !== false &&
        ada.supportStatus.isDecipherable !== false
      );
    });
  }
  const adaptationsForType = period.adaptations[type];
  if (adaptationsForType === undefined) {
    return [];
  }
  return adaptationsForType.filter((ada) => {
    return (
      ada.supportStatus.hasSupportedCodec !== false &&
      ada.supportStatus.isDecipherable !== false
    );
  });
}

/**
 * Returns the Period encountered at the given time.
 * Returns `undefined` if there is no Period exactly at the given time.
 * @param {Object} manifest
 * @param {number} time
 * @returns {Object|undefined}
 */
export function getPeriodForTime(manifest: IManifest, time: number): IPeriod | undefined;
export function getPeriodForTime(
  manifest: IManifestMetadata,
  time: number,
): IPeriodMetadata | undefined;
export function getPeriodForTime(
  manifest: IManifestMetadata | IManifest,
  time: number,
): IPeriod | IPeriodMetadata | undefined {
  let nextPeriod = null;
  for (const period of manifest.periods) {
    if (periodContainsTime(period, time, nextPeriod)) {
      return period;
    }
    nextPeriod = period;
  }
}

/**
 * Returns the Period coming chronologically just after another given Period.
 * Returns `undefined` if not found.
 * @param {Object} manifest
 * @param {Object} period
 * @returns {Object|null}
 */
export function getPeriodAfter(manifest: IManifest, period: IPeriod): IPeriod | null;
export function getPeriodAfter(
  manifest: IManifestMetadata,
  period: IPeriodMetadata,
): IPeriodMetadata | null;
export function getPeriodAfter(
  manifest: IManifestMetadata | IManifest,
  period: IPeriodMetadata | IPeriod,
): IPeriod | IPeriodMetadata | null {
  const endOfPeriod = period.end;
  if (endOfPeriod === undefined) {
    return null;
  }
  const nextPeriod = arrayFind(manifest.periods, (_period) => {
    return _period.end === undefined || endOfPeriod < _period.end;
  });
  return nextPeriod === undefined ? null : nextPeriod;
}

/**
 * Returns true if the give time is in the time boundaries of this `Period`.
 * @param {Object} period - The `Period` which we want to check.
 * @param {number} time
 * @param {object|null} nextPeriod - Period coming chronologically just
 * after in the same Manifest. `null` if this instance is the last `Period`.
 * @returns {boolean}
 */
export function periodContainsTime(
  period: IPeriodMetadata,
  time: number,
  nextPeriod: IPeriodMetadata | null,
): boolean {
  if (time >= period.start && (period.end === undefined || time < period.end)) {
    return true;
  } else if (
    time === period.end &&
    (nextPeriod === null || nextPeriod.start > period.end)
  ) {
    // The last possible timed position of a Period is ambiguous as it is
    // frequently in common with the start of the next one: is it part of
    // the current or of the next Period?
    // Here we only consider it part of the current Period if it is the
    // only one with that position.
    return true;
  }
  return false;
}

/**
 * Returns every `Adaptations` (or `tracks`) linked to that Period, in an
 * Array.
 * @returns {Array.<Object>}
 */
export function getAdaptations(period: IPeriod): IAdaptation[];
export function getAdaptations(period: IPeriodMetadata): IAdaptationMetadata[];
export function getAdaptations(
  period: IPeriodMetadata | IPeriod,
): IAdaptationMetadata[] | IAdaptation[] {
  const adaptationsByType = period.adaptations;
  return objectValues(adaptationsByType).reduce<IAdaptationMetadata[]>(
    // Note: the second case cannot happen. TS is just being dumb here
    (acc, adaptations) =>
      !isNullOrUndefined(adaptations) ? acc.concat(adaptations) : acc,
    [],
  );
}

/**
 * Format an `Adaptation`, generally of type `"audio"`, as an `IAudioTrack`.
 * @param {Object} adaptation
 * @param {boolean} filterPlayable - If `true` only "playable" Representation
 * will be returned.
 * @returns {Object}
 */
export function toAudioTrack(
  adaptation: IAdaptationMetadata,
  filterPlayable: boolean,
): IAudioTrack {
  const formatted: IAudioTrack = {
    language: adaptation.language ?? "",
    normalized: adaptation.normalizedLanguage ?? "",
    audioDescription: adaptation.isAudioDescription === true,
    id: adaptation.id,
    representations: (filterPlayable
      ? adaptation.representations.filter((r) => isRepresentationPlayable(r) === true)
      : adaptation.representations
    ).map(toAudioRepresentation),
    label: adaptation.label,
  };
  if (adaptation.isDub === true) {
    formatted.dub = true;
  }
  return formatted;
}

/**
 * Format an `Adaptation`, generally of type `"audio"`, as an `IAudioTrack`.
 * @param {Object} adaptation
 * @returns {Object}
 */
export function toTextTrack(adaptation: IAdaptationMetadata): ITextTrack {
  return {
    language: adaptation.language ?? "",
    normalized: adaptation.normalizedLanguage ?? "",
    closedCaption: adaptation.isClosedCaption === true,
    id: adaptation.id,
    label: adaptation.label,
    forced: adaptation.isForcedSubtitles,
  };
}

/**
 * Format an `Adaptation`, generally of type `"video"`, as an `IAudioTrack`.
 * @param {Object} adaptation
 * @param {boolean} filterPlayable - If `true` only "playable" Representation
 * will be returned.
 * @returns {Object}
 */
export function toVideoTrack(
  adaptation: IAdaptationMetadata,
  filterPlayable: boolean,
): IVideoTrack {
  const trickModeTracks =
    adaptation.trickModeTracks !== undefined
      ? adaptation.trickModeTracks.map((trickModeAdaptation) => {
          const representations = (
            filterPlayable
              ? trickModeAdaptation.representations.filter(
                  (r) => isRepresentationPlayable(r) === true,
                )
              : trickModeAdaptation.representations
          ).map(toVideoRepresentation);
          const trickMode: IVideoTrack = {
            id: trickModeAdaptation.id,
            representations,
            isTrickModeTrack: true,
          };
          if (trickModeAdaptation.isSignInterpreted === true) {
            trickMode.signInterpreted = true;
          }
          return trickMode;
        })
      : undefined;

  const videoTrack: IVideoTrack = {
    id: adaptation.id,
    representations: (filterPlayable
      ? adaptation.representations.filter((r) => isRepresentationPlayable(r) === true)
      : adaptation.representations
    ).map(toVideoRepresentation),
    label: adaptation.label,
  };
  if (adaptation.isSignInterpreted === true) {
    videoTrack.signInterpreted = true;
  }
  if (adaptation.isTrickModeTrack === true) {
    videoTrack.isTrickModeTrack = true;
  }
  if (trickModeTracks !== undefined) {
    videoTrack.trickModeTracks = trickModeTracks;
  }
  return videoTrack;
}

/**
 * Format Representation as an `IAudioRepresentation`.
 * @returns {Object}
 */
function toAudioRepresentation(
  representation: IRepresentationMetadata,
): IAudioRepresentation {
  const { id, bitrate, codecs, isSpatialAudio, isSupported, decipherable } =
    representation;
  return {
    id,
    bitrate,
    codec: codecs?.[0],
    isSpatialAudio,
    isCodecSupported: isSupported,
    decipherable,
  };
}

/**
 * Format Representation as an `IVideoRepresentation`.
 * @returns {Object}
 */
function toVideoRepresentation(
  representation: IRepresentationMetadata,
): IVideoRepresentation {
  const {
    id,
    bitrate,
    frameRate,
    width,
    height,
    codecs,
    hdrInfo,
    isSupported,
    decipherable,
    contentProtections,
  } = representation;
  return {
    id,
    bitrate,
    frameRate,
    width,
    height,
    codec: codecs?.[0],
    hdrInfo,
    isCodecSupported: isSupported,
    decipherable,
    contentProtections:
      contentProtections !== undefined
        ? {
            keyIds: contentProtections.keyIds,
          }
        : undefined,
  };
}

export function toTaggedTrack(adaptation: IAdaptation): ITaggedTrack {
  switch (adaptation.type) {
    case "audio":
      return { type: "audio", track: toAudioTrack(adaptation, false) };
    case "video":
      return { type: "video", track: toVideoTrack(adaptation, false) };
    case "text":
      return { type: "text", track: toTextTrack(adaptation) };
  }
}

/**
 * Returns `true` if the `Representation` has a high chance of being playable on
 * the current device (its codec seems supported and we don't consider it to be
 * un-decipherable).
 *
 * Returns `false` if the `Representation` has a high chance of being unplayable
 * on the current device (its codec seems unsupported and/or we consider it to
 * be un-decipherable).
 *
 * Returns `undefined` if we don't know as the codec has not been checked yet.
 *
 * @param {Object} representation
 * @returns {boolean|undefined}
 */
export function isRepresentationPlayable(
  representation: IRepresentationMetadata,
): boolean | undefined {
  if (representation.decipherable === false) {
    return false;
  }
  return representation.isSupported;
}

/**
 * Information on a Representation affected by a `decipherabilityUpdates` event.
 */
export interface IDecipherabilityStatusChangedElement {
  manifest: IManifestMetadata;
  period: IPeriodMetadata;
  adaptation: IAdaptationMetadata;
  representation: IRepresentationMetadata;
}

/**
 * Change the decipherability of Representations which have their key id in one
 * of the given Arrays:
 *
 *   - Those who have a key id listed in `whitelistedKeyIds` will have their
 *     decipherability updated to `true`
 *
 *   - Those who have a key id listed in `blacklistedKeyIds` will have their
 *     decipherability updated to `false`
 *
 *   - Those who have a key id listed in `delistedKeyIds` will have their
 *     decipherability updated to `undefined`.
 *
 * @param {Object} manifest
 * @param {Object} updates
 * @param {Array.<Uint8Array>} updates.whitelistedKeyIds
 * @param {Array.<Uint8Array>} updates.blacklistedKeyIds
 * @param {Array.<Uint8Array>} updates.delistedKeyIds
 */
export function updateDecipherabilityFromKeyIds(
  manifest: IManifestMetadata,
  updates: {
    whitelistedKeyIds: Uint8Array[];
    blacklistedKeyIds: Uint8Array[];
    delistedKeyIds: Uint8Array[];
  },
): IDecipherabilityStatusChangedElement[] {
  const { whitelistedKeyIds, blacklistedKeyIds, delistedKeyIds } = updates;
  return updateRepresentationsDeciperability(manifest, (representation) => {
    if (representation.contentProtections === undefined) {
      return representation.decipherable;
    }
    const contentKIDs = representation.contentProtections.keyIds;
    if (contentKIDs !== undefined) {
      for (const elt of contentKIDs) {
        for (const blacklistedKeyId of blacklistedKeyIds) {
          if (areArraysOfNumbersEqual(blacklistedKeyId, elt)) {
            return false;
          }
        }
        for (const whitelistedKeyId of whitelistedKeyIds) {
          if (areArraysOfNumbersEqual(whitelistedKeyId, elt)) {
            return true;
          }
        }
        for (const delistedKeyId of delistedKeyIds) {
          if (areArraysOfNumbersEqual(delistedKeyId, elt)) {
            return undefined;
          }
        }
      }
    }
    return representation.decipherable;
  });
}

/**
 * Update decipherability to `false` to any Representation which is linked to
 * the given initialization data.
 * @param {Object} manifest
 * @param {Object} initData
 */
export function updateDecipherabilityFromProtectionData(
  manifest: IManifestMetadata,
  initData: IProcessedProtectionData,
): IDecipherabilityStatusChangedElement[] {
  return updateRepresentationsDeciperability(manifest, (representation) => {
    if (representation.decipherable === false) {
      return false;
    }
    const segmentProtections = representation.contentProtections?.initData ?? [];
    for (const protection of segmentProtections) {
      if (initData.type === undefined || protection.type === initData.type) {
        const containedInitData = initData.values
          .getFormattedValues()
          .every((undecipherableVal) => {
            return protection.values.some((currVal) => {
              return (
                (undecipherableVal.systemId === undefined ||
                  currVal.systemId === undecipherableVal.systemId) &&
                areArraysOfNumbersEqual(currVal.data, undecipherableVal.data)
              );
            });
          });
        if (containedInitData) {
          return false;
        }
      }
    }
    return representation.decipherable;
  });
}

/**
 * Update `decipherable` property of every `Representation` found in the
 * Manifest based on the result of a `isDecipherable` callback:
 *   - When that callback returns `true`, update `decipherable` to `true`
 *   - When that callback returns `false`, update `decipherable` to `false`
 *   - When that callback returns `undefined`, update `decipherable` to
 *     `undefined`
 * @param {Manifest} manifest
 * @param {Function} isDecipherable
 * @returns {Array.<Object>}
 */
function updateRepresentationsDeciperability(
  manifest: IManifestMetadata,
  isDecipherable: (rep: IRepresentationMetadata) => boolean | undefined,
): IDecipherabilityStatusChangedElement[] {
  const updates: IDecipherabilityStatusChangedElement[] = [];
  for (const period of manifest.periods) {
    const adaptationsByType = period.adaptations;
    const adaptations = objectValues(adaptationsByType).reduce<IAdaptationMetadata[]>(
      // Note: the second case cannot happen. TS is just being dumb here
      (acc, adaps) => (!isNullOrUndefined(adaps) ? acc.concat(adaps) : acc),
      [],
    );
    for (const adaptation of adaptations) {
      let hasOnlyUndecipherableRepresentations = true;
      for (const representation of adaptation.representations) {
        const result = isDecipherable(representation);
        if (result !== false) {
          hasOnlyUndecipherableRepresentations = false;
        }
        if (result !== representation.decipherable) {
          if (result === true) {
            adaptation.supportStatus.isDecipherable = true;
          } else if (
            result === undefined &&
            adaptation.supportStatus.isDecipherable === false
          ) {
            adaptation.supportStatus.isDecipherable = undefined;
          }
          updates.push({ manifest, period, adaptation, representation });
          representation.decipherable = result;
        }
      }
      if (hasOnlyUndecipherableRepresentations) {
        adaptation.supportStatus.isDecipherable = false;
      }
    }
  }
  return updates;
}

/**
 *
 * TODO that function is kind of very ugly, yet should work.
 * Maybe find out a better system for Manifest updates.
 * @param {Object} baseManifest
 * @param {Object} newManifest
 * @param {Array.<Object>} updates
 */
export function replicateUpdatesOnManifestMetadata(
  baseManifest: IManifestMetadata,
  newManifest: Omit<IManifestMetadata, "periods">,
  updates: IPeriodsUpdateResult,
) {
  for (const prop of Object.keys(newManifest)) {
    if (prop !== "periods") {
      // trust me bro
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (baseManifest as any)[prop] = (newManifest as any)[prop];
    }
  }

  for (const removedPeriod of updates.removedPeriods) {
    for (let periodIdx = 0; periodIdx < baseManifest.periods.length; periodIdx++) {
      if (baseManifest.periods[periodIdx].id === removedPeriod.id) {
        baseManifest.periods.splice(periodIdx, 1);
        break;
      }
    }
  }

  for (const updatedPeriod of updates.updatedPeriods) {
    for (let periodIdx = 0; periodIdx < baseManifest.periods.length; periodIdx++) {
      const newPeriod = updatedPeriod.period;
      if (baseManifest.periods[periodIdx].id === updatedPeriod.period.id) {
        const basePeriod = baseManifest.periods[periodIdx];
        for (const prop of Object.keys(newPeriod)) {
          if (prop !== "adaptations") {
            // trust me bro
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
            (basePeriod as any)[prop] = (newPeriod as any)[prop];
          }
        }

        for (const removedThumbnailTrack of updatedPeriod.result.removedThumbnailTracks) {
          for (
            let thumbIdx = 0;
            thumbIdx < basePeriod.thumbnailTracks.length;
            thumbIdx++
          ) {
            if (basePeriod.thumbnailTracks[thumbIdx].id === removedThumbnailTrack.id) {
              basePeriod.thumbnailTracks.splice(thumbIdx, 1);
              break;
            }
          }
        }
        for (const updatedThumbnailTrack of updatedPeriod.result.updatedThumbnailTracks) {
          const newThumbnailTrack = updatedThumbnailTrack;
          for (
            let thumbIdx = 0;
            thumbIdx < basePeriod.thumbnailTracks.length;
            thumbIdx++
          ) {
            if (basePeriod.thumbnailTracks[thumbIdx].id === newThumbnailTrack.id) {
              const baseThumbnailTrack = basePeriod.thumbnailTracks[thumbIdx];
              for (const prop of Object.keys(newThumbnailTrack) as Array<
                keyof IThumbnailTrackMetadata
              >) {
                // eslint-disable-next-line
                (baseThumbnailTrack as any)[prop] = newThumbnailTrack[prop];
              }
              break;
            }
          }
        }
        for (const addedThumbnailTrack of updatedPeriod.result.addedThumbnailTracks) {
          basePeriod.thumbnailTracks.push(addedThumbnailTrack);
        }

        for (const removedAdaptation of updatedPeriod.result.removedAdaptations) {
          const ttype = removedAdaptation.trackType;
          const adaptationsForType = basePeriod.adaptations[ttype] ?? [];
          for (let adapIdx = 0; adapIdx < adaptationsForType.length; adapIdx++) {
            if (adaptationsForType[adapIdx].id === removedAdaptation.id) {
              adaptationsForType.splice(adapIdx, 1);
              break;
            }
          }
        }

        for (const updatedAdaptation of updatedPeriod.result.updatedAdaptations) {
          const newAdaptation = updatedAdaptation.adaptation;
          const ttype = updatedAdaptation.trackType;
          const adaptationsForType = basePeriod.adaptations[ttype] ?? [];
          for (let adapIdx = 0; adapIdx < adaptationsForType.length; adapIdx++) {
            if (adaptationsForType[adapIdx].id === newAdaptation) {
              const baseAdaptation = adaptationsForType[adapIdx];
              for (const removedRepresentation of updatedAdaptation.removedRepresentations) {
                for (
                  let repIdx = 0;
                  repIdx < baseAdaptation.representations.length;
                  repIdx++
                ) {
                  if (
                    baseAdaptation.representations[repIdx].id === removedRepresentation
                  ) {
                    baseAdaptation.representations.splice(repIdx, 1);
                    break;
                  }
                }
              }

              for (const newRepresentation of updatedAdaptation.updatedRepresentations) {
                for (
                  let repIdx = 0;
                  repIdx < baseAdaptation.representations.length;
                  repIdx++
                ) {
                  if (
                    baseAdaptation.representations[repIdx].id === newRepresentation.id
                  ) {
                    const baseRepresentation = baseAdaptation.representations[repIdx];
                    for (const prop of Object.keys(newRepresentation) as Array<
                      keyof IRepresentationMetadata
                    >) {
                      if (prop !== "decipherable") {
                        // eslint-disable-next-line
                        (baseRepresentation as any)[prop] = newRepresentation[prop];
                      }
                    }
                    break;
                  }
                }
              }

              for (const addedRepresentation of updatedAdaptation.addedRepresentations) {
                baseAdaptation.representations.push(addedRepresentation);
              }
              break;
            }
          }
        }

        for (const addedAdaptation of updatedPeriod.result.addedAdaptations) {
          const ttype = addedAdaptation.type;
          const adaptationsForType = basePeriod.adaptations[ttype];
          if (adaptationsForType === undefined) {
            basePeriod.adaptations[ttype] = [addedAdaptation];
          } else {
            adaptationsForType.push(addedAdaptation);
          }
        }
        break;
      }
    }
  }

  for (const addedPeriod of updates.addedPeriods) {
    for (let periodIdx = 0; periodIdx < baseManifest.periods.length; periodIdx++) {
      if (baseManifest.periods[periodIdx].start > addedPeriod.start) {
        baseManifest.periods.splice(periodIdx, 0, addedPeriod);
        break;
      }
    }
    baseManifest.periods.push(addedPeriod);
  }
}

export function createRepresentationFilterFromFnString(
  fnString: string,
): IRepresentationFilter {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(
    `return (${fnString}(arguments[0], arguments[1]))`,
  ) as IRepresentationFilter;
}

interface ITaggedAudioTrack {
  type: "audio";
  track: IAudioTrack;
}

interface ITaggedVideoTrack {
  type: "video";
  track: IVideoTrack;
}

interface ITaggedTextTrack {
  type: "text";
  track: ITextTrack;
}

export type ITaggedTrack = ITaggedAudioTrack | ITaggedVideoTrack | ITaggedTextTrack;
