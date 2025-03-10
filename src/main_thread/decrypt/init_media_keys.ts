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

import type { IMediaElement } from "../../compat/browser_compatibility_types";
import log from "../../log";
import type { IKeySystemOption } from "../../public_types";
import type { CancellationSignal } from "../../utils/task_canceller";
import type { IMediaKeysInfos } from "./get_media_keys";
import getMediaKeysInfos from "./get_media_keys";
import MediaKeysAttacher from "./utils/media_keys_attacher";

/**
 * Get media keys infos from key system configs then attach media keys to media element.
 * @param {HTMLMediaElement} mediaElement
 * @param {Array.<Object>} keySystemsConfigs
 * @param {Object} cancelSignal
 * @returns {Promise.<Object>}
 */
export default async function initMediaKeys(
  mediaElement: IMediaElement,
  keySystemsConfigs: IKeySystemOption[],
  cancelSignal: CancellationSignal,
): Promise<IMediaKeysInfos> {
  const mediaKeysInfo = await getMediaKeysInfos(
    mediaElement,
    keySystemsConfigs,
    cancelSignal,
  );

  const { mediaKeys } = mediaKeysInfo;
  const shouldDisableOldMediaKeys =
    mediaElement.mediaKeys !== null &&
    mediaElement.mediaKeys !== undefined &&
    mediaKeys !== mediaElement.mediaKeys;

  if (shouldDisableOldMediaKeys) {
    log.debug("DRM: Disabling old MediaKeys");
    await MediaKeysAttacher.clearMediaKeys(mediaElement);
  }
  return mediaKeysInfo;
}
