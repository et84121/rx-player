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

/**
 * String.prototype.startsWith ponyfill.
 * Indicates Whether a string starts with another substring.
 *
 * Inspired from MDN polyfill, but ponyfilled instead.
 * @param {string} completeString
 * @param {string} searchString
 * @param {number} [position]
 * @returns {boolean}
 */
export default function startsWith(
  completeString: string,
  searchString: string,
  position?: number,
): boolean {
  // eslint-disable-next-line no-restricted-properties
  if (typeof String.prototype.startsWith === "function") {
    // eslint-disable-next-line no-restricted-properties
    return completeString.startsWith(searchString, position);
  }
  const initialPosition = typeof position === "number" ? Math.max(position, 0) : 0;
  return (
    completeString.substring(initialPosition, initialPosition + searchString.length) ===
    searchString
  );
}
