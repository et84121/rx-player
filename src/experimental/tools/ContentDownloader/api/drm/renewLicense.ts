import { endWith } from "rxjs";
import ContentDecryptor, {
  ContentDecryptorState,
} from "../../../../../core/decrypt";
import { IKeySystemOption, IPersistentSessionInfo } from "../../../../../public_types";
import { fromEvent } from "../../../../../utils/event_emitter";
import { IndexedDBError } from "../../utils";
import { IUtilsKeySystemsTransaction } from "./types";

function RenewalLicense (
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
          db.put("contentsProtection", {
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

export {
  RenewalLicense,
};
