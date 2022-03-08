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
import { ILoadedTextSegmentFormat, ISegmentContext, ISegmentParserParsedInitSegment, ISegmentParserParsedSegment, ITextTrackSegmentData } from "../types";
/**
 * Parse TextTrack data.
 * @param {Object} loadedSegment
 * @param {Object} content
 * @param {number | undefined} initTimescale
 * @returns {Object}
 */
export default function textTrackParser(loadedSegment: {
    data: ILoadedTextSegmentFormat;
    isChunked: boolean;
}, content: ISegmentContext, initTimescale: number | undefined): ISegmentParserParsedInitSegment<null> | ISegmentParserParsedSegment<ITextTrackSegmentData | null>;
