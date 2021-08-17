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
var __spreadArray = (this && this.__spreadArray) || function (to, from) {
    for (var i = 0, il = from.length, j = to.length; i < il; i++, j++)
        to[j] = from[i];
    return to;
};
import { MediaError } from "../../../errors";
import log from "../../../log";
import { getIndexSegmentEnd, } from "./index_helpers";
/**
 * Update a complete array of segments in a given timeline with a [generally]
 * smaller but [generally] newer set of segments.
 * @param {Array.<Object>} oldTimeline
 * @param {Array.<Object>} newTimeline
 */
export default function updateSegmentTimeline(oldTimeline, newTimeline) {
    var prevTimelineLength = oldTimeline.length;
    if (oldTimeline.length === 0) {
        oldTimeline.splice.apply(oldTimeline, __spreadArray([0, prevTimelineLength], newTimeline));
        return;
    }
    if (newTimeline.length === 0) {
        return;
    }
    var newIndexStart = newTimeline[0].start;
    var oldLastElt = oldTimeline[prevTimelineLength - 1];
    var oldIndexEnd = getIndexSegmentEnd(oldLastElt, newTimeline[0]);
    if (oldIndexEnd < newIndexStart) {
        throw new MediaError("MANIFEST_UPDATE_ERROR", "Cannot perform partial update: not enough data");
    }
    for (var i = prevTimelineLength - 1; i >= 0; i--) {
        var currStart = oldTimeline[i].start;
        if (currStart === newIndexStart) {
            // replace that one and those after it
            oldTimeline.splice.apply(oldTimeline, __spreadArray([i, prevTimelineLength - i], newTimeline));
            return;
        }
        else if (currStart < newIndexStart) { // first to be before
            var currElt = oldTimeline[i];
            if (currElt.start + currElt.duration > newIndexStart) {
                // the new Manifest overlaps a previous segment (weird). Remove the latter.
                log.warn("RepresentationIndex: Manifest update removed previous segments");
                oldTimeline.splice.apply(oldTimeline, __spreadArray([i, prevTimelineLength - i], newTimeline));
                return;
            }
            else if (currElt.repeatCount === undefined || currElt.repeatCount <= 0) {
                if (currElt.repeatCount < 0) {
                    currElt.repeatCount = Math.floor((newIndexStart - currElt.start) /
                        currElt.duration) - 1;
                }
                oldTimeline.splice.apply(oldTimeline, __spreadArray([i + 1, prevTimelineLength - (i + 1)], newTimeline));
                return;
            }
            // else, there is a positive repeat we might want to update
            var eltLastTime = currElt.start + currElt.duration * (currElt.repeatCount + 1);
            if (eltLastTime <= newIndexStart) { // our new index comes directly after
                // put it after this one
                oldTimeline.splice.apply(// our new index comes directly after
                oldTimeline, __spreadArray([i + 1, prevTimelineLength - (i + 1)], newTimeline));
                return;
            }
            var newCurrRepeat = ((newIndexStart - currElt.start) / currElt.duration) - 1;
            if (newCurrRepeat % 1 === 0 && currElt.duration === newTimeline[0].duration) {
                var newRepeatCount = newTimeline[0].repeatCount < 0 ?
                    -1 : // === maximum possible repeat
                    newTimeline[0].repeatCount + newCurrRepeat + 1;
                // replace that one and those after it
                oldTimeline.splice.apply(oldTimeline, __spreadArray([i, prevTimelineLength - i], newTimeline));
                oldTimeline[i].start = currElt.start;
                oldTimeline[i].repeatCount = newRepeatCount;
                return;
            }
            log.warn("RepresentationIndex: Manifest update removed previous segments");
            oldTimeline[i].repeatCount = Math.floor(newCurrRepeat);
            // put it after this one
            oldTimeline.splice.apply(oldTimeline, __spreadArray([i + 1, prevTimelineLength - (i + 1)], newTimeline));
            return;
        }
    }
    // if we got here, it means that every segments in the previous manifest are
    // after the new one. This is unusual.
    // Either the new one has more depth or it's an older one.
    var prevLastElt = oldTimeline[oldTimeline.length - 1];
    var newLastElt = newTimeline[newTimeline.length - 1];
    if (prevLastElt.repeatCount !== undefined && prevLastElt.repeatCount < 0) {
        if (prevLastElt.start > newLastElt.start) {
            log.warn("RepresentationIndex: The new index is older than the previous one");
            return; // the old comes after
        }
        else { // the new has more depth
            log.warn("RepresentationIndex: The new index is \"bigger\" than the previous one");
            oldTimeline.splice.apply(oldTimeline, __spreadArray([0, prevTimelineLength], newTimeline));
            return;
        }
    }
    var prevLastTime = prevLastElt.start + prevLastElt.duration *
        (prevLastElt.repeatCount + 1);
    var newLastTime = newLastElt.start + newLastElt.duration *
        (newLastElt.repeatCount + 1);
    if (prevLastTime >= newLastTime) {
        log.warn("RepresentationIndex: The new index is older than the previous one");
        return; // the old comes after
    }
    // the new one has more depth. full update
    log.warn("RepresentationIndex: The new index is \"bigger\" than the previous one");
    oldTimeline.splice.apply(oldTimeline, __spreadArray([0, prevTimelineLength], newTimeline));
    return;
}
