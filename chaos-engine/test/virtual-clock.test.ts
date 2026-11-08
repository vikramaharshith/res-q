import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { VirtualClock } from "../src/core/virtual-clock.js";

describe("VirtualClock", () => {
  it("advances only from explicit input and applies playback speed", () => {
    const clock = new VirtualClock({ startTimeMs: 1_000, playbackSpeed: 2 });

    assert.equal(clock.timeMs, 1_000);
    assert.equal(clock.advance(250), 1_500);
    assert.equal(clock.timeMs, 1_500);
  });

  it("pauses and resumes without losing state", () => {
    const clock = new VirtualClock();

    clock.advance(100);
    clock.pause();
    assert.equal(clock.advance(500), 100);
    assert.equal(clock.isPaused, true);

    clock.resume();
    assert.equal(clock.advance(50), 150);
    assert.equal(clock.isPaused, false);
  });

  it("retains fractional simulated milliseconds deterministically", () => {
    const clock = new VirtualClock({ playbackSpeed: 0.5 });

    assert.equal(clock.advance(5), 2);
    assert.equal(clock.advance(5), 5);
  });

  it("can change speed and reset to its configured initial state", () => {
    const clock = new VirtualClock({ startTimeMs: 40, playbackSpeed: 3, paused: true });

    clock.resume();
    clock.setPlaybackSpeed(0.25);
    clock.advance(20);
    assert.equal(clock.timeMs, 45);

    clock.reset();
    assert.equal(clock.timeMs, 40);
    assert.equal(clock.playbackSpeed, 3);
    assert.equal(clock.isPaused, true);
  });

  it("rejects invalid time and speed inputs", () => {
    assert.throws(() => new VirtualClock({ startTimeMs: 0.5 }), RangeError);
    assert.throws(() => new VirtualClock({ playbackSpeed: 0 }), RangeError);

    const clock = new VirtualClock();
    assert.throws(() => clock.advance(-1), RangeError);
    assert.throws(() => clock.setPlaybackSpeed(Number.POSITIVE_INFINITY), RangeError);
  });
});

