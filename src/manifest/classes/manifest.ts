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

import { MediaError } from "../../errors";
import log from "../../log";
import { getCodecsWithUnknownSupport } from "../../main_thread/init/utils/update_manifest_codec_support";
import type { IParsedManifest } from "../../parsers/manifest";
import type { ITrackType, IRepresentationFilter, IPlayerError } from "../../public_types";
import arrayFind from "../../utils/array_find";
import EventEmitter from "../../utils/event_emitter";
import idGenerator from "../../utils/id_generator";
import warnOnce from "../../utils/warn_once";
import type {
  IAdaptationMetadata,
  IManifestMetadata,
  IPeriodMetadata,
  IRepresentationMetadata,
} from "../types";
import { ManifestMetadataFormat } from "../types";
import {
  getLivePosition,
  getMaximumSafePosition,
  getMinimumSafePosition,
  getPeriodForTime,
  getPeriodAfter,
  toTaggedTrack,
} from "../utils";
import type Adaptation from "./adaptation";
import CodecSupportCache from "./codec_support_cache";
import type { ICodecSupportInfo } from "./codec_support_cache";
import type { IManifestAdaptations } from "./period";
import Period from "./period";
import type Representation from "./representation";
import { MANIFEST_UPDATE_TYPE } from "./types";
import type { IPeriodsUpdateResult } from "./update_periods";
import { replacePeriods, updatePeriods } from "./update_periods";

const generateNewManifestId = idGenerator();

/** Options given to the `Manifest` constructor. */
interface IManifestParsingOptions {
  /** External callback peforming an automatic filtering of wanted Representations. */
  representationFilter?: IRepresentationFilter | undefined;
  /** Optional URL that points to a shorter version of the Manifest used
   * for updates only. When using this URL for refresh, the manifest will be
   * updated with the partial update type. If this URL is undefined, then the
   * manifest will be updated fully when it needs to be refreshed, and it will
   * fetched through the original URL. */
  manifestUpdateUrl?: string | undefined;
}

/** Representation affected by a `decipherabilityUpdate` event. */
export interface IUpdatedRepresentationInfo {
  manifest: IManifestMetadata;
  period: IPeriodMetadata;
  adaptation: IAdaptationMetadata;
  representation: IRepresentationMetadata;
}

/** Events emitted by a `Manifest` instance */
export interface IManifestEvents {
  /** The Manifest has been updated */
  manifestUpdate: IPeriodsUpdateResult;
  /** Some Representation's decipherability status has been updated */
  decipherabilityUpdate: IUpdatedRepresentationInfo[];
  /** Some Representation's support status has been updated */
  supportUpdate: null;
  /**
   * Some `Representation`'s avoidance status has been updated, meaning that we
   * might have to avoid playing them due to playback issues.
   */
  representationAvoidanceUpdate: IUpdatedRepresentationInfo[];
}

/**
 * Normalized Manifest structure.
 *
 * Details the current content being played:
 *   - the duration of the content
 *   - the available tracks
 *   - the available qualities
 *   - the segments defined in those qualities
 *   - ...
 * while staying agnostic of the transport protocol used (Smooth, DASH etc.).
 *
 * The Manifest and its contained information can evolve over time (like when
 * updating a dynamic manifest or when right management forbid some tracks from
 * being played).
 * To perform actions on those changes, any module using this Manifest can
 * listen to its sent events and react accordingly.
 *
 * @class Manifest
 */
export default class Manifest
  extends EventEmitter<IManifestEvents>
  implements IManifestMetadata
{
  public manifestFormat: ManifestMetadataFormat.Class;

  /**
   * ID uniquely identifying this Manifest.
   * No two Manifests should have this ID.
   * This ID is automatically calculated each time a `Manifest` instance is
   * created.
   */
  public readonly id: string;

  /**
   * Type of transport used by this Manifest (e.g. `"dash"` or `"smooth"`).
   *
   * TODO This should never be needed as this structure is transport-agnostic.
   * But it is specified in the Manifest API. Deprecate?
   */
  public transport: string;

  /**
   * List every Period in that Manifest chronologically (from start to end).
   * A Period contains information about the content available for a specific
   * period of time.
   */
  public readonly periods: Period[];

  /**
   * When that promise resolves, the whole Manifest needs to be requested again
   * so it can be refreshed.
   */
  public expired: Promise<void> | null;

  /**
   * Deprecated. Equivalent to `manifest.periods[0].adaptations`.
   * @deprecated
   */
  public adaptations: IManifestAdaptations;

  /**
   * If true, the Manifest can evolve over time:
   * New segments can become available in the future, properties of the manifest
   * can change...
   */
  public isDynamic: boolean;

  /**
   * If true, this Manifest describes a live content.
   * A live content is a specific kind of content where you want to play very
   * close to the maximum position (here called the "live edge").
   * E.g., a TV channel is a live content.
   */
  public isLive: boolean;

  /**
   * If `true`, no more periods will be added after the current last manifest's
   * Period.
   * `false` if we know that more Period is coming or if we don't know.
   */
  public isLastPeriodKnown: boolean;

  /*
   * Every URI linking to that Manifest.
   * They can be used for refreshing the Manifest.
   * Listed from the most important to the least important.
   */
  public uris: string[];

  /** Optional URL that points to a shorter version of the Manifest used
   * for updates only. */
  public updateUrl: string | undefined;

  /**
   * Suggested delay from the "live edge" (i.e. the position corresponding to
   * the current broadcast for a live content) the content is suggested to start
   * from.
   * This only applies to live contents.
   */
  public suggestedPresentationDelay: number | undefined;

  /**
   * Amount of time, in seconds, this Manifest is valid from the time when it
   * has been fetched.
   * If no lifetime is set, this Manifest does not become invalid after an
   * amount of time.
   */
  public lifetime: number | undefined;

  /**
   * Minimum time, in seconds, at which a segment defined in the Manifest
   * can begin.
   * This is also used as an offset for live content to apply to a segment's
   * time.
   */
  public availabilityStartTime: number | undefined;

  /**
   * It specifies the wall-clock time when the manifest was generated and published
   * at the origin server. It is present in order to identify different versions
   * of manifest instances.
   */
  public publishTime: number | undefined;

  /*
   * Difference between the server's clock in milliseconds and the
   * monotonically-raising timestamp used by the RxPlayer.
   * This property allows to calculate the server time at any moment.
   * `undefined` if we did not obtain the server's time
   */
  public clockOffset: number | undefined;

  /**
   * Data allowing to calculate the minimum and maximum seekable positions at
   * any given time.
   */
  public timeBounds: {
    /**
     * This is the theoretical minimum playable position on the content
     * regardless of the current Adaptation chosen, as estimated at parsing
     * time.
     * `undefined` if unknown.
     *
     * More technically, the `minimumSafePosition` is the maximum between all
     * the minimum positions reachable in any of the audio and video Adaptation.
     *
     * Together with `timeshiftDepth` and the `maximumTimeData` object, this
     * value allows to compute at any time the minimum seekable time:
     *
     *   - if `timeshiftDepth` is not set, the minimum seekable time is a
     *     constant that corresponds to this value.
     *
     *    - if `timeshiftDepth` is set, `minimumSafePosition` will act as the
     *      absolute minimum seekable time we can never seek below, even when
     *      `timeshiftDepth` indicates a possible lower position.
     *      This becomes useful for example when playing live contents which -
     *      despite having a large window depth - just begun and as such only
     *      have a few segment available for now.
     *      Here, `minimumSafePosition` would be the start time of the initial
     *      segment, and `timeshiftDepth` would be the whole depth that will
     *      become available once enough segments have been generated.
     */
    minimumSafePosition?: number | undefined;
    /**
     * Some dynamic contents have the concept of a "window depth" (or "buffer
     * depth") which allows to set a minimum position for all reachable
     * segments, in function of the maximum reachable position.
     *
     * This is justified by the fact that a server might want to remove older
     * segments when new ones become available, to free storage size.
     *
     * If this value is set to a number, it is the amount of time in seconds
     * that needs to be substracted from the current maximum seekable position,
     * to obtain the minimum seekable position.
     * As such, this value evolves at the same rate than the maximum position
     * does (if it does at all).
     *
     * If set to `null`, this content has no concept of a "window depth".
     */
    timeshiftDepth: number | null;
    /** Data allowing to calculate the maximum playable position at any given time. */
    maximumTimeData: {
      /**
       * Current position representing live content.
       * Only makes sense for un-ended live contents.
       *
       * `undefined` if unknown or if it doesn't make sense in the current context.
       */
      livePosition: number | undefined;
      /**
       * Whether the maximum positions should evolve linearly over time.
       *
       * If set to `true`, the maximum seekable position continuously increase at
       * the same rate than the time since `time` does.
       */
      isLinear: boolean;
      /**
       * This is the theoretical maximum playable position on the content,
       * regardless of the current Adaptation chosen, as estimated at parsing
       * time.
       *
       * More technically, the `maximumSafePosition` is the minimum between all
       * attributes indicating the duration of the content in the Manifest.
       *
       * That is the minimum between:
       *   - The Manifest original attributes relative to its duration
       *   - The minimum between all known maximum audio positions
       *   - The minimum between all known maximum video positions
       *
       * This can for example be understood as the safe maximum playable
       * position through all possible tacks.
       */
      maximumSafePosition: number;
      /**
       * `Monotically-increasing timestamp used by the RxPlayer at the time both
       * `maximumSafePosition` and `livePosition` were calculated.
       * This can be used to retrieve a new maximum position from them when they
       * linearly evolves over time (see `isLinear` property).
       */
      time: number;
    };
  };

  /**
   * Caches the information if a codec is supported or not in the context of the
   * current content.
   */
  private _cachedCodecSupport: CodecSupportCache;

  /**
   * Construct a Manifest instance from a parsed Manifest object (as returned by
   * Manifest parsers) and options.
   *
   * Some minor errors can arise during that construction. `warnings`
   * will contain all such errors, in the order they have been encountered.
   * @param {Object} parsedManifest
   * @param {Object} options
   * @param {Array.<Object>} warnings - After construction, will be optionally
   * filled by errors expressing minor issues seen while parsing the Manifest.
   */
  constructor(
    parsedManifest: IParsedManifest,
    options: IManifestParsingOptions,
    warnings: IPlayerError[],
  ) {
    super();
    const { representationFilter, manifestUpdateUrl } = options;
    this.manifestFormat = ManifestMetadataFormat.Class;
    this.id = generateNewManifestId();
    this.expired = parsedManifest.expired ?? null;
    this.transport = parsedManifest.transportType;
    this.clockOffset = parsedManifest.clockOffset;
    this._cachedCodecSupport = new CodecSupportCache([]);

    const unsupportedAdaptations: Adaptation[] = [];
    this.periods = parsedManifest.periods
      .map((parsedPeriod) => {
        const period = new Period(
          parsedPeriod,
          unsupportedAdaptations,
          this._cachedCodecSupport,
          representationFilter,
        );
        return period;
      })
      .sort((a, b) => a.start - b.start);

    if (unsupportedAdaptations.length > 0) {
      const error = new MediaError(
        "MANIFEST_INCOMPATIBLE_CODECS_ERROR",
        "An Adaptation contains only incompatible codecs.",
        { tracks: unsupportedAdaptations.map(toTaggedTrack) },
      );
      warnings.push(error);
    }

    /**
     * @deprecated It is here to ensure compatibility with the way the
     * v3.x.x manages adaptations at the Manifest level
     */
    this.adaptations = this.periods[0] === undefined ? {} : this.periods[0].adaptations;

    this.timeBounds = parsedManifest.timeBounds;
    this.isDynamic = parsedManifest.isDynamic;
    this.isLive = parsedManifest.isLive;
    this.isLastPeriodKnown = parsedManifest.isLastPeriodKnown;
    this.uris = parsedManifest.uris === undefined ? [] : parsedManifest.uris;

    this.updateUrl = manifestUpdateUrl;
    this.lifetime = parsedManifest.lifetime;
    this.clockOffset = parsedManifest.clockOffset;
    this.suggestedPresentationDelay = parsedManifest.suggestedPresentationDelay;
    this.availabilityStartTime = parsedManifest.availabilityStartTime;
    this.publishTime = parsedManifest.publishTime;
  }

  /**
   * Some environments (e.g. in a WebWorker) may not have the capability to know
   * if a mimetype+codec combination is supported on the current platform.
   *
   * Calling `updateCodecSupport` manually once the codecs supported are known
   * by the current environnement allows to work-around this issue.
   *
   * @param {Array<Object>} [updatedCodecSupportInfo]
   * @returns {Error|null} - Refreshing codec support might reveal that some
   * `Adaptation` don't have any of their `Representation`s supported.
   * In that case, an error object will be created and returned, so you can
   * e.g. later emit it as a warning through the RxPlayer API.
   */
  public updateCodecSupport(
    updatedCodecSupportInfo: ICodecSupportInfo[] = [],
  ): MediaError | null {
    if (updatedCodecSupportInfo.length === 0) {
      return null;
    }

    this._cachedCodecSupport.addCodecs(updatedCodecSupportInfo);
    const unsupportedAdaptations: Adaptation[] = [];
    for (const period of this.periods) {
      period.refreshCodecSupport(unsupportedAdaptations, this._cachedCodecSupport);
    }
    this.trigger("supportUpdate", null);
    if (unsupportedAdaptations.length > 0) {
      return new MediaError(
        "MANIFEST_INCOMPATIBLE_CODECS_ERROR",
        "An Adaptation contains only incompatible codecs.",
        { tracks: unsupportedAdaptations.map(toTaggedTrack) },
      );
    }
    return null;
  }

  /**
   * Returns the Period corresponding to the given `id`.
   * Returns `undefined` if there is none.
   * @param {string} id
   * @returns {Object|undefined}
   */
  public getPeriod(id: string): Period | undefined {
    return arrayFind(this.periods, (period) => {
      return id === period.id;
    });
  }

  /**
   * Returns the Period encountered at the given time.
   * Returns `undefined` if there is no Period exactly at the given time.
   * @param {number} time
   * @returns {Object|undefined}
   */
  public getPeriodForTime(time: number): Period | undefined {
    return getPeriodForTime(this, time);
  }

  /**
   * Returns the first Period starting strictly after the given time.
   * Returns `undefined` if there is no Period starting after that time.
   * @param {number} time
   * @returns {Object|undefined}
   */
  public getNextPeriod(time: number): Period | undefined {
    return arrayFind(this.periods, (period) => {
      return period.start > time;
    });
  }

  /**
   * Returns the Period coming chronologically just after another given Period.
   * Returns `undefined` if not found.
   * @param {Object} period
   * @returns {Object|null}
   */
  public getPeriodAfter(period: Period): Period | null {
    return getPeriodAfter(this, period);
  }

  /**
   * Returns the most important URL from which the Manifest can be refreshed.
   * `undefined` if no URL is found.
   * @returns {Array.<string>}
   */
  public getUrls(): string[] {
    return this.uris;
  }

  /**
   * Update the current Manifest properties by giving a new updated version.
   * This instance will be updated with the new information coming from it.
   * @param {Object} newManifest
   */
  public replace(newManifest: Manifest): void {
    this._performUpdate(newManifest, MANIFEST_UPDATE_TYPE.Full);
  }

  /**
   * Update the current Manifest properties by giving a new but shorter version
   * of it.
   * This instance will add the new information coming from it and will
   * automatically clean old Periods that shouldn't be available anymore.
   *
   * /!\ Throws if the given Manifest cannot be used or is not sufficient to
   * update the Manifest.
   * @param {Object} newManifest
   */
  public update(newManifest: Manifest): void {
    this._performUpdate(newManifest, MANIFEST_UPDATE_TYPE.Partial);
  }

  /**
   * Returns the theoretical minimum playable position on the content
   * regardless of the current Adaptation chosen, as estimated at parsing
   * time.
   * @returns {number}
   */
  public getMinimumSafePosition(): number {
    return getMinimumSafePosition(this);
  }

  /**
   * Get the position of the live edge - that is, the position of what is
   * currently being broadcasted, in seconds.
   * @returns {number|undefined}
   */
  public getLivePosition(): number | undefined {
    return getLivePosition(this);
  }

  /**
   * Returns the theoretical maximum playable position on the content
   * regardless of the current Adaptation chosen, as estimated at parsing
   * time.
   */
  public getMaximumSafePosition(): number {
    return getMaximumSafePosition(this);
  }

  public updateCodecSupportList(cachedCodecSupport: CodecSupportCache) {
    this._cachedCodecSupport = cachedCodecSupport;
  }

  /**
   * Look in the Manifest for Representations linked to the given key ID,
   * and mark them as being impossible to decrypt.
   * Then trigger a "decipherabilityUpdate" event to notify everyone of the
   * changes performed.
   * @param {Function} isDecipherableCb
   */
  public updateRepresentationsDeciperability(
    isDecipherableCb: (content: {
      manifest: Manifest;
      period: Period;
      adaptation: Adaptation;
      representation: Representation;
    }) => boolean | undefined,
  ): void {
    const updates = updateDeciperability(this, isDecipherableCb);
    if (updates.length > 0) {
      this.trigger("decipherabilityUpdate", updates);
    }
  }

  /**
   * Indicate that some `Representation` needs to be avoided due to playback
   * issues.
   * @param {Array.<Object>} items
   */
  public addRepresentationsToAvoid(
    items: Array<{
      period: Period;
      adaptation: Adaptation;
      representation: Representation;
    }>,
  ) {
    const updates = [];
    for (const item of items) {
      const period = this.getPeriod(item.period.id);
      if (period === undefined) {
        continue;
      }
      const adaptation = period.getAdaptation(item.adaptation.id);
      if (adaptation === undefined) {
        continue;
      }
      const representation = adaptation.getRepresentation(item.representation.id);
      if (representation === undefined) {
        continue;
      }
      representation.shouldBeAvoided = true;
      updates.push({
        manifest: this,
        period,
        adaptation,
        representation,
      });
    }
    if (updates.length > 0) {
      this.trigger("representationAvoidanceUpdate", updates);
    }
  }

  /**
   * @deprecated only returns adaptations for the first period
   * @returns {Array.<Object>}
   */
  public getAdaptations(): Adaptation[] {
    warnOnce(
      "manifest.getAdaptations() is deprecated." +
        " Please use manifest.period[].getAdaptations() instead",
    );
    const firstPeriod = this.periods[0];
    if (firstPeriod === undefined) {
      return [];
    }
    const adaptationsByType = firstPeriod.adaptations;
    const adaptationsList: Adaptation[] = [];
    for (const adaptationType in adaptationsByType) {
      if (Object.prototype.hasOwnProperty.call(adaptationsByType, adaptationType)) {
        const adaptations = adaptationsByType[
          adaptationType as ITrackType
        ] as Adaptation[];
        adaptationsList.push(...adaptations);
      }
    }
    return adaptationsList;
  }

  /**
   * @deprecated only returns adaptations for the first period
   * @returns {Array.<Object>}
   */
  public getAdaptationsForType(adaptationType: ITrackType): Adaptation[] {
    warnOnce(
      "manifest.getAdaptationsForType(type) is deprecated." +
        " Please use manifest.period[].getAdaptationsForType(type) instead",
    );
    const firstPeriod = this.periods[0];
    if (firstPeriod === undefined) {
      return [];
    }
    const adaptationsForType = firstPeriod.adaptations[adaptationType];
    return adaptationsForType === undefined ? [] : adaptationsForType;
  }

  /**
   * @deprecated only returns adaptations for the first period
   * @returns {Array.<Object>}
   */
  public getAdaptation(wantedId: number | string): Adaptation | undefined {
    warnOnce(
      "manifest.getAdaptation(id) is deprecated." +
        " Please use manifest.period[].getAdaptation(id) instead",
    );
    return arrayFind(this.getAdaptations(), ({ id }) => wantedId === id);
  }

  /**
   * Format the current `Manifest`'s properties into a
   * `IManifestMetadata` format which can better be communicated through
   * another thread.
   *
   * Please bear in mind however that the returned object will not be updated
   * when the current `Manifest` instance is updated, it is only a
   * snapshot at the current time.
   *
   * If you want to keep that data up-to-date with the current `Manifest`
   * instance, you will have to do it yourself.
   *
   * @returns {Object}
   */
  public getMetadataSnapshot(): IManifestMetadata {
    const periods: IPeriodMetadata[] = [];
    for (const period of this.periods) {
      periods.push(period.getMetadataSnapshot());
    }

    return {
      manifestFormat: ManifestMetadataFormat.MetadataObject,
      id: this.id,
      periods,
      isDynamic: this.isDynamic,
      isLive: this.isLive,
      isLastPeriodKnown: this.isLastPeriodKnown,
      suggestedPresentationDelay: this.suggestedPresentationDelay,
      clockOffset: this.clockOffset,
      uris: this.uris,
      availabilityStartTime: this.availabilityStartTime,
      timeBounds: this.timeBounds,
    };
  }

  /**
   * Returns a list of all codecs that the support is not known yet.
   * If a representation with (`isSupported`) is undefined, we consider the
   * codec support as unknown.
   *
   * This function iterates through all periods, adaptations, and representations,
   * and collects unknown codecs.
   *
   * @returns {Array} The list of codecs with unknown support status.
   */
  public getCodecsWithUnknownSupport(): Array<{ mimeType: string; codec: string }> {
    return getCodecsWithUnknownSupport(this);
  }

  /**
   * @param {Object} newManifest
   * @param {number} updateType
   */
  private _performUpdate(newManifest: Manifest, updateType: MANIFEST_UPDATE_TYPE): void {
    this.availabilityStartTime = newManifest.availabilityStartTime;
    this.expired = newManifest.expired;
    this.isDynamic = newManifest.isDynamic;
    this.isLive = newManifest.isLive;
    this.isLastPeriodKnown = newManifest.isLastPeriodKnown;
    this.lifetime = newManifest.lifetime;
    this.clockOffset = newManifest.clockOffset;
    this.suggestedPresentationDelay = newManifest.suggestedPresentationDelay;
    this.transport = newManifest.transport;
    this.publishTime = newManifest.publishTime;

    let updatedPeriodsResult;
    if (updateType === MANIFEST_UPDATE_TYPE.Full) {
      this.timeBounds = newManifest.timeBounds;
      this.uris = newManifest.uris;
      updatedPeriodsResult = replacePeriods(this.periods, newManifest.periods);
    } else {
      this.timeBounds.maximumTimeData = newManifest.timeBounds.maximumTimeData;
      this.updateUrl = newManifest.uris[0];
      updatedPeriodsResult = updatePeriods(this.periods, newManifest.periods);

      // Partial updates do not remove old Periods.
      // This can become a memory problem when playing a content long enough.
      // Let's clean manually Periods behind the minimum possible position.
      const min = this.getMinimumSafePosition();
      while (this.periods.length > 0) {
        const period = this.periods[0];
        if (period.end === undefined || period.end > min) {
          break;
        }
        this.periods.shift();
      }
    }

    this.updateCodecSupport();

    // Re-set this.adaptations for retro-compatibility in v3.x.x
    this.adaptations = this.periods[0] === undefined ? {} : this.periods[0].adaptations;

    // Let's trigger events at the end, as those can trigger side-effects.
    // We do not want the current Manifest object to be incomplete when those
    // happen.
    this.trigger("manifestUpdate", updatedPeriodsResult);
  }
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
function updateDeciperability(
  manifest: Manifest,
  isDecipherable: (content: {
    manifest: Manifest;
    period: Period;
    adaptation: Adaptation;
    representation: Representation;
  }) => boolean | undefined,
): IUpdatedRepresentationInfo[] {
  const updates: IUpdatedRepresentationInfo[] = [];
  for (const period of manifest.periods) {
    for (const adaptation of period.getAdaptations()) {
      let hasOnlyUndecipherableRepresentations = true;
      for (const representation of adaptation.representations) {
        const content = { manifest, period, adaptation, representation };
        const result = isDecipherable(content);
        if (result !== false) {
          hasOnlyUndecipherableRepresentations = false;
        }
        if (result !== representation.decipherable) {
          updates.push(content);
          representation.decipherable = result;
          if (result === true) {
            adaptation.supportStatus.isDecipherable = true;
          } else if (
            result === undefined &&
            adaptation.supportStatus.isDecipherable === false
          ) {
            adaptation.supportStatus.isDecipherable = undefined;
          }
          log.debug(
            `Decipherability changed for "${representation.id}"`,
            `(${representation.bitrate})`,
            String(representation.decipherable),
          );
        }
      }
      if (hasOnlyUndecipherableRepresentations) {
        adaptation.supportStatus.isDecipherable = false;
      }
    }
  }
  return updates;
}

export type { IManifestParsingOptions };
