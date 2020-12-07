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

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import assertUnreachable from "../assert_unreachable";

describe("utils - assert", () => {
  it("should throw an error if the function is called", () => {
    let error;
    try {
      assertUnreachable(4 as never);
    } catch (e) {
      error = e;
      /* eslint-disable @typescript-eslint/no-unused-expressions */
      expect(e).toBeDefined();
      /* eslint-enable @typescript-eslint/no-unused-expressions */
    }
    /* eslint-disable @typescript-eslint/no-unused-expressions */
    expect(error).toBeDefined();
    /* eslint-enable @typescript-eslint/no-unused-expressions */
    expect(error.message).toBe("Unreachable path taken");
    expect(error.name).toBe("AssertionError");
  });
});
