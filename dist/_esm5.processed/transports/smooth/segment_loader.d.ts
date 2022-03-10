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
import { CancellationSignal } from "../../utils/task_canceller";
import { ICustomSegmentLoader, ISegmentContext, ISegmentLoaderCallbacks, ISegmentLoaderResultSegmentCreated, ISegmentLoaderResultSegmentLoaded } from "../types";
/**
 * Defines the url for the request, load the right loader (custom/default
 * one).
 */
declare const generateSegmentLoader: ({ checkMediaSegmentIntegrity, customSegmentLoader, }: {
    checkMediaSegmentIntegrity?: boolean | undefined;
    customSegmentLoader?: ICustomSegmentLoader | undefined;
}) => (url: string | null, content: ISegmentContext, cancelSignal: CancellationSignal, callbacks: ISegmentLoaderCallbacks<Uint8Array | ArrayBuffer | null>) => Promise<ISegmentLoaderResultSegmentLoaded<Uint8Array | ArrayBuffer | null> | ISegmentLoaderResultSegmentCreated<Uint8Array | ArrayBuffer | null>>;
export default generateSegmentLoader;
