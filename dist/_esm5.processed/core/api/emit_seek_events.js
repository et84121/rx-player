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
import { defer as observableDefer, EMPTY, merge as observableMerge, } from "rxjs";
import { filter, mapTo, startWith, switchMapTo, take, } from "rxjs/operators";
/**
 * Returns Observable which will emit:
 *   - `"seeking"` when we are seeking in the given mediaElement
 *   - `"seeked"` when a seek is considered as finished by the given clock$
 *     Observable.
 * @param {HTMLMediaElement} mediaElement
 * @param {Observable} clock$
 * @returns {Observable}
 */
export default function emitSeekEvents(mediaElement, clock$) {
    return observableDefer(function () {
        if (mediaElement === null) {
            return EMPTY;
        }
        var isSeeking$ = clock$.pipe(filter(function (tick) { return tick.event === "seeking"; }), mapTo("seeking"));
        var hasSeeked$ = isSeeking$.pipe(switchMapTo(clock$.pipe(filter(function (tick) { return tick.event === "seeked"; }), mapTo("seeked"), take(1))));
        var seekingEvents$ = observableMerge(isSeeking$, hasSeeked$);
        return mediaElement.seeking ? seekingEvents$.pipe(startWith("seeking")) :
            seekingEvents$;
    });
}
