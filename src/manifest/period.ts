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
  type ICustomError,
  MediaError,
} from "../errors";
import { type IParsedPeriod } from "../parsers/manifest";
import arrayFind from "../utils/array_find";
import objectValues from "../utils/object_values";
import {
  createAdaptationObject,
  type IRepresentationFilter,
} from "./adaptation";
import {
  type IAdaptation,
  type IAdaptationType,
  type IManifestAdaptations,
  type IPeriod,
} from "./types";

/**
 * Create an `IPeriod`-compatible object, which will declare the characteristics
 * of a content during a particular time period.
 * @param {Object} parsedPeriod
 * @param {function|undefined} representationFilter
 * @returns {Object}
 */
export function createPeriodObject(
  args : IParsedPeriod,
  representationFilter? : IRepresentationFilter | undefined
) : IPeriod {
  const contentWarnings : ICustomError[] = [];
  const adaptations = (Object.keys(args.adaptations) as IAdaptationType[])
    .reduce<IManifestAdaptations>((acc, type) => {
      const adaptationsForType = args.adaptations[type];
      if (adaptationsForType == null) {
        return acc;
      }
      const filteredAdaptations = adaptationsForType
        .map((adaptation) : IAdaptation => {
          const newAdaptation = createAdaptationObject(adaptation,
                                                       { representationFilter });
          if (newAdaptation.representations.length > 0 && !newAdaptation.isSupported) {
            const error =
              new MediaError("MANIFEST_INCOMPATIBLE_CODECS_ERROR",
                             "An Adaptation contains only incompatible codecs.");
            contentWarnings.push(error);
          }
          return newAdaptation;
        })
        .filter((adaptation) : adaptation is IAdaptation =>
          adaptation.representations.length > 0
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

  if (!Array.isArray(adaptations.video) &&
      !Array.isArray(adaptations.audio))
  {
    throw new MediaError("MANIFEST_PARSE_ERROR",
                         "No supported audio and video tracks.");
  }

  const end = args.duration !== undefined && args.start !== undefined ?
    args.duration + args.start :
    undefined;

  const periodObject : IPeriod = {
    id: args.id,
    adaptations,
    start: args.start,
    duration: args.duration,
    end,
    contentWarnings,
    streamEvents: args.streamEvents ?? [],
    getAdaptations,
    getAdaptationsForType,
    getAdaptation,
    getSupportedAdaptations,
  };
  return periodObject;

  /** @link IPeriod */
  function getAdaptations() : IAdaptation[] {
    return objectValues(adaptations).reduce<IAdaptation[]>(
      (acc, adaps) => acc.concat(adaps), []);
  }

  /** @link IPeriod */
  function getAdaptationsForType(adaptationType : IAdaptationType) : IAdaptation[] {
    const adaptationsForType = adaptations[adaptationType];
    return adaptationsForType == null ? [] :
                                        adaptationsForType;
  }

  /** @link IPeriod */
  function getAdaptation(wantedId : string) : IAdaptation|undefined {
    return arrayFind(getAdaptations(), ({ id: adapId }) => wantedId === adapId);
  }

  /** @link IPeriod */
  function getSupportedAdaptations(aType? : IAdaptationType) : IAdaptation[] {
    if (aType === undefined) {
      return getAdaptations().filter(ada => {
        return ada.isSupported;
      });
    }
    const adaptationsForType = adaptations[aType];
    if (adaptationsForType === undefined) {
      return [];
    }
    return adaptationsForType.filter(ada => {
      return ada.isSupported;
    });
  }
}
