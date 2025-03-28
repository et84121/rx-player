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

import { describe, beforeEach, afterEach, it, expect } from "vitest";
import RxPlayer from "../../../dist/es2017";
import directfileInfos from "../../contents/directfile_webm";
import sleep from "../../utils/sleep.js";
import { waitForLoadedStateAfterLoadVideo } from "../../utils/waitForPlayerState";
import { checkAfterSleepWithBackoff } from "../../utils/checkAfterSleepWithBackoff.js";

const WebMURL = directfileInfos.url;
describe("basic playback use cases: direct file", function () {
  let player;

  beforeEach(() => {
    player = new RxPlayer();
  });

  afterEach(() => {
    player.stop();
    player.dispose();
    URL.revokeObjectURL(WebMURL);
  });

  it("should begin playback on play", async function () {
    player.loadVideo({
      url: WebMURL,
      transport: "directfile",
    });
    await waitForLoadedStateAfterLoadVideo(player);
    player.play();
    await checkAfterSleepWithBackoff({ step: 10 }, () => {
      expect(player.getPosition()).to.be.above(0);
      expect(player.getPosition()).to.be.below(0.25);
      expect(player.getCurrentBufferGap()).to.be.above(0);
      expect(player.getVideoElement().buffered.start(0)).to.be.below(
        player.getPosition(),
      );
    });
  });

  it("should play slowly for a speed inferior to 1", async function () {
    player.loadVideo({
      url: WebMURL,
      transport: "directfile",
    });
    await waitForLoadedStateAfterLoadVideo(player);
    player.setPlaybackRate(0.5);
    await player.play();
    await sleep(2000);
    const now = performance.now();
    const lastPosition = player.getPosition();
    await checkAfterSleepWithBackoff({ stepMs: 100, maxTimeMs: 3000 }, () => {
      const elapsed = (performance.now() - now) / 1000;
      expect(player.getPosition()).to.be.below(lastPosition + elapsed / 1.7);
      expect(player.getPosition()).to.be.above(lastPosition + elapsed * 0.3);
      expect(player.getPosition()).to.be.above(lastPosition);
      expect(player.getVideoElement().buffered.start(0)).to.be.below(
        player.getPosition(),
      );
      expect(player.getPlaybackRate()).to.equal(0.5);
      expect(player.getVideoElement().playbackRate).to.equal(0.5);
    });
  }, 5000);

  it("should play faster for a speed superior to 1", async function () {
    player.loadVideo({
      url: WebMURL,
      transport: "directfile",
    });
    await waitForLoadedStateAfterLoadVideo(player);
    player.setPlaybackRate(3);
    await player.play();
    await sleep(1200);
    expect(player.getPlayerState()).to.equal("PLAYING");
    expect(player.getPosition()).to.be.below(4);
    expect(player.getPosition()).to.be.above(2);
    expect(player.getCurrentBufferGap()).to.be.above(0);
    expect(player.getVideoElement().buffered.start(0)).to.be.below(player.getPosition());
    expect(player.getPlaybackRate()).to.equal(3);
    expect(player.getVideoElement().playbackRate).to.equal(3);
  });

  it("should be able to seek when loaded", async function () {
    player.loadVideo({
      url: WebMURL,
      transport: "directfile",
    });
    await waitForLoadedStateAfterLoadVideo(player);
    player.seekTo(2);
    expect(player.getPosition()).to.equal(2);
    expect(player.getPlayerState()).to.equal("LOADED");
    player.play();
    await checkAfterSleepWithBackoff({ step: 10, maxTimeMs: 800 }, () => {
      expect(player.getPlayerState()).to.equal("PLAYING");
      expect(player.getPosition()).to.be.above(2);
    });
  });

  it("should seek to minimum position for negative positions when loaded", async function () {
    player.loadVideo({
      url: WebMURL,
      transport: "directfile",
    });
    await waitForLoadedStateAfterLoadVideo(player);
    player.seekTo(-2);
    expect(player.getPosition()).to.equal(player.getMinimumPosition());
    expect(player.getPlayerState()).to.equal("LOADED");
    player.play();
    await checkAfterSleepWithBackoff({ maxTimeMs: 200 }, () => {
      expect(player.getPlayerState()).to.equal("PLAYING");
      expect(player.getPosition()).to.be.above(player.getMinimumPosition());
    });
  });

  it("should seek to maximum position if manual seek is higher than maximum when loaded", async function () {
    player.loadVideo({
      url: WebMURL,
      transport: "directfile",
    });
    await waitForLoadedStateAfterLoadVideo(player);
    player.seekTo(200);
    await checkAfterSleepWithBackoff({ maxTimeMs: 200 }, () => {
      expect(["ENDED", "PAUSED"]).to.include(player.getPlayerState());
      expect(player.getPosition()).to.be.closeTo(player.getMaximumPosition(), 0.1);
    });
  });

  it("should seek to minimum position for negative positions after playing", async function () {
    player.loadVideo({
      url: WebMURL,
      transport: "directfile",
    });
    await waitForLoadedStateAfterLoadVideo(player);
    player.play();
    await sleep(5);
    player.seekTo(-2);
    expect(player.getPosition()).to.be.closeTo(player.getMinimumPosition(), 0.1);
    expect(player.getPlayerState()).to.equal("PLAYING");
  });

  it("should seek to maximum position if manual seek is higher than maximum after playing", async function () {
    player.loadVideo({
      url: WebMURL,
      transport: "directfile",
    });
    await waitForLoadedStateAfterLoadVideo(player);
    expect(player.getPlayerState()).to.equal("LOADED");
    player.play();
    player.seekTo(200);
    expect(player.getPosition()).to.be.closeTo(player.getMaximumPosition(), 0.1);
  });

  it("should seek to minimum position for negative positions when paused", async function () {
    player.loadVideo({
      url: WebMURL,
      transport: "directfile",
    });
    await waitForLoadedStateAfterLoadVideo(player);
    player.play();
    await sleep(100);
    player.pause();
    await sleep(10);
    expect(player.getPlayerState()).to.equal("PAUSED");
    player.seekTo(-2);
    expect(player.getPosition()).to.equal(player.getMinimumPosition());
    expect(player.getPlayerState()).to.equal("PAUSED");
  });

  it("should seek to maximum position if manual seek is higher than maximum when paused", async function () {
    player.loadVideo({
      url: WebMURL,
      transport: "directfile",
    });
    await waitForLoadedStateAfterLoadVideo(player);
    expect(player.getPlayerState()).to.equal("LOADED");
    player.play();
    await sleep(100);
    player.pause();
    await sleep(10);
    expect(player.getPlayerState()).to.equal("PAUSED");
    player.seekTo(10000);
    expect(player.getPosition()).to.be.closeTo(player.getMaximumPosition(), 0.1);
    expect(player.getPlayerState()).to.equal("PAUSED");
  });
});
