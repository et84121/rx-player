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
// eslint-disable-next-line max-len
import config from "../../../config";
import log from "../../../log";
import { areSameContent, } from "../../../manifest";
import objectAssign from "../../../utils/object_assign";
var CONTENT_REPLACEMENT_PADDING = config.CONTENT_REPLACEMENT_PADDING, BITRATE_REBUFFERING_RATIO = config.BITRATE_REBUFFERING_RATIO, MAX_TIME_MISSING_FROM_COMPLETE_SEGMENT = config.MAX_TIME_MISSING_FROM_COMPLETE_SEGMENT, MINIMUM_SEGMENT_SIZE = config.MINIMUM_SEGMENT_SIZE;
/**
 * Epsilon compensating for rounding errors when comparing the start and end
 * time of multiple segments.
 */
var ROUNDING_ERROR = Math.min(1 / 60, MINIMUM_SEGMENT_SIZE);
/**
 * Return the list of segments that can currently be downloaded to fill holes
 * in the buffer in the given range, including already-pushed segments currently
 * incomplete in the buffer.
 * This list might also include already-loaded segments in a higher bitrate,
 * according to the given configuration.
 * Excludes segment that are already being pushed.
 * @param {Object} args
 * @returns {Array.<Object>}
 */
export default function getNeededSegments(_a) {
    var content = _a.content, currentPlaybackTime = _a.currentPlaybackTime, fastSwitchThreshold = _a.fastSwitchThreshold, neededRange = _a.neededRange, segmentsBeingPushed = _a.segmentsBeingPushed, bufferedSegments = _a.bufferedSegments;
    var representation = content.representation;
    var availableSegmentsForRange = representation.index
        .getSegments(neededRange.start, neededRange.end - neededRange.start);
    // Remove from `bufferedSegments` any segments we would prefer to replace:
    //   - segments in the wrong track / bad quality
    //   - garbage-collected segments
    var segmentsToKeep = bufferedSegments
        .filter(function (bufferedSegment) { return !shouldContentBeReplaced(bufferedSegment.infos, content, currentPlaybackTime, fastSwitchThreshold); })
        .filter(function (currentSeg, i, consideredSegments) {
        var prevSeg = i === 0 ? null :
            consideredSegments[i - 1];
        var nextSeg = i >= consideredSegments.length - 1 ? null :
            consideredSegments[i + 1];
        return !isStartGarbageCollected(currentSeg, prevSeg, neededRange.start) &&
            !isEndGarbageCollected(currentSeg, nextSeg, neededRange.end);
    });
    var segmentsToDownload = availableSegmentsForRange.filter(function (segment) {
        var contentObject = objectAssign({ segment: segment }, content);
        // First, check that the segment is not already being pushed
        if (segmentsBeingPushed.length > 0) {
            var isAlreadyBeingPushed = segmentsBeingPushed
                .some(function (pendingSegment) { return areSameContent(contentObject, pendingSegment); });
            if (isAlreadyBeingPushed) {
                return false;
            }
        }
        var duration = segment.duration, time = segment.time, end = segment.end;
        if (segment.isInit) {
            return true; // never skip initialization segments
        }
        if (segment.complete && duration < MINIMUM_SEGMENT_SIZE) {
            return false; // too small, don't download
        }
        // Check if the same segment from another Representation is not already
        // being pushed.
        if (segmentsBeingPushed.length > 0) {
            var waitForPushedSegment = segmentsBeingPushed.some(function (pendingSegment) {
                if (pendingSegment.period.id !== content.period.id ||
                    pendingSegment.adaptation.id !== content.adaptation.id) {
                    return false;
                }
                var oldSegment = pendingSegment.segment;
                if ((oldSegment.time - ROUNDING_ERROR) > time) {
                    return false;
                }
                if ((oldSegment.end + ROUNDING_ERROR) < end) {
                    return false;
                }
                return !shouldContentBeReplaced(pendingSegment, contentObject, currentPlaybackTime, fastSwitchThreshold);
            });
            if (waitForPushedSegment) {
                return false;
            }
        }
        // check if the segment is already downloaded
        for (var i = 0; i < segmentsToKeep.length; i++) {
            var completeSeg = segmentsToKeep[i];
            var areFromSamePeriod = completeSeg.infos.period.id === content.period.id;
            // Check if content are from same period, as there can't be overlapping
            // periods, we should consider a segment as already downloaded if
            // it is from same period (but can be from different adaptation or
            // representation)
            if (areFromSamePeriod) {
                var completeSegInfos = completeSeg.infos.segment;
                if (time - completeSegInfos.time > -ROUNDING_ERROR &&
                    completeSegInfos.end - end > -ROUNDING_ERROR) {
                    return false; // already downloaded
                }
            }
        }
        // check if there is an hole in place of the segment currently
        for (var i = 0; i < segmentsToKeep.length; i++) {
            var completeSeg = segmentsToKeep[i];
            if (completeSeg.end > time) {
                // `true` if `completeSeg` starts too far after `time`
                return completeSeg.start > time + ROUNDING_ERROR ||
                    // `true` if `completeSeg` ends too soon before `end`
                    getLastContiguousSegment(segmentsToKeep, i).end < end - ROUNDING_ERROR;
            }
        }
        return true;
    });
    return segmentsToDownload;
}
/**
 * From the given array of buffered chunks (`bufferedSegments`) returns the last
 * buffered chunk contiguous with the one at the `startIndex` index given.
 * @param {Array.<Object>}
 * @param {number} startIndex
 * @returns {Object}
 */
function getLastContiguousSegment(bufferedSegments, startIndex) {
    var j = startIndex + 1;
    // go through all contiguous segments and take the last one
    while (j < bufferedSegments.length - 1 &&
        (bufferedSegments[j - 1].end + ROUNDING_ERROR) >
            bufferedSegments[j].start) {
        j++;
    }
    j--; // index of last contiguous segment
    return bufferedSegments[j];
}
/**
 * Returns `true` if segments linked to the given `oldContent` currently present
 * in the buffer should be replaced by segments coming from `currentContent`.
 * @param {Object} oldContent
 * @param {Object} currentContent
 * @param {number} currentPlaybackTime
 * @param {number} [fastSwitchThreshold]
 * @returns {boolean}
 */
function shouldContentBeReplaced(oldContent, currentContent, currentPlaybackTime, fastSwitchThreshold) {
    if (oldContent.period.id !== currentContent.period.id) {
        return false; // keep segments from another Period by default.
    }
    var segment = oldContent.segment;
    if (segment.time < (currentPlaybackTime + CONTENT_REPLACEMENT_PADDING)) {
        return false;
    }
    if (oldContent.adaptation.id !== currentContent.adaptation.id) {
        return true; // replace segments from another Adaptation
    }
    return canFastSwitch(oldContent.representation, currentContent.representation, fastSwitchThreshold);
}
/**
 * Returns `true` if segments from the new Representation can replace
 * previously-loaded segments from the old Representation given.
 *
 * This behavior is called "fast-switching".
 * @param {Object} oldSegmentRepresentation
 * @param {Object} newSegmentRepresentation
 * @param {number|undefined} fastSwitchThreshold
 * @returns {boolean}
 */
function canFastSwitch(oldSegmentRepresentation, newSegmentRepresentation, fastSwitchThreshold) {
    var oldContentBitrate = oldSegmentRepresentation.bitrate;
    if (fastSwitchThreshold === undefined) {
        // only re-load comparatively-poor bitrates for the same Adaptation.
        var bitrateCeil = oldContentBitrate * BITRATE_REBUFFERING_RATIO;
        return newSegmentRepresentation.bitrate > bitrateCeil;
    }
    return oldContentBitrate < fastSwitchThreshold &&
        newSegmentRepresentation.bitrate > oldContentBitrate;
}
/**
 * From buffered segment information, return `true` if the given `currentSeg`
 * might have been garbage collected at the start.
 * Return `false` if the segment is complete at least from `maximumStartTime`.
 * @param {Object} currentSeg - The segment information for the segment in
 * question.
 * @param {Object|null} prevSeg - The segment information for the previous
 * buffered segment, if one (`null` if none).
 * @param {number} maximumStartTime - Only consider the data after that time.
 * If `currentSeg` has only been garbage collected for some data which is before
 * that time, we will return `false`.
 */
function isStartGarbageCollected(currentSeg, prevSeg, maximumStartTime) {
    if (currentSeg.bufferedStart === undefined) {
        log.warn("Stream: Start of a segment unknown. " +
            "Assuming it is garbage collected by default.", currentSeg);
        return true;
    }
    if (prevSeg !== null && prevSeg.bufferedEnd !== undefined &&
        (currentSeg.bufferedStart - prevSeg.bufferedEnd < 0.1)) {
        return false;
    }
    if (maximumStartTime < currentSeg.bufferedStart &&
        currentSeg.bufferedStart - currentSeg.start >
            MAX_TIME_MISSING_FROM_COMPLETE_SEGMENT) {
        log.info("Stream: The start of the wanted segment has been garbage collected", currentSeg);
        return true;
    }
    return false;
}
/**
 * From buffered segment information, return `true` if the given `currentSeg`
 * might have been garbage collected at the end.
 * Return `false` if the segment is complete at least until `minimumEndTime`.
 * @param {Object} currentSeg - The segment information for the segment in
 * question.
 * @param {Object|null} nextSeg - The segment information for the next buffered
 * segment, if one (`null` if none).
 * @param {number} minimumEndTime - Only consider the data before that time.
 * If `currentSeg` has only been garbage collected for some data which is after
 * that time, we will return `false`.
 */
function isEndGarbageCollected(currentSeg, nextSeg, minimumEndTime) {
    if (currentSeg.bufferedEnd === undefined) {
        log.warn("Stream: End of a segment unknown. " +
            "Assuming it is garbage collected by default.", currentSeg);
        return true;
    }
    if (nextSeg !== null && nextSeg.bufferedStart !== undefined &&
        (nextSeg.bufferedStart - currentSeg.bufferedEnd < 0.1)) {
        return false;
    }
    if (minimumEndTime > currentSeg.bufferedEnd &&
        currentSeg.end - currentSeg.bufferedEnd > MAX_TIME_MISSING_FROM_COMPLETE_SEGMENT) {
        log.info("Stream: The end of the wanted segment has been garbage collected", currentSeg);
        return true;
    }
    return false;
}
