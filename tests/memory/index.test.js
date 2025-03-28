import { expect, describe, afterEach, test } from "vitest";
import RxPlayer from "../../src";
import VideoThumbnailLoader, {
  DASH_LOADER,
} from "../../src/experimental/tools/VideoThumbnailLoader";
import { manifestInfos, trickModeInfos } from "../contents/DASH_static_SegmentTimeline";
import sleep from "../utils/sleep.js";
import waitForPlayerState, {
  waitForLoadedStateAfterLoadVideo,
} from "../utils/waitForPlayerState";

let player;

describe("Memory tests", () => {
  afterEach(() => {
    if (player != null) {
      player.dispose();
      window.gc();
    }
  });

  test(
    "should not have a sensible memory leak after playing a content",
    {
      timeout: 15 * 60 * 1000,
      retry: 2,
    },
    async function () {
      if (
        window.performance == null ||
        window.performance.memory == null ||
        window.gc == null
      ) {
        // eslint-disable-next-line no-console
        console.warn("API not available. Skipping test.");
        return;
      }
      player = new RxPlayer({
        initialVideoBitrate: Infinity,
        initialAudioBitrate: Infinity,
      });
      window.gc();
      await sleep(5000);
      const initialMemory = window.performance.memory;

      player.loadVideo({
        url: manifestInfos.url,
        transport: manifestInfos.transport,
        autoPlay: true,
      });
      player.setPlaybackRate(4);
      await waitForPlayerState(player, "ENDED");

      player.stop();
      await sleep(5000);
      window.gc();
      await sleep(10000);
      const newMemory = window.performance.memory;
      const heapDifference = newMemory.usedJSHeapSize - initialMemory.usedJSHeapSize;

      // eslint-disable-next-line no-console
      console.log(`
      ===========================================================
      | Current heap usage (B) | ${newMemory.usedJSHeapSize}
      | Initial heap usage (B) | ${initialMemory.usedJSHeapSize}
      | Difference (B)         | ${heapDifference}
    `);
      expect(heapDifference).to.be.below(2e6);
    },
  );

  test(
    "should not have a sensible memory leak after 5000 LOADED states and adaptive streaming",
    {
      timeout: 10 * 60 * 1000,
      retry: 2,
    },
    async function () {
      if (
        window.performance == null ||
        window.performance.memory == null ||
        window.gc == null
      ) {
        // eslint-disable-next-line no-console
        console.warn("API not available. Skipping test.");
        return;
      }
      player = new RxPlayer({
        initialVideoBitrate: Infinity,
        initialAudiobitrate: Infinity,
      });
      await sleep(1000);
      window.gc();
      await sleep(5000);
      const initialMemory = window.performance.memory;

      for (let i = 0; i < 5000; i++) {
        player.loadVideo({
          url: manifestInfos.url,
          transport: manifestInfos.transport,
          autoPlay: true,
        });
        await waitForLoadedStateAfterLoadVideo(player);
      }
      player.stop();

      await sleep(5000);
      window.gc();
      await sleep(15000);
      const newMemory = window.performance.memory;
      const heapDifference = newMemory.usedJSHeapSize - initialMemory.usedJSHeapSize;

      // eslint-disable-next-line no-console
      console.log(`
      ===========================================================
      | Current heap usage (B) | ${newMemory.usedJSHeapSize}
      | Initial heap usage (B) | ${initialMemory.usedJSHeapSize}
      | Difference (B)         | ${heapDifference}
    `);
      expect(heapDifference).to.be.below(7e6);
    },
  );

  test(
    "should not have a sensible memory leak after 50000 instances of the RxPlayer",
    {
      timeout: 30 * 60 * 1000,
      retry: 2,
    },
    async function () {
      if (
        window.performance == null ||
        window.performance.memory == null ||
        window.gc == null
      ) {
        // eslint-disable-next-line no-console
        console.warn("API not available. Skipping test.");
        return;
      }
      window.gc();
      await sleep(5000);
      const initialMemory = window.performance.memory;
      for (let i = 0; i < 50000; i++) {
        player = new RxPlayer({
          initialVideoBitrate: Infinity,
          initialAudiobitrate: Infinity,
          preferredtexttracks: [{ language: "fra", closedcaption: true }],
        });
        player.dispose();
      }
      await sleep(5000);
      window.gc();
      await sleep(70000);
      const newMemory = window.performance.memory;
      const heapDifference = newMemory.usedJSHeapSize - initialMemory.usedJSHeapSize;

      // eslint-disable-next-line no-console
      console.log(`
      ===========================================================
      | Current heap usage (B) | ${newMemory.usedJSHeapSize}
      | Initial heap usage (B) | ${initialMemory.usedJSHeapSize}
      | Difference (B)         | ${heapDifference}
    `);
      expect(heapDifference).to.be.below(7e6);
    },
  );

  test(
    "should not have a sensible memory leak after many video quality switches",
    {
      timeout: 15 * 60 * 1000,
      retry: 2,
    },
    async function () {
      if (
        window.performance == null ||
        window.performance.memory == null ||
        window.gc == null
      ) {
        // eslint-disable-next-line no-console
        console.warn("API not available. Skipping test.");
        return;
      }
      player = new RxPlayer({
        initialVideoBitrate: Infinity,
        initialAudiobitrate: Infinity,
        preferredtexttracks: [{ language: "fra", closedcaption: true }],
      });
      await sleep(1000);
      player.setWantedBufferAhead(5);
      player.setMaxBufferBehind(5);
      player.setMaxBufferAhead(15);
      player.loadVideo({
        url: manifestInfos.url,
        transport: manifestInfos.transport,
        autoPlay: false,
      });
      await waitForLoadedStateAfterLoadVideo(player);
      const videoTrack = player.getVideoTrack();
      if (videoTrack.representations.length <= 1) {
        throw new Error(
          "Not enough video Representations to perform sufficiently pertinent tests",
        );
      }
      await sleep(5000);

      window.gc();
      await sleep(5000);
      const initialMemory = window.performance.memory;

      // Allows to alternate between two positions
      let seekToBeginning = false;
      for (let iterationIdx = 0; iterationIdx < 500; iterationIdx++) {
        if (seekToBeginning) {
          player.seekTo(0);
        } else {
          player.seekTo(20);
          seekToBeginning = true;
        }
        const repIdx = iterationIdx % videoTrack.representations.length;
        player.lockVideoRepresentations([videoTrack.representations[repIdx].id]);
        await sleep(1000);
      }
      await sleep(5000);
      window.gc();
      await sleep(10000);
      const newMemory = window.performance.memory;
      const heapDifference = newMemory.usedJSHeapSize - initialMemory.usedJSHeapSize;

      // eslint-disable-next-line no-console
      console.log(`
      ===========================================================
      | Current heap usage (B) | ${newMemory.usedJSHeapSize}
      | Initial heap usage (B) | ${initialMemory.usedJSHeapSize}
      | Difference (B)         | ${heapDifference}
    `);
      expect(heapDifference).to.be.below(9e6);
    },
  );

  // TODO FIXME This one failed after a chrome update, no idea why for now
  test.skip(
    "should not have a sensible memory leak after 1000 setTime calls of VideoThumbnailLoader",
    {
      timeout: 5 * 60 * 1000,
      retry: 2,
    },
    async function () {
      if (
        window.performance == null ||
        window.performance.memory == null ||
        window.gc == null
      ) {
        // eslint-disable-next-line no-console
        console.warn("API not available. Skipping test.");
        return;
      }
      player = new RxPlayer({
        initialVideoBitrate: Infinity,
        initialAudiobitrate: Infinity,
      });
      const vtlVideoElement = document.createElement("video");
      VideoThumbnailLoader.addLoader(DASH_LOADER);
      const videoThumbnailLoader = new VideoThumbnailLoader(vtlVideoElement, player);
      await sleep(1000);
      window.gc();
      await sleep(10000);
      const initialMemory = window.performance.memory;

      player.loadVideo({
        url: trickModeInfos.url,
        transport: trickModeInfos.transport,
        autoPlay: true,
      });
      await waitForLoadedStateAfterLoadVideo(player);

      for (let c = 0; c < 1000; c++) {
        await videoThumbnailLoader.setTime(c % 101);
      }

      player.stop();
      videoThumbnailLoader.dispose();
      await sleep(5000);
      window.gc();
      await sleep(10000);
      const newMemory = window.performance.memory;
      const heapDifference = newMemory.usedJSHeapSize - initialMemory.usedJSHeapSize;

      // eslint-disable-next-line no-console
      console.log(`
      ===========================================================
      | Current heap usage (B) | ${newMemory.usedJSHeapSize}
      | Initial heap usage (B) | ${initialMemory.usedJSHeapSize}
      | Difference (B)         | ${heapDifference}
    `);
      expect(heapDifference).to.be.below(1e6);
    },
  );
});
