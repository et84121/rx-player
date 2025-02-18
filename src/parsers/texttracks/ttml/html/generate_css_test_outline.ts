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

import isNonEmptyString from "../../../../utils/is_non_empty_string";

/**
 * Try to replicate the textOutline TTML style property into CSS.
 *
 * We mock it throught the text-shadow property, translating the TTML thickness
 * into blur radius and the blur-radius into... nothing.
 *
 * @param {string} color
 * @param {string|number} thickness
 * @returns {string}
 */
export default function generateCSSTextOutline(
  color : string,
  thickness : string|number
) : string {
  let thick = thickness;
  if (isNonEmptyString(thickness) && thickness.trim().endsWith("%")) {
    // As em and % are basically equivalent in CSS
    // (they both are relative to the font-size
    // of the current element)
    // We convert the non supported % into the supported em
    thick = thickness.trim().slice(0, -1);
    thick = (parseInt(thick, 10) / 100).toString() + "em";
  }
  return `-1px -1px ${thick} ${color},` +
         `1px -1px ${thick} ${color},` +
         `-1px 1px ${thick} ${color},` +
         `1px 1px ${thick} ${color}`;
}
