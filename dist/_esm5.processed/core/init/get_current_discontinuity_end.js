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
import { distinctUntilChanged, filter, map, } from "rxjs/operators";
import { isPlaybackStuck } from "../../compat";
import config from "../../config";
import log from "../../log";
import { getNextRangeGap } from "../../utils/ranges";
var BUFFER_DISCONTINUITY_THRESHOLD = config.BUFFER_DISCONTINUITY_THRESHOLD;
/**
 * Perform various checks about discontinuities during playback.
 * If a discontinuity is encountered, return the theorical end of
 * discontinuity.
 * @param {Observable} clock$
 * @param {Object} manifest
 * @returns {Observable}
 */
export default function getCurrentDiscontinuityEnd(clock$, manifest) {
    return clock$.pipe(filter(function (_a) {
        var stalled = _a.stalled;
        return stalled !== null;
    }), map(function (tick) {
        var buffered = tick.buffered, position = tick.position, currentRange = tick.currentRange, state = tick.state, stalled = tick.stalled;
        var nextBufferRangeGap = getNextRangeGap(buffered, position);
        // 1: Is it a browser bug? -> force seek at the same current time
        if (isPlaybackStuck(position, currentRange, state, stalled !== null)) {
            log.warn("Init: After freeze seek", position, currentRange);
            return position;
            // 2. Is it a short discontinuity in buffer ? -> Seek at the beginning of the
            //                                               next range
            //
            // Discontinuity check in case we are close a buffered range but still
            // calculate a stalled state. This is useful for some
            // implementation that might drop an injected segment, or in
            // case of small discontinuity in the content.
        }
        else if (nextBufferRangeGap < BUFFER_DISCONTINUITY_THRESHOLD) {
            var seekTo = (position + nextBufferRangeGap + 1 / 60);
            return seekTo;
        }
        // 3. Is it a discontinuity between periods ? -> Seek at the beginning of the
        //                                               next period
        var currentPeriod = manifest.getPeriodForTime(position);
        if (currentPeriod !== undefined) {
            var nextPeriod = manifest.getPeriodAfter(currentPeriod);
            if (currentPeriod.end !== undefined &&
                nextPeriod !== undefined &&
                position > (currentPeriod.end - 1) &&
                position <= nextPeriod.start &&
                (nextPeriod.start - currentPeriod.end) < 0.5) {
                return nextPeriod.start;
            }
        }
    }), filter(function (x) { return x !== undefined; }), distinctUntilChanged());
}
