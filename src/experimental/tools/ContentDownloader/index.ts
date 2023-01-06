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
import { AsyncSubject, Subject } from "rxjs";
import { IProtectionData } from "../../../core/decrypt";


import {
  addFeatures,
} from "../../../features";
import { IFeatureFunction } from "../../../features/types";
import logger from "../../../log";
import { IKeySystemOption } from "../../../public_types";
import { base64ToBytes, bytesToBase64 } from "../../../utils/base64";


import { IOfflineDBSchema, setUpDb } from "./api/db/dbSetUp";
import DownloadManager from "./api/downloader/downloadManager";
import {
  getBuilderFormattedForAdaptations,
  getBuilderFormattedForSegments,
  getKeySystemsSessionsOffline,
  offlineManifestLoader,
} from "./api/downloader/manifest";
import keySystem from "./api/drm/keySystems";
import { IActiveDownload, IActivePauses } from "./api/tracksPicker/types";
import {
  IAvailableContent,
  ICallbacks,
  IDownloadArguments,
  IPlaybackInfo,
  IStorageInfo,
  IStoredManifest,
} from "./types";
import {
  assertResumeADownload,
  checkInitDownloaderOptions,
  deserialize,
  isPersistentLicenseSupported,
  isValidContentID,
  SegmentConstuctionError,
  serialize,
  ValidationArgsError,
} from "./utils";

/**
 * Instanciate a ContentDownloader
 *
 * @param {}
 * @return {IContentDownloader}
 */
class ContentDownloader {
 /**
  * Add a given parser from the list of features.
  * @param {Array.<Function>} parsersList
  */
  static addParsers(parsersList : IFeatureFunction[]) : void {
    addFeatures(parsersList);
  }

  /**
   * Detect if the current environment is supported for persistent licence
   * @returns {boolean} - is supported
   */
  static isPersistentLicenseSupported(): Promise<boolean> {
    return isPersistentLicenseSupported();
  }

  /**
   * Get informations on the storage usage of the navigator
   * @returns {Promise<IStorageInfo | null>} the space used and the total usable in bytes
   */
  static async getStorageInfo(): Promise<IStorageInfo | null> {
    if (navigator.storage == null || navigator.storage.estimate == null) {
      return null;
    }
    const { quota, usage } = await navigator.storage.estimate();
    if (quota === undefined || usage === undefined) {
      return null;
    }
    return {
      total: quota,
      used: usage,
    };
  }

  public readonly dbName: string;
  private db: IDBPDatabase<IOfflineDBSchema> | null;
  private activeDownloads: IActiveDownload;
  private activePauses: IActivePauses;

  constructor() {
    this.dbName = "d2g-rxPlayer";
    this.activeDownloads = {};
    this.activePauses = {};
    this.db = null;
  }

  /**
   * Initialize the download environment.
   * Must be invocated at the beginning in order to store segment.
   * @returns {Promise<void>}
   */
  initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      setUpDb(this.dbName)
        .then(db => {
          this.db = db;
          resolve();
        })
        .catch((error) => {
          if (error instanceof Error) {
            reject(error);
          }
        });
    });
  }

  /**
   * Start a download from scratch.
   * @param {Object<ISettingsDownloader>} settings
   * @returns {Promise.<string|void>} contentID -
   *  return the id generated of the content or void if an error happened
   */
  async download(options: IDownloadArguments): Promise<string | void> {
    try {
      if (this.db === null) {
        throw new Error("You must run initialize() first!");
      }
      const db = this.db;
      const contentID = await checkInitDownloaderOptions(options, db);
      const { metadata, transport, url } = options;
      const pause$ = new AsyncSubject<void>();
      this.activePauses[contentID] = pause$;
      const downloadManager = new DownloadManager(db);
      const initDownloadSub = downloadManager
        .initDownload({ ...options, contentID }, pause$)
        .subscribe(
          ([download]) => {
            if (download === null) {
              return;
            }
            const { progress, manifest, audio, video, text, size } = download;
            if (manifest === null) {
              return;
            }

            const payload = {
              url,
              contentID,
              transport,
              manifest,
              builder: { video, audio, text },
              progress,
              size,
              duration:
                manifest.getMaximumSafePosition() - manifest.getMinimumSafePosition(),
              metadata,
            };

            // 將 Uint8Array 轉成 base64 編碼
            const serializePayload = serialize(payload);

            db.put("manifests", { contentID, serializePayload }).then(() => {
              if (progress.percentage === 100) {
                options.onFinished?.();
              }
            }).catch((err: Error) => {
              if (err instanceof Error) {
                return options?.onError?.(err);
              }
            });
          },
          (err) => {
            if (err instanceof Error) {
              return options?.onError?.(err);
            }
          }
        );
      this.activeDownloads[contentID] = initDownloadSub;
      return contentID;
    } catch (err) {
      if (err instanceof Error) {
        return options?.onError?.(err);
      }
    }
  }

  /**
   * Resume a download already started earlier.
   * @param {string} contentID
   * @returns {Promise.<void>}
   */
  async resume(contentID: string, callbacks: ICallbacks): Promise<void> {
    try {
      if (this.db === null) {
        throw new Error("You must run initialize() first!");
      }
      const db = this.db;
      if (contentID == null || contentID === "") {
        throw new Error("You must specify a valid contentID for resuming.");
      }

      const IdbManifests = (await db.get(
        "manifests",
        contentID
      ));

      const storedManifest : IStoredManifest | undefined =
        IdbManifests ?
          deserialize(IdbManifests.serializePayload) as IStoredManifest
          : undefined ;

      if (storedManifest === undefined || storedManifest.manifest === null) {
        throw new SegmentConstuctionError(
          `No Manifest found for current content ${contentID}`
        );
      }

      assertResumeADownload(storedManifest, this.activeDownloads);
      const pause$ = new AsyncSubject<void>();
      this.activePauses[contentID] = pause$;
      const downloadManager = new DownloadManager(db);
      const resumeDownloadSub = downloadManager
        .resumeDownload(storedManifest, pause$, callbacks)
        .subscribe(
          ([download]) => {
            if (download === null) {
              return;
            }
            const { progress, manifest, audio, video, text, size } = download;
            if (manifest === null) {
              return;
            }
            const { metadata, transport,  url } = storedManifest;

            const payload = {
              url,
              contentID,
              transport,
              manifest,
              builder: { video, audio, text },
              progress,
              size,
              duration:
                manifest.getMaximumSafePosition() - manifest.getMinimumSafePosition(),
              metadata,
            };
            const serializePayload = serialize(payload);

            db.put("manifests", {
              contentID,
              serializePayload,
            }).then(() => {
              if (progress.percentage === 100) {
                callbacks?.onFinished?.();
              }
            }).catch((err) => {
              if (err instanceof Error) {
                return callbacks?.onError?.(err);
              }
            });
          },
          (err) => {
            if (err instanceof Error) {
              return callbacks?.onError?.(err);
            }
          }
        );
      this.activeDownloads[contentID] = resumeDownloadSub;
    } catch (err) {
      if (err instanceof Error) {
        return callbacks?.onError?.(err);
      }
    }
  }

  /**
   * Pause a download already started earlier.
   * @param {string} contentID
   * @returns {void}
   */
  pause(contentID: string): void {
    isValidContentID(contentID);
    const activeDownloads = this.activeDownloads;
    const activePauses = this.activePauses;
    if (activeDownloads[contentID] == null || activePauses[contentID] == null) {
      throw new ValidationArgsError(`Invalid contentID given: ${contentID}`);
    }
    activePauses[contentID].next();
    activePauses[contentID].complete();
    activeDownloads[contentID].unsubscribe();
    delete activeDownloads[contentID];
    delete activePauses[contentID];
  }

  /**
   * Get all the downloaded entry (manifest) partially or fully downloaded.
   * @returns {Promise.<IAvailableContent[]>}
   */
  getAvailableContents(
    limit?: number
  ): Promise<IAvailableContent[]> | undefined {
    return new Promise((resolve, reject) => {
      if (this.db === null) {
        return reject(new Error("You must run initialize() first!"));
      }

      return resolve(this.db.getAll("manifests", undefined, limit)


        .then((data) => data.map(d => deserialize(d.serializePayload) as IStoredManifest))

        .then((manifests: IStoredManifest[]) => {
          return manifests.map(
            ({ contentID, metadata, size, duration, progress, url, transport }) => ({
              id: contentID,
              metadata,
              size,
              duration,
              progress: progress.percentage,
              isFinished: progress.percentage === 100,
              url,
              transport,
            }));
        }));
    });
  }

  /**
   * Get a single content ready to be played by the rx-player,
   * could be fully or partially downloaded.
   * @param {string} contentID
   * @returns {Promise.<IPlaybackInfo|void>}
   */
  async getPlaybackInfo(contentID: string): Promise<IPlaybackInfo | void> {
    if (this.db === null) {
      throw new Error("You must run initialize() first!");
    }
    const db = this.db;
    const [IdbManifests, contentsProtection] = await Promise.all([
      db.get("manifests", contentID),
      db.transaction("contentsProtection", "readonly")
        .objectStore("contentsProtection")
        .index("contentID")
        .getAll(IDBKeyRange.only(contentID)),
    ]);

    const contentManifest: IStoredManifest | undefined =
      IdbManifests ?
        deserialize(IdbManifests.serializePayload) as IStoredManifest
        : undefined ;

    if (contentManifest === undefined || contentManifest.manifest === null) {
      throw new SegmentConstuctionError(
        `No Manifest found for current content ${contentID}`
      );
    }
    const {
      progress,
      duration,
      manifest,
    } = contentManifest;

    const contentProtection = getKeySystemsSessionsOffline(contentsProtection);

    if (contentProtection === undefined) {
      return {
        getManifest() {
          return offlineManifestLoader(
            manifest,
            getBuilderFormattedForAdaptations(contentManifest),
            getBuilderFormattedForSegments(contentManifest),
            { contentID, duration, isFinished: progress.percentage === 100, db }
          );
        },
      };
    }
    return {
      getManifest() {
        return offlineManifestLoader(
          manifest,
          getBuilderFormattedForAdaptations(contentManifest),
          getBuilderFormattedForSegments(contentManifest),
          { contentID, duration, isFinished: progress.percentage === 100, db }
        );
      },
      keySystems: [{
        type: contentProtection.drmType,
        persistentStateRequired: true,
        persistentLicense: true,
        licenseStorage: {
          load() {
            return contentProtection.storedContentsProtections;
          },
          save(persistentSessionInfos) {
            logger.warn(
              "[Downloader] try to save ContentsProtections",
              JSON.stringify(persistentSessionInfos)
            );
            return;
          },
        },
        getLicense(msg, type) {
          // There should not be any license requests for offline playback.
          logger.warn("[Downloader] trying to get license", JSON.stringify({
            msg:  bytesToBase64(msg) ,
            type,
          }));
          return null;
        },
      }],
    };
  }

  /**
   * Delete an entry partially or fully downloaded and stop the download
   * if the content is downloading, stop the download and delete it.
   * @param {string} contentID
   * @returns {Promise.<void>}
   */
  async deleteContent(contentID: string): Promise<void> {
    const activeDownloads = this.activeDownloads;
    const activePauses = this.activePauses;
    const db = this.db;
    if (db == null) {
      throw new Error("You must run initialize() first!");
    }
    if (activeDownloads[contentID] != null && activePauses[contentID] != null) {
      activePauses[contentID].next();
      activePauses[contentID].complete();
      activeDownloads[contentID].unsubscribe();
      delete activeDownloads[contentID];
      delete activePauses[contentID];
    }
    const indexTxSEG = db
      .transaction("segments", "readwrite")
      .objectStore("segments")
      .index("contentID");
    let cursor = await indexTxSEG.openCursor(IDBKeyRange.only(contentID));
    while (cursor !== null) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    const indexTxDRM = db
      .transaction("contentsProtection", "readwrite")
      .objectStore("contentsProtection")
      .index("contentID");
    let cursorDRM = await indexTxDRM.openCursor(IDBKeyRange.only(contentID));
    while (cursorDRM !== null) {
      await cursorDRM.delete();
      cursorDRM = await cursorDRM.continue();
    }
    await db.delete("manifests", contentID);
  }

  /**
   * delete old DRM license and store a new one
   * @param contentID
   * @param keySystemOptions
   */
  async renewalContentLicense(contentID: string, keySystemOptions: IKeySystemOption) {
    if (this.db === null) {
      throw new Error("You must run initialize() first!");
    }
    const db = this.db;
    const [contentsProtections] = await Promise.all([
      db.transaction("contentsProtection", "readonly")
        .objectStore("contentsProtection")
        .index("contentID")
        .getAll(IDBKeyRange.only(contentID)),
    ]);

    const contentProtection$ = new Subject<IProtectionData>();

    keySystem(
      keySystemOptions,
      {
        contentID,
        contentProtection$ ,
        db: this.db,
      }
    );


    contentsProtections.forEach((val) => {
      val.persistentSessionInfo.reduce<IProtectionData[]>((acc, curr) => {
        if (curr.version !== 4) {
          throw new Error("[Downloader] unsupported persistentSessionInfo version");
        }

        acc.push(
          {
            type: curr.initDataType,
            values: curr.values.map((psshVal) => {
              return {
                data: typeof psshVal.data === "string" ?
                      base64ToBytes(psshVal.data) : psshVal.data.initData ,
                systemId: psshVal.systemId,
              };
            }),
            keyIds: curr.keyIds.map(
              id => typeof id === "string" ? base64ToBytes(id) : id.initData
            ),
          }
        );

        return acc;
      }, []).forEach((contentProtentData) => {
        contentProtection$.next(contentProtentData);
      });
    });
  }
}

export { DASH } from "../../../features/list/dash";
export { SMOOTH } from "../../../features/list/smooth";
export default ContentDownloader;
