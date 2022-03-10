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
import { defer as observableDefer, EMPTY, ignoreElements, } from "rxjs";
import { shouldUnsetMediaKeys } from "../../compat/";
import log from "../../log";
import disposeMediaKeys from "./dispose_media_keys";
import MediaKeysInfosStore from "./media_keys_infos_store";
/**
 * Clear EME ressources that should be cleared when the current content stops
 * its playback.
 * @param {HTMLMediaElement} mediaElement
 * @returns {Observable}
 */
export default function clearEMESession(mediaElement) {
    return observableDefer(function () {
        log.info("EME: Clearing-up EME session.");
        if (shouldUnsetMediaKeys()) {
            log.info("EME: disposing current MediaKeys.");
            return disposeMediaKeys(mediaElement)
                .pipe(ignoreElements());
        }
        var currentState = MediaKeysInfosStore.getState(mediaElement);
        if (currentState !== null &&
            currentState.keySystemOptions.closeSessionsOnStop === true) {
            log.info("EME: closing all current sessions.");
            return currentState.loadedSessionsStore.closeAllSessions()
                // NOTE As of now (RxJS 7.4.0), RxJS defines `ignoreElements` default
                // first type parameter as `any` instead of the perfectly fine `unknown`,
                // leading to linter issues, as it forbids the usage of `any`.
                // This is why we're disabling the eslint rule.
                /* eslint-disable-next-line @typescript-eslint/no-unsafe-argument */
                .pipe(ignoreElements());
        }
        log.info("EME: Nothing to clear. Returning right away. No state =", currentState === null);
        return EMPTY;
    });
}
