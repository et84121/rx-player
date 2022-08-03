/**
 * Copyright 2019 CANAL+ Group
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

import { IDBPDatabase } from "idb";
import { AsyncSubject } from "rxjs";

import { TypedArray } from "../../../../../core/eme";
import SegmentPipelineCreator from "../../../../../core/fetchers/segment/segment_fetcher_creator";
import Manifest, {
  Adaptation,
  ISegment,
  Period,
  Representation,
} from "../../../../../manifest";
import { ILocalIndexSegment } from "../../../../../parsers/manifest/local/types";
import { ICallbacks, IProgressInformations } from "../../types";

export type ContentBufferType = "video" | "audio" | "text";
export type DownloadType = "start" | "resume";

export interface IContext {
  manifest: Manifest;
  period: Period;
  adaptation: Adaptation;
  representation: Representation;
  segment: ISegment;
}
export interface IContextUniq {
  representation: Representation;
  adaptation: Adaptation;
  segment: ISegment;
}

export interface IContextBuilder {
  period: Period;
  contexts: IContextUniq[];
}

export interface IGlobalContext {
  video: IContextBuilder[];
  audio: IContextBuilder[];
  text: IContextBuilder[];
  manifest: Manifest;
}

export interface IContextRicher {
  nextSegments: ISegment[];
  period: Period;
  adaptation: Adaptation;
  representation: Representation;
  id: string;
  chunkData?: ISegmentData;
}

export interface IAdaptationStored {
  type: ContentBufferType;
  audioDescription?: boolean;
  closedCaption?: boolean;
  language?: string;
  representations: Representation[];
}

export interface IAdaptationForPeriod {
  [id: string]: IAdaptationStored[];
}

export interface ISegmentForRepresentation {
  [id: string]: ILocalIndexSegment[];
}

export interface IInitSegment {
  nextSegments: ISegment[];
  ctx: IContext;
  contentType: ContentBufferType;
  segmentPipelineCreator: SegmentPipelineCreator<any>;
  chunkData?: ISegmentData;
}

export interface IInitGroupedSegments {
  progress: IProgressInformations;
  video: IContextRicher[];
  audio: IContextRicher[];
  text: IContextRicher[];
  segmentPipelineCreator: SegmentPipelineCreator<any> | null;
  manifest: Manifest | null;
  type: DownloadType;
}

export interface ISegmentStored {
  contentID: string;
  segmentKey: string;
  data: TypedArray | ArrayBuffer;
  size: number;
}

export interface IUtils extends ICallbacks {
  db: IDBPDatabase;
  pause$: AsyncSubject<void>;
  contentID: string;
}

export interface IManifestDBState {
  progress: IProgressInformations;
  manifest: Manifest | null;
  video: IContextRicher[];
  audio: IContextRicher[];
  text: IContextRicher[];
  size: number;
}

export interface ISegmentData {
  data: Uint8Array;
  contentProtection?: Uint8Array;
}

export interface ICustomSegment {
  chunkData: ISegmentData;
  ctx: IContext;
  index: number;
  contentType: ContentBufferType;
  representationID: string;
  isInitData: boolean;
  nextSegments?: ISegment[];
  progress?: IProgressInformations;
  type: DownloadType;
}

export interface ISegmentPipelineContext {
  type: DownloadType;
  progress?: IProgressInformations;
  isInitData: boolean;
  segmentPipelineCreator: SegmentPipelineCreator<any>;
  nextSegments?: ISegment[];
}

export interface IAbstractContextCreation {
  type: DownloadType;
  progress: IProgressInformations;
  segmentPipelineCreator: SegmentPipelineCreator<any>;
  manifest: Manifest;
}

export interface IUtilsOfflineLoader {
  contentID: string;
  duration: number;
  isFinished: boolean;
  db: IDBPDatabase;
}
