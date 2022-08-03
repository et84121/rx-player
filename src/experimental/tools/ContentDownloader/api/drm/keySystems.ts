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
import { endWith } from "rxjs";
import ContentDecryptor, {
  ContentDecryptorState,
} from "../../../../../core/decrypt";

import { IKeySystemOption, IPersistentSessionInfo } from "../../../../../public_types";
import { fromEvent } from "../../../../../utils/event_emitter";

import { IndexedDBError } from "../../utils";
import { IUtilsKeySystemsTransaction } from "./types";

/**
 * Get the licence when keysSystems are specified
 *
 * @remarks
 * This function is basically reproducing the getLicence from the rx-player, but we are
 * adding an additional step to catch the licence and resolve a promise with the licence
 * To get the challenge we need to retrieve the licence
 * we are instanciating a minimal rxPlayer
 * @param {Object} keySystemsOption KeySystems configuration
 *  provided at the download call
 * @param {Object} keySystemsUtils Utils that we need
 *  to create/store encrypted content
 * @returns {Observable} An observable of EME events
 */
function ContentDecryptorTransaction(
  keySystemsOption: IKeySystemOption,
  keySystemsUtils: IUtilsKeySystemsTransaction
) {
  const video = document.createElement("video");
  const { contentID, contentProtection$, db } = keySystemsUtils;
  let id = 0;
  const keySystems = [
    {
      ...keySystemsOption,
      licenseStorage: {
        save(persistentSessionInfo: IPersistentSessionInfo[]) {
          db.add("contentsProtection", {
            contentID,
            drmKey: `${contentID}--${id}`,
            drmType: keySystemsOption.type,
            persistentSessionInfo,
          })
            .then(() => {
              id += 1;
            })
            .catch((err) => {
              if (err instanceof Error) {
                throw new IndexedDBError(`${contentID}:
                Impossible to store contentProtection in IndexedDB: ${err.message}
              `);
              }
            });
        },
        load() {
          return [];
        },
      },
      persistentLicense: true,
      persistentStateRequired: true,
    },
  ];
  const ContentDecryptorInstance = new ContentDecryptor(video, keySystems);

  contentProtection$.pipe(endWith("dispose" as const)).subscribe((data) => {
    if (data === "dispose") {
      ContentDecryptorInstance.dispose();
    }
    else {
      ContentDecryptorInstance.onInitializationData(data);
    }
  });

  ContentDecryptorInstance.addEventListener("stateChange", (payload) => {
    if (payload === ContentDecryptorState.WaitingForAttachment) {
      ContentDecryptorInstance.attach();
    }
  });

  return fromEvent(ContentDecryptorInstance , "stateChange");
}

export default ContentDecryptorTransaction;
