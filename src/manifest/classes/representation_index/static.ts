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
import type { IRepresentationIndex, ISegment } from "./types";

export interface IStaticRepresentationIndexInfos {
  media: string;
}

/**
 * Simple RepresentationIndex implementation for static files.
 * @class StaticRepresentationIndex
 */
export default class StaticRepresentationIndex implements IRepresentationIndex {
  /** URL at which the content is available. */
  private readonly _url: string;

  /**
   * @param {Object} infos
   */
  constructor(infos: IStaticRepresentationIndexInfos) {
    this._url = infos.media;
  }

  /**
   * Static contents do not have any initialization segments.
   * Just return null.
   * @returns {null}
   */
  getInitSegment(): null {
    return null;
  }

  /**
   * Returns the only Segment available here.
   * @returns {Array.<Object>}
   */
  getSegments(): ISegment[] {
    return [
      {
        id: "0",
        isInit: false,
        number: 0,
        url: this._url,
        time: 0,
        end: Number.MAX_VALUE,
        duration: Number.MAX_VALUE,
        complete: true,
        privateInfos: {},
        timescale: 1,
      },
    ];
  }

  /**
   * Returns first position in index.
   * @returns {undefined}
   */
  getFirstAvailablePosition(): undefined {
    return;
  }

  /**
   * Returns last position in index.
   * @returns {undefined}
   */
  getLastAvailablePosition(): undefined {
    return;
  }

  /**
   * Returns the absolute end in seconds this RepresentationIndex can reach once
   * all segments are available.
   * @returns {number|null|undefined}
   */
  getEnd(): undefined {
    return;
  }

  /**
   * Returns:
   *   - `true` if in the given time interval, at least one new segment is
   *     expected to be available in the future.
   *   - `false` either if all segments in that time interval are already
   *     available for download or if none will ever be available for it.
   *   - `undefined` when it is not possible to tell.
   *
   * Always `false` in a `StaticRepresentationIndex` because all segments should
   * be directly available.
   * @returns {boolean}
   */
  awaitSegmentBetween(): false {
    return false;
  }

  /**
   * Returns false as a static file never need to be refreshed.
   * @returns {Boolean}
   */
  shouldRefresh(): false {
    return false;
  }

  /**
   * @returns {null}
   */
  checkDiscontinuity(): null {
    return null;
  }

  /**
   * Returns true as a static file should never need lose availability.
   * @returns {Boolean}
   */
  isSegmentStillAvailable(): true {
    return true;
  }

  /**
   * @returns {Boolean}
   */
  canBeOutOfSyncError(): false {
    return false;
  }

  /**
   * @returns {Boolean}
   */
  isStillAwaitingFutureSegments(): false {
    return false;
  }

  /**
   * @returns {Boolean}
   */
  isInitialized(): true {
    return true;
  }

  initialize(): void {
    log.error("A `StaticRepresentationIndex` does not need to be initialized");
  }

  /**
   * Returns the `duration` of each segment in the context of its Manifest (i.e.
   * as the Manifest anounces them, actual segment duration may be different due
   * to approximations), in seconds.
   *
   * NOTE: we could here do a median or a mean but I chose to be lazy (and
   * more performant) by returning the duration of the first element instead.
   * As `isPrecize` is `false`, the rest of the code should be notified that
   * this is only an approximation.
   * @returns {number}
   */
  getTargetSegmentDuration(): { duration: number; isPrecize: boolean } | undefined {
    return {
      duration: Number.MAX_VALUE,
      isPrecize: false,
    };
  }

  addPredictedSegments(): void {
    log.warn("Cannot add predicted segments to a `StaticRepresentationIndex`");
  }

  _replace(): void {
    log.warn("Tried to replace a static RepresentationIndex");
  }

  _update(): void {
    log.warn("Tried to update a static RepresentationIndex");
  }
}
