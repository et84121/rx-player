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
import {
  ICustomError,
  isKnownError,
  MediaError,
} from "../errors";
import {
  IManifestStreamEvent,
  IParsedPeriod,
} from "../parsers/manifest";
import arrayFind from "../utils/array_find";
import isNullOrUndefined from "../utils/is_null_or_undefined";
import objectValues from "../utils/object_values";
import Adaptation, {
  IRepresentationFilter,
} from "./adaptation";
import { IAdaptationType } from "./types";

/** Structure listing every `Adaptation` in a Period. */
export type IManifestAdaptations = Partial<Record<IAdaptationType, Adaptation[]>>;

/**
 * Class representing the tracks and qualities available from a given time
 * period in the the Manifest.
 * @class Period
 */
export default class Period {
  /** ID uniquely identifying the Period in the Manifest. */
  public readonly id : string;

  /** Every 'Adaptation' in that Period, per type of Adaptation. */
  public adaptations : IManifestAdaptations;

  /** Absolute start time of the Period, in seconds. */
  public start : number;

  /**
   * Absolute end time of the Period, in seconds.
   * `undefined` for still-running Periods.
   */
  public end? : number;

  /**
   * Array containing every errors that happened when the Period has been
   * created, in the order they have happened.
   */
  public readonly parsingErrors : ICustomError[];

  /** Array containing every stream event happening on the period */
  public streamEvents : IManifestStreamEvent[];

  /**
   * @constructor
   * @param {Object} args
   * @param {function|undefined} [representationFilter]
   */
  constructor(
    args : IParsedPeriod,
    representationFilter? : IRepresentationFilter
  ) {
    this.parsingErrors = [];
    this.id = args.id;
    this.adaptations = (Object.keys(args.adaptations) as IAdaptationType[])
      .reduce<IManifestAdaptations>((acc, type) => {
        const adaptationsForType = args.adaptations[type];
        if (adaptationsForType == null) {
          return acc;
        }
        const filteredAdaptations = adaptationsForType
          .map((adaptation) : Adaptation|null => {
            let newAdaptation : Adaptation|null = null;
            try {
              newAdaptation = new Adaptation(adaptation, { representationFilter });
            } catch (err) {
              if (isKnownError(err) &&
                  err.code === "MANIFEST_UNSUPPORTED_ADAPTATION_TYPE")
              {
                this.parsingErrors.push(err);
                return null;
              }
              throw err;
            }
            this.parsingErrors.push(...newAdaptation.parsingErrors);
            return newAdaptation;
          })
          .filter((adaptation) : adaptation is Adaptation =>
            adaptation !== null && adaptation.representations.length > 0
          );
        if (filteredAdaptations.every(adaptation => !adaptation.isSupported) &&
            adaptationsForType.length > 0 &&
            (type === "video" || type === "audio")
        ) {
          throw new MediaError("MANIFEST_PARSE_ERROR",
                               "No supported " + type + " adaptations");
        }

        if (filteredAdaptations.length > 0) {
          acc[type] = filteredAdaptations;
        }
        return acc;
      }, {});

    if (!Array.isArray(this.adaptations.video) &&
        !Array.isArray(this.adaptations.audio))
    {
      throw new MediaError("MANIFEST_PARSE_ERROR",
                           "No supported audio and video tracks.");
    }

    this.start = args.start;

    if (args.duration !== undefined) {
      this.end = this.start + args.duration;
    }
    this.streamEvents = args.streamEvents === undefined ?
      [] :
      args.streamEvents;
  }

  /**
   * Returns every `Adaptations` (or `tracks`) linked to that Period, in an
   * Array.
   * @returns {Array.<Object>}
   */
  getAdaptations() : Adaptation[] {
    const adaptationsByType = this.adaptations;
    return objectValues(adaptationsByType).reduce<Adaptation[]>(
      // Note: the second case cannot happen. TS is just being dumb here
      (acc, adaptations) => adaptations != null ? acc.concat(adaptations) :
                                                  acc,
      []);
  }

  /**
   * Returns every `Adaptations` (or `tracks`) linked to that Period for a
   * given type.
   * @param {string} adaptationType
   * @returns {Array.<Object>}
   */
  getAdaptationsForType(adaptationType : IAdaptationType) : Adaptation[] {
    const adaptationsForType = this.adaptations[adaptationType];
    return adaptationsForType == null ? [] :
                                        adaptationsForType;
  }

  /**
   * Returns the Adaptation linked to the given ID.
   * @param {number|string} wantedId
   * @returns {Object|undefined}
   */
  getAdaptation(wantedId : string) : Adaptation|undefined {
    return arrayFind(this.getAdaptations(), ({ id }) => wantedId === id);
  }

  /**
   * Returns Adaptations that contain Representations in supported codecs.
   * @param {string|undefined} type - If set filter on a specific Adaptation's
   * type. Will return for all types if `undefined`.
   * @returns {Array.<Adaptation>}
   */
  getSupportedAdaptations(type? : IAdaptationType) : Adaptation[] {
    if (type === undefined) {
      return this.getAdaptations().filter(ada => {
        return ada.isSupported;
      });
    }
    const adaptationsForType = this.adaptations[type];
    if (adaptationsForType === undefined) {
      return [];
    }
    return adaptationsForType.filter(ada => {
      return ada.isSupported;
    });
  }

  /**
   * Get the last position where there shall be content on the period, whatever
   * is the chosen adaptation
   * @returns {null | number}
   */
  getContentEnd(): null | number {
    let maximumPositionFromAdaptations: null | number = null;
    const { video, audio } = this.adaptations;
    if (video !== undefined) {
      for (let i = 0; i < video.length; i++) {
        const videoAdaptation = video[i];
        const lastPosition = videoAdaptation.getContentEnd();
        if (lastPosition === null) {
          return null;
        }
        if (isNullOrUndefined(maximumPositionFromAdaptations) ||
            lastPosition < maximumPositionFromAdaptations) {
          maximumPositionFromAdaptations = lastPosition;
        }
      }
    }
    if (audio !== undefined) {
      for (let i = 0; i < audio.length; i++) {
        const audioAdaptation = audio[i];
        const lastPosition = audioAdaptation.getContentEnd();
        if (lastPosition === null) {
          return null;
        }
        if (isNullOrUndefined(maximumPositionFromAdaptations) ||
            lastPosition < maximumPositionFromAdaptations) {
          maximumPositionFromAdaptations = lastPosition;
        }
      }
    }
    if (maximumPositionFromAdaptations === null) {
      return null;
    }
    if (this.end === undefined) {
      return maximumPositionFromAdaptations;
    }
    return Math.min(maximumPositionFromAdaptations, this.end);
  }

  /**
   * Get the first position where there shall be content on the period, whatever
   * is the chosen adaptation
   * @returns {number | null}
   */
  getContentStart(): number | null {
    let minimumPositionFromAdaptations: null | number = null;
    const { video, audio } = this.adaptations;
    if (video !== undefined) {
      for (let i = 0; i < video.length; i++) {
        const videoAdaptation = video[i];
        const firstPosition = videoAdaptation.getContentStart();
        if (firstPosition === null) {
          return null;
        }
        if (isNullOrUndefined(minimumPositionFromAdaptations) ||
            firstPosition > minimumPositionFromAdaptations) {
          minimumPositionFromAdaptations = firstPosition;
        }
      }
    }
    if (audio !== undefined) {
      for (let i = 0; i < audio.length; i++) {
        const audioAdaptation = audio[i];
        const firstPosition = audioAdaptation.getContentStart();
        if (firstPosition === null) {
          return null;
        }
        if (isNullOrUndefined(minimumPositionFromAdaptations) ||
            firstPosition > minimumPositionFromAdaptations) {
          minimumPositionFromAdaptations = firstPosition;
        }
      }
    }
    if (minimumPositionFromAdaptations === null) {
      return null;
    }
    if (this.start === undefined) {
      return minimumPositionFromAdaptations;
    }
    return Math.max(minimumPositionFromAdaptations, this.start);
  }
}
