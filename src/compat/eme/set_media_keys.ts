import log from "../../log";
import sleep from "../../utils/sleep";
import type { IMediaElement, IMediaKeys } from "../browser_compatibility_types";
import shouldAwaitSetMediaKeys from "../should_await_set_media_keys";
import type { IEmeApiImplementation } from "./eme-api-implementation";

/**
 * @param {Object} emeImplementation
 * @param {Object} mediaElement
 * @param {Object|null} mediaKeys
 * @returns {Promise}
 */
export function setMediaKeys(
  emeImplementation: IEmeApiImplementation,
  mediaElement: IMediaElement,
  mediaKeys: IMediaKeys | null,
): Promise<unknown> {
  const prom = emeImplementation
    .setMediaKeys(mediaElement, mediaKeys)
    .then(() => {
      log.info("Compat: MediaKeys updated with success");
    })
    .catch((err) => {
      if (mediaKeys === null) {
        log.error(
          "Compat: Could not reset MediaKeys",
          err instanceof Error ? err : "Unknown Error",
        );
        return;
      }
      log.error(
        "Compat: Could not update MediaKeys",
        err instanceof Error ? err : "Unknown Error",
      );
      throw err;
    });

  if (shouldAwaitSetMediaKeys()) {
    return prom;
  }

  return Promise.race([
    prom,

    // Because we know how much EME has implementation issues, let's not block
    // everything because that API hangs
    sleep(1000),
  ]);
}
