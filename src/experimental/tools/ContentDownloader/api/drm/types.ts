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
import { Subject } from "rxjs";

import {
  IPersistentSessionInfo,
  IProtectionData,
} from "../../../../../core/decrypt";
import { IOfflineDBSchema } from "../db/dbSetUp";
import { ContentBufferType } from "../downloader/types";

export type ITypedArray =
  | Int8Array
  | Int16Array
  | Int32Array
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | Uint8ClampedArray
  | Float32Array
  | Float64Array;

export interface IStoredContentProtection {
  /**
   * offline content id identifier
   */
  contentID: string;
  drmKey: string;
  drmType: string;
  persistentSessionInfo: IPersistentSessionInfo[];
}

export interface IUtilsKeySystemsTransaction {
  /**
   * offline content id identifier
   */
  contentID: string;
  contentProtection$: Subject<IProtectionData>;
  db: IDBPDatabase<IOfflineDBSchema>;
}

export interface IEMEOptions {
  contentType: ContentBufferType;
  codec: string;
  initSegment: ITypedArray | ArrayBuffer;
}
