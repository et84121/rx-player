import { describe, beforeEach, afterEach, it, expect } from "vitest";
import RxPlayer from "../../../dist/es2017";
import { streamEventsInfos } from "../../contents/DASH_static_SegmentTimeline";
import sleep from "../../utils/sleep.js";
import {
  /* waitForPlayerState, */ waitForLoadedStateAfterLoadVideo,
} from "../../utils/waitForPlayerState";
import { checkAfterSleepWithBackoff } from "../../utils/checkAfterSleepWithBackoff.js";

const EVENTS = streamEventsInfos.events;

describe("DASH Stream events", function () {
  let player;

  async function loadContent(position) {
    player.loadVideo({
      url: streamEventsInfos.url,
      transport: streamEventsInfos.transport,
      startAt: { position },
    });
    await waitForLoadedStateAfterLoadVideo(player);
  }

  beforeEach(() => {
    player = new RxPlayer();
  });

  afterEach(() => {
    player.dispose();
  });

  /**
   * Check that a received stream event is the same one that the descriptive
   * object exported jointly with the content information.
   * @param {Object} receivedEvent
   * @param {Object} wantedEvent
   */
  function checkEvent(receivedEvent, wantedEvent) {
    expect(receivedEvent.start).to.equal(wantedEvent.start);
    expect(receivedEvent.end).to.equal(wantedEvent.end);
    expect(receivedEvent.data.type).to.equal(wantedEvent.type);
    expect(receivedEvent.data.value.schemeIdUri).to.equal(wantedEvent.schemeIdUri);
    expect(receivedEvent.data.value.timescale).to.equal(wantedEvent.timescale);

    const elt = receivedEvent.data.value.element;
    expect(elt).to.be.instanceOf(Element);
    expect(wantedEvent.elt).to.include(elt.outerHTML);
  }

  /**
   * Expect that no "streamEvent" nor "streamEventSkip" events are received when
   * loading a content at the given position and playing for around 3 seconds.
   * @param {Object} opts
   * @returns {Promise}
   */
  async function expectNoEvent({ startAt }) {
    const streamEventsReceived = [];
    const streamEventSkipReceived = [];
    function onStreamEvent(evt) {
      streamEventsReceived.push(evt);
    }
    function onStreamEventSkip(evt) {
      streamEventSkipReceived.push(evt);
    }
    player.addEventListener("streamEvent", onStreamEvent);
    player.addEventListener("streamEventSkip", onStreamEventSkip);
    await loadContent(startAt);

    player.play();
    await checkAfterSleepWithBackoff(
      { minTimeMs: 1000, stepMs: 100, maxTimeMs: 5000 },
      () => {
        expect(player.getPosition()).to.be.within(
          startAt + 1,
          startAt + 5,
          "The initial position is not right",
        );
      },
    );
    player.pause();
    expect(streamEventsReceived).to.have.lengthOf(
      0,
      "We should not have received any streamEvent event",
    );
    expect(streamEventSkipReceived).to.have.lengthOf(
      0,
      "We should not have received any streamEventSkipReceived event",
    );
  }

  it("should not send any event if none have been reached yet", async function () {
    await expectNoEvent({ startAt: 0 });
  }, 10000);

  it("should not send any event if loading at a position after all events", async function () {
    await expectNoEvent({ startAt: 180 });
  }, 10000);

  it("should not send any event if loading at a position between events", async function () {
    await expectNoEvent({ startAt: 80 });
  }, 10000);

  it("should receive event when loading right in one", async function () {
    const streamEventsReceived = [];
    const streamEventSkipReceived = [];
    function onStreamEvent(evt) {
      streamEventsReceived.push(evt);
    }
    function onStreamEventSkip(evt) {
      streamEventSkipReceived.push(evt);
    }
    player.addEventListener("streamEvent", onStreamEvent);
    player.addEventListener("streamEventSkip", onStreamEventSkip);

    const wantedEvent = EVENTS.periods[1][2]; // ~105 -> ~110
    await loadContent(wantedEvent.start + 2);
    await checkAfterSleepWithBackoff({ maxTimeMs: 100, stepMs: 100 }, () => {
      expect(streamEventSkipReceived).to.have.lengthOf(
        0,
        "We should not have received any streamEventSkipReceived event",
      );

      expect(streamEventsReceived).to.have.lengthOf(
        1,
        "We should have received one streamEvent event",
      );
    });

    const streamEvent = streamEventsReceived[0];
    checkEvent(streamEvent, wantedEvent);

    let hasExited = false;
    streamEvent.onExit = () => {
      hasExited = true;
    };
    player.seekTo(wantedEvent.end + 0.5);

    await checkAfterSleepWithBackoff({ maxTimeMs: 100, stepMs: 100 }, () => {
      expect(hasExited).to.equal(true);
      expect(streamEventSkipReceived).to.have.lengthOf(0);
      expect(streamEventsReceived).to.have.lengthOf(1);
    });
  }, 10000);

  it("should receive an event when playing through one", async function () {
    const streamEventsReceived = [];
    const streamEventSkipReceived = [];
    function onStreamEvent(evt) {
      streamEventsReceived.push(evt);
    }
    function onStreamEventSkip(evt) {
      streamEventSkipReceived.push(evt);
    }
    player.addEventListener("streamEvent", onStreamEvent);
    player.addEventListener("streamEventSkip", onStreamEventSkip);

    const wantedEvent = EVENTS.periods[1][4]; //  -> ~141.5 -> ~144.5
    await loadContent(wantedEvent.start - 1);
    await sleep(100);
    expect(streamEventSkipReceived).to.have.lengthOf(0);
    expect(streamEventsReceived).to.have.lengthOf(0);
    player.setPlaybackRate(1);
    player.play();

    await checkAfterSleepWithBackoff(
      { minTimeMs: 1000, stepMs: 100, maxTimeMs: 3000 },
      () => {
        expect(player.getPosition()).to.be.within(
          142,
          144,
          "The position 1 is not right",
        );
      },
    );

    expect(streamEventSkipReceived).to.have.lengthOf(0);
    expect(streamEventsReceived).to.have.lengthOf(1);

    const eventReceived = streamEventsReceived[0];
    checkEvent(eventReceived, wantedEvent);

    let hasExited = false;
    eventReceived.onExit = () => {
      hasExited = true;
    };

    await checkAfterSleepWithBackoff(
      { minTimeMs: 2400, stepMs: 100, maxTimeMs: 3000 },
      () => {
        expect(player.getPosition()).to.be.within(
          145,
          150,
          "The position 2 is not right",
        );
      },
    );
    expect(hasExited).to.equal(true);
    expect(streamEventSkipReceived).to.have.lengthOf(0);
    expect(streamEventsReceived).to.have.lengthOf(1);
  }, 10000);

  it("should call onExit when seeking out of an event", async function () {
    const streamEventsReceived = [];
    const streamEventSkipReceived = [];
    function onStreamEvent(evt) {
      streamEventsReceived.push(evt);
    }
    function onStreamEventSkip(evt) {
      streamEventSkipReceived.push(evt);
    }
    player.addEventListener("streamEvent", onStreamEvent);
    player.addEventListener("streamEventSkip", onStreamEventSkip);

    const wantedEvent = EVENTS.periods[1][4]; //  -> ~141.5 -> ~144.5
    await loadContent(wantedEvent.start - 1);
    await sleep(100);
    expect(streamEventSkipReceived).to.have.lengthOf(0);
    expect(streamEventsReceived).to.have.lengthOf(0);
    player.setPlaybackRate(1);
    player.play();

    await checkAfterSleepWithBackoff(
      { minTimeMs: 2400, stepMs: 100, maxTimeMs: 3000 },
      () => {
        expect(player.getPosition()).to.be.within(
          142,
          144,
          "The position 1 is not right",
        );
      },
    );

    expect(streamEventSkipReceived).to.have.lengthOf(0);
    expect(streamEventsReceived).to.have.lengthOf(1);

    const eventReceived = streamEventsReceived[0];
    checkEvent(eventReceived, wantedEvent);

    let hasExited = false;
    eventReceived.onExit = () => {
      hasExited = true;
    };

    player.seekTo(145);
    await checkAfterSleepWithBackoff(
      { minTimeMs: 100, stepMs: 50, maxTimeMs: 200 },
      () => {
        expect(hasExited).to.equal(true);
        expect(streamEventSkipReceived).to.have.lengthOf(0);
        expect(streamEventsReceived).to.have.lengthOf(1);
      },
    );
  }, 10000);

  it("should authorize setting no onExit function", async function () {
    const streamEventsReceived = [];
    const streamEventSkipReceived = [];
    function onStreamEvent(evt) {
      streamEventsReceived.push(evt);
    }
    function onStreamEventSkip(evt) {
      streamEventSkipReceived.push(evt);
    }
    player.addEventListener("streamEvent", onStreamEvent);
    player.addEventListener("streamEventSkip", onStreamEventSkip);

    const wantedEvent = EVENTS.periods[1][4]; //  -> ~141.5 -> ~144.5
    await loadContent(wantedEvent.start - 1);
    await sleep(100);
    expect(streamEventSkipReceived).to.have.lengthOf(0);
    expect(streamEventsReceived).to.have.lengthOf(0);
    player.setPlaybackRate(1);
    player.play();

    await checkAfterSleepWithBackoff(
      { minTimeMs: 1000, stepMs: 100, maxTimeMs: 3000 },
      () => {
        expect(player.getPosition()).to.be.within(
          142,
          144,
          "The position 1 is not right",
        );
      },
    );

    expect(streamEventSkipReceived).to.have.lengthOf(0);
    expect(streamEventsReceived).to.have.lengthOf(1);

    const eventReceived = streamEventsReceived[0];
    checkEvent(eventReceived, wantedEvent);

    await checkAfterSleepWithBackoff(
      { minTimeMs: 2400, stepMs: 100, maxTimeMs: 3000 },
      () => {
        expect(player.getPosition()).to.be.within(
          145,
          150,
          "The position 2 is not right",
        );
      },
    );
    expect(streamEventSkipReceived).to.have.lengthOf(0);
    expect(streamEventsReceived).to.have.lengthOf(1);
  }, 10000);

  it("should do nothing if seeking multiple times in the same event", async function () {
    const streamEventsReceived = [];
    const streamEventSkipReceived = [];
    function onStreamEvent(evt) {
      streamEventsReceived.push(evt);
    }
    function onStreamEventSkip(evt) {
      streamEventSkipReceived.push(evt);
    }
    player.addEventListener("streamEvent", onStreamEvent);
    player.addEventListener("streamEventSkip", onStreamEventSkip);

    const wantedEvent = EVENTS.periods[1][4]; //  -> ~141.5 -> ~144.5
    await loadContent(wantedEvent.start - 1);
    await sleep(100);
    expect(streamEventSkipReceived).to.have.lengthOf(0);
    expect(streamEventsReceived).to.have.lengthOf(0);
    player.setPlaybackRate(1);
    player.play();

    await checkAfterSleepWithBackoff(
      { minTimeMs: 1000, stepMs: 100, maxTimeMs: 3000 },
      () => {
        expect(player.getPosition()).to.be.within(
          142,
          144,
          "The position 1 is not right",
        );
      },
    );

    expect(streamEventSkipReceived).to.have.lengthOf(0);
    expect(streamEventsReceived).to.have.lengthOf(1);

    const eventReceived = streamEventsReceived[0];
    checkEvent(eventReceived, wantedEvent);

    let hasExited = false;
    eventReceived.onExit = () => {
      hasExited = true;
    };

    player.seekTo(142);
    await sleep(100);
    player.seekTo(143);
    await sleep(100);

    expect(streamEventSkipReceived).to.have.lengthOf(0);
    expect(streamEventsReceived).to.have.lengthOf(1);
    expect(hasExited).to.equal(false);

    await checkAfterSleepWithBackoff(
      { minTimeMs: 1000, stepMs: 100, maxTimeMs: 3000 },
      () => {
        expect(player.getPosition()).to.be.within(
          145,
          150,
          "The position 2 is not right",
        );
      },
    );

    expect(streamEventSkipReceived).to.have.lengthOf(0);
    expect(streamEventsReceived).to.have.lengthOf(1);
    expect(hasExited).to.equal(true);
    expect(streamEventSkipReceived).to.have.lengthOf(0);
    expect(streamEventsReceived).to.have.lengthOf(1);
  }, 10000);

  it("should receive an event when seeking right into one", async function () {
    const streamEventsReceived = [];
    const streamEventSkipReceived = [];
    function onStreamEvent(evt) {
      streamEventsReceived.push(evt);
    }
    function onStreamEventSkip(evt) {
      streamEventSkipReceived.push(evt);
    }
    player.addEventListener("streamEvent", onStreamEvent);
    player.addEventListener("streamEventSkip", onStreamEventSkip);

    const wantedEvent = EVENTS.periods[1][4]; //  -> ~141.5 -> ~144.5
    await loadContent(wantedEvent.start - 1);
    await sleep(100);
    player.setPlaybackRate(1);
    player.play();
    expect(streamEventSkipReceived).to.have.lengthOf(0);
    expect(streamEventsReceived).to.have.lengthOf(0);
    player.seekTo(142);

    await checkAfterSleepWithBackoff(
      { minTimeMs: 1000, stepMs: 100, maxTimeMs: 1200 },
      () => {
        expect(player.getPosition()).to.be.within(
          142,
          144,
          "The position 1 is not right",
        );
      },
    );

    expect(streamEventSkipReceived).to.have.lengthOf(0);
    expect(streamEventsReceived).to.have.lengthOf(1);

    const eventReceived = streamEventsReceived[0];
    checkEvent(eventReceived, wantedEvent);

    let hasExited = false;
    eventReceived.onExit = () => {
      hasExited = true;
    };

    await checkAfterSleepWithBackoff(
      { minTimeMs: 2400, stepMs: 100, maxTimeMs: 5000 },
      () => {
        expect(player.getPosition()).to.be.within(
          145,
          150,
          "The position 2 is not right",
        );
      },
    );
    expect(hasExited).to.equal(true);
    expect(streamEventSkipReceived).to.have.lengthOf(0);
    expect(streamEventsReceived).to.have.lengthOf(1);
  }, 10000);

  it("should receive multiple events when playing through a position with multiple events", async function () {
    const streamEventsReceived = [];
    const streamEventSkipReceived = [];
    function onStreamEvent(evt) {
      streamEventsReceived.push(evt);
    }
    function onStreamEventSkip(evt) {
      streamEventSkipReceived.push(evt);
    }
    player.addEventListener("streamEvent", onStreamEvent);
    player.addEventListener("streamEventSkip", onStreamEventSkip);

    const wantedEvent1 = EVENTS.periods[0][2]; //  -> 40 - 50
    const wantedEvent2 = EVENTS.periods[0][3]; //  -> 45 - 54
    await loadContent(wantedEvent1.start - 1);
    await sleep(100);
    player.setPlaybackRate(1);
    player.play();

    await checkAfterSleepWithBackoff(
      { minTimeMs: 1500, stepMs: 100, maxTimeMs: 2800 },
      () => {
        expect(player.getPosition()).to.be.within(41, 44, "The position 1 is not right");
        expect(streamEventSkipReceived).to.have.lengthOf(0);
        expect(streamEventsReceived).to.have.lengthOf(1);
      },
    );

    const eventReceived1 = streamEventsReceived[0];
    checkEvent(eventReceived1, wantedEvent1);

    let hasExited1 = false;
    eventReceived1.onExit = () => {
      hasExited1 = true;
    };

    let leftToWait = 45 - player.getPosition();
    await checkAfterSleepWithBackoff(
      { minTimeMs: leftToWait * 1000, maxTimeMs: leftToWait * 1000 * 1.5, stepMs: 100 },
      () => {
        expect(player.getPosition()).to.be.within(45, 50, "The position 2 is not right");

        expect(hasExited1).to.equal(false, "should not have exited the first event");
        expect(streamEventSkipReceived).to.have.lengthOf(0);
        expect(streamEventsReceived).to.have.lengthOf(2);
      },
    );

    const eventReceived2 = streamEventsReceived[1];
    checkEvent(eventReceived2, wantedEvent2);

    let hasExited2 = false;
    eventReceived2.onExit = () => {
      hasExited2 = true;
    };

    leftToWait = 50 - player.getPosition();
    await checkAfterSleepWithBackoff(
      { minTimeMs: leftToWait * 1000, maxTimeMs: leftToWait * 1000 * 1.5, stepMs: 1 },
      () => {
        expect(player.getPosition()).to.be.within(50, 54, "The position 3 is not right");

        expect(hasExited1).to.equal(true, "should have exited the first event");
        expect(hasExited2).to.equal(false, "should not have exited the second event");
        expect(streamEventSkipReceived).to.have.lengthOf(0);
        expect(streamEventsReceived).to.have.lengthOf(2);
      },
    );

    leftToWait = 54 - player.getPosition();
    await checkAfterSleepWithBackoff(
      { minTimeMs: leftToWait * 1000, maxTimeMs: leftToWait * 1000 * 1.5, stepMs: 1 },
      () => {
        expect(player.getPosition()).to.be.within(54, 59, "The position 4 is not right");

        expect(hasExited2).to.equal(true, "should have exited the second event");
        expect(streamEventSkipReceived).to.have.lengthOf(0);
        expect(streamEventsReceived).to.have.lengthOf(2);
      },
    );
  }, 30000);

  it("should receive multiple events when seeking in a position with multiple events", async function () {
    const streamEventsReceived = [];
    const streamEventSkipReceived = [];
    function onStreamEvent(evt) {
      streamEventsReceived.push(evt);
    }
    function onStreamEventSkip(evt) {
      streamEventSkipReceived.push(evt);
    }
    player.addEventListener("streamEvent", onStreamEvent);
    player.addEventListener("streamEventSkip", onStreamEventSkip);

    const wantedEvent1 = EVENTS.periods[0][2]; //  -> 40 - 50
    const wantedEvent2 = EVENTS.periods[0][3]; //  -> 45 - 54
    await loadContent(38);
    await sleep(100);
    player.setPlaybackRate(1);
    player.play();

    expect(streamEventSkipReceived).to.have.lengthOf(0);
    expect(streamEventsReceived).to.have.lengthOf(0);

    player.seekTo(48);
    await sleep(300);

    expect(streamEventSkipReceived).to.have.lengthOf(0);
    expect(streamEventsReceived).to.have.lengthOf(2);

    let eventReceived1;
    let eventReceived2;

    if (streamEventsReceived[0].start === wantedEvent1.start) {
      eventReceived1 = streamEventsReceived[0];
      eventReceived2 = streamEventsReceived[1];
    } else {
      eventReceived1 = streamEventsReceived[1];
      eventReceived2 = streamEventsReceived[0];
    }
    checkEvent(eventReceived1, wantedEvent1);
    checkEvent(eventReceived2, wantedEvent2);

    let hasExited1 = false;
    eventReceived1.onExit = () => {
      hasExited1 = true;
    };

    let hasExited2 = false;
    eventReceived2.onExit = () => {
      hasExited2 = true;
    };

    let leftToWait = 50 - player.getPosition();
    await checkAfterSleepWithBackoff(
      { minTimeMs: leftToWait * 1000, maxTimeMs: leftToWait * 1000 * 1.5, stepMs: 100 },
      () => {
        expect(player.getPosition()).to.be.within(50, 54, "The position 3 is not right");
        expect(hasExited1).to.equal(true);
        expect(hasExited2).to.equal(false);
        expect(streamEventSkipReceived).to.have.lengthOf(0);
        expect(streamEventsReceived).to.have.lengthOf(2);
      },
    );

    leftToWait = 54 - player.getPosition();
    await checkAfterSleepWithBackoff(
      { minTimeMs: leftToWait * 1000, maxTimeMs: leftToWait * 1000 * 1.5, stepMs: 100 },
      () => {
        expect(player.getPosition()).to.be.within(54, 58, "The position 4 is not right");
        expect(hasExited2).to.equal(true);
        expect(streamEventSkipReceived).to.have.lengthOf(0);
        expect(streamEventsReceived).to.have.lengthOf(2);
      },
    );
  }, 15000);

  it("should receive multiple events when loading in a position with multiple events", async function () {
    const streamEventsReceived = [];
    const streamEventSkipReceived = [];
    function onStreamEvent(evt) {
      streamEventsReceived.push(evt);
    }
    function onStreamEventSkip(evt) {
      streamEventSkipReceived.push(evt);
    }
    player.addEventListener("streamEvent", onStreamEvent);
    player.addEventListener("streamEventSkip", onStreamEventSkip);

    const wantedEvent1 = EVENTS.periods[0][2]; //  -> 40 - 50
    const wantedEvent2 = EVENTS.periods[0][3]; //  -> 45 - 54
    player.setPlaybackRate(1);
    await loadContent(48);
    await sleep(150);
    expect(streamEventSkipReceived).to.have.lengthOf(0);
    expect(streamEventsReceived).to.have.lengthOf(2);

    let eventReceived1;
    let eventReceived2;

    if (streamEventsReceived[0].start === wantedEvent1.start) {
      eventReceived1 = streamEventsReceived[0];
      eventReceived2 = streamEventsReceived[1];
    } else {
      eventReceived1 = streamEventsReceived[1];
      eventReceived2 = streamEventsReceived[0];
    }

    checkEvent(eventReceived1, wantedEvent1);
    checkEvent(eventReceived2, wantedEvent2);

    let hasExited1 = false;
    eventReceived1.onExit = () => {
      hasExited1 = true;
    };

    let hasExited2 = false;
    eventReceived2.onExit = () => {
      hasExited2 = true;
    };

    player.play();

    let leftToWait = 50 - player.getPosition();
    await checkAfterSleepWithBackoff(
      { minTimeMs: leftToWait * 1000, maxTimeMs: leftToWait * 1000 * 1.5, stepMs: 100 },
      () => {
        expect(player.getPosition()).to.be.within(50, 54, "The position 3 is not right");

        expect(hasExited1).to.equal(true);
        expect(hasExited2).to.equal(false);
        expect(streamEventSkipReceived).to.have.lengthOf(0);
        expect(streamEventsReceived).to.have.lengthOf(2);
      },
    );

    leftToWait = 54 - player.getPosition();
    await checkAfterSleepWithBackoff(
      { minTimeMs: leftToWait * 1000, maxTimeMs: leftToWait * 1000 * 1.5, stepMs: 100 },
      () => {
        expect(player.getPosition()).to.be.within(54, 58, "The position 4 is not right");

        expect(hasExited2).to.equal(true);
        expect(streamEventSkipReceived).to.have.lengthOf(0);
        expect(streamEventsReceived).to.have.lengthOf(2);
      },
    );
  }, 15000);

  it(
    "should receive an event when skipping one",
    async function () {
      const streamEventsReceived = [];
      const streamEventSkipReceived = [];

      let hasExitedSomething = false;
      function onStreamEvent(evt) {
        streamEventsReceived.push(evt);
        evt.onExit = function () {
          hasExitedSomething = true;
        };
      }
      function onStreamEventSkip(evt) {
        streamEventSkipReceived.push(evt);
        evt.onExit = function () {
          hasExitedSomething = true;
        };
      }
      player.addEventListener("streamEvent", onStreamEvent);
      player.addEventListener("streamEventSkip", onStreamEventSkip);

      const wantedEvent = EVENTS.periods[0][0]; //  -> 5 - 8
      await loadContent(0);
      await sleep(1000);

      player.seekTo(9);

      await checkAfterSleepWithBackoff(
        { minTimeMs: 600, maxTimeMs: 3000, stepMs: 100 },
        () => {
          expect(streamEventSkipReceived).to.have.lengthOf(1);
          expect(streamEventsReceived).to.have.lengthOf(0);
          expect(hasExitedSomething).to.equal(false);

          const eventReceived = streamEventSkipReceived[0];
          checkEvent(eventReceived, wantedEvent);
        },
      );
    },
    { timeout: 5000 },
  );

  it(
    "should receive multiple events when skipping multiple ones",
    async function () {
      const streamEventsReceived = [];
      const streamEventSkipReceived = [];

      let hasExitedSomething = false;
      function onStreamEvent(evt) {
        streamEventsReceived.push(evt);
        evt.onExit = function () {
          hasExitedSomething = true;
        };
      }
      function onStreamEventSkip(evt) {
        streamEventSkipReceived.push(evt);
        evt.onExit = function () {
          hasExitedSomething = true;
        };
      }
      player.addEventListener("streamEvent", onStreamEvent);
      player.addEventListener("streamEventSkip", onStreamEventSkip);

      const wantedEvent1 = EVENTS.periods[0][0]; //  -> 5 - 8
      const wantedEvent2 = EVENTS.periods[0][1]; //  -> 20
      await loadContent(0);
      await sleep(3000);

      player.seekTo(24);

      await checkAfterSleepWithBackoff(
        { minTimeMs: 500, maxTimeMs: 2000, stepMs: 100 },
        () => {
          expect(streamEventSkipReceived).to.have.lengthOf(2);
          expect(streamEventsReceived).to.have.lengthOf(0);
          expect(hasExitedSomething).to.equal(false);

          let eventReceived1;
          let eventReceived2;

          if (streamEventSkipReceived[0].start === wantedEvent1.start) {
            eventReceived1 = streamEventSkipReceived[0];
            eventReceived2 = streamEventSkipReceived[1];
          } else {
            eventReceived1 = streamEventSkipReceived[1];
            eventReceived2 = streamEventSkipReceived[0];
          }

          checkEvent(eventReceived1, wantedEvent1);
          checkEvent(eventReceived2, wantedEvent2);
        },
      );
    },
    { timeout: 7000 },
  );

  it("should not exit events without a duration", async function () {
    const streamEventsReceived = [];
    const streamEventSkipReceived = [];

    let hasExitedSomething = false;
    function onStreamEvent(evt) {
      streamEventsReceived.push(evt);
      evt.onExit = function () {
        hasExitedSomething = true;
      };
    }
    function onStreamEventSkip(evt) {
      streamEventSkipReceived.push(evt);
      evt.onExit = function () {
        hasExitedSomething = true;
      };
    }
    player.addEventListener("streamEvent", onStreamEvent);
    player.addEventListener("streamEventSkip", onStreamEventSkip);

    const wantedEvent = EVENTS.periods[0][1]; //  -> 20
    await loadContent(19);
    await sleep(100);
    player.setPlaybackRate(1);
    player.play();
    await checkAfterSleepWithBackoff(
      { mintimems: 4500, maxtimems: 6000, stepms: 100 },
      () => {
        expect(streamEventSkipReceived).to.have.lengthOf(0);
        expect(streamEventsReceived).to.have.lengthOf(1);
        expect(hasExitedSomething).to.equal(false);

        const eventReceived = streamEventsReceived[0];
        checkEvent(eventReceived, wantedEvent);
      },
    );
  }, 10000);

  it("should receive an event and be able to set an exit even when the event is very short", async function () {
    const streamEventsReceived = [];
    const streamEventSkipReceived = [];

    let hasExitedSomething = false;
    function onStreamEvent(evt) {
      streamEventsReceived.push(evt);
      evt.onExit = function () {
        hasExitedSomething = true;
      };
    }
    function onStreamEventSkip(evt) {
      streamEventSkipReceived.push(evt);
      evt.onExit = function () {
        hasExitedSomething = true;
      };
    }
    player.addEventListener("streamEvent", onStreamEvent);
    player.addEventListener("streamEventSkip", onStreamEventSkip);

    const wantedEvent = EVENTS.periods[1][5]; //  -> 161.568367 - 161.568368
    await loadContent(160);
    await sleep(100);
    expect(streamEventSkipReceived).to.have.lengthOf(0);
    expect(streamEventsReceived).to.have.lengthOf(0);

    player.setPlaybackRate(1);
    player.play();
    await checkAfterSleepWithBackoff(
      { minTimeMs: 4500, maxTimeMs: 6000, stepMs: 100 },
      () => {
        expect(player.getPosition()).to.be.within(
          163,
          167,
          "The position 1 is not right",
        );

        expect(streamEventsReceived).to.have.lengthOf(1);
        expect(streamEventSkipReceived).to.have.lengthOf(0);
        expect(hasExitedSomething).to.equal(
          true,
          "should have called the onExit function",
        );

        const eventReceived = streamEventsReceived[0];
        checkEvent(eventReceived, wantedEvent);
      },
    );
  }, 10000);
});
