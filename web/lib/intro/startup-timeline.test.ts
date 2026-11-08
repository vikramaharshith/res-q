import assert from "node:assert/strict";
import test from "node:test";

import {
  INTRO_HOLD_MS,
  INTRO_MS,
  introPortal,
  sampleIntro,
} from "@/lib/intro/startup-timeline";

const view = { width: 1440, height: 900 };
const map = { left: 403, top: 148, width: 648, height: 700 };

test("normal playback is exactly 2500ms with the story beats on their marks", () => {
  assert.equal(INTRO_MS, 2500);
  assert.equal(INTRO_HOLD_MS, 1500);

  const title = sampleIntro(0);
  assert.equal(title.titleOpacity, 1);
  assert.equal(title.circle, 0);
  assert.equal(title.morph, 0);
  assert.equal(title.chrome, 0);

  const circleStart = sampleIntro(400);
  assert.equal(circleStart.circle, 0);
  assert.equal(circleStart.titleOpacity, 1);

  const circleDone = sampleIntro(1000);
  assert.equal(circleDone.circle, 1);
  assert.equal(circleDone.morph, 0);
  assert.equal(circleDone.titleOpacity, 1);

  const globe = sampleIntro(INTRO_HOLD_MS);
  assert.equal(globe.morph, 1);
  assert.equal(globe.drift, 1);
  assert.equal(globe.titleOpacity, 0);
  assert.equal(globe.zoom, 0);
  assert.equal(globe.open, 0);
  assert.equal(globe.globeOpacity, 1);
  assert.equal(globe.chrome, 0);

  const arrived = sampleIntro(2200);
  assert.equal(arrived.zoom, 1);
  assert.equal(arrived.square, 1);
  assert.equal(arrived.globeOpacity, 0);
  assert.equal(arrived.chrome, 0);
  assert.equal(arrived.panel, 0);
  assert.ok(Math.abs(arrived.mapBright - 0.82) < 1e-9);
  assert.ok(Math.abs(arrived.mapSat - 0.72) < 1e-9);

  const done = sampleIntro(INTRO_MS);
  assert.equal(done.chrome, 1);
  assert.equal(done.panel, 1);
});

test("the circle, approach, and panel arrival each move in one direction", () => {
  let previousCircle = -1;
  for (let elapsed = 400; elapsed <= 1000; elapsed += 50) {
    const circle = sampleIntro(elapsed).circle;
    assert.ok(circle >= previousCircle);
    previousCircle = circle;
  }
  let previousZoom = -1;
  for (let elapsed = 1500; elapsed <= 2200; elapsed += 50) {
    const zoom = sampleIntro(elapsed).zoom;
    assert.ok(zoom >= previousZoom);
    previousZoom = zoom;
  }
  let previousPanel = -1;
  for (let elapsed = 2200; elapsed <= 2500; elapsed += 50) {
    const panel = sampleIntro(elapsed).panel;
    assert.ok(panel >= previousPanel);
    previousPanel = panel;
  }
});

test("the opening is closed on the title card and lands on the real map frame", () => {
  const titleCard = introPortal(sampleIntro(0), view, map);
  assert.equal(titleCard.globeX, view.width / 2);
  assert.equal(titleCard.globeY, view.height / 2);
  assert.equal(titleCard.width, 0);

  const held = introPortal(sampleIntro(INTRO_HOLD_MS), view, map);
  assert.equal(held.width, 0);
  assert.equal(held.height, 0);
  assert.equal(held.globeX, map.left + map.width / 2);
  assert.equal(held.globeY, map.top + map.height / 2);

  const landed = introPortal(sampleIntro(2200), view, map);
  assert.equal(landed.left, map.left);
  assert.equal(landed.top, map.top);
  assert.equal(landed.width, map.width);
  assert.equal(landed.height, map.height);
  assert.equal(landed.radius, 0);

  const finished = introPortal(sampleIntro(INTRO_MS), view, map);
  assert.equal(finished.left, map.left);
  assert.equal(finished.top, map.top);
  assert.equal(finished.width, map.width);
  assert.equal(finished.height, map.height);
});

test("the opening stays inside the live map while the camera approaches", () => {
  for (const elapsed of [1600, 1800, 2000, 2200]) {
    const portal = introPortal(sampleIntro(elapsed), view, map);
    assert.ok(portal.left >= map.left - 0.5, `left ${elapsed}`);
    assert.ok(portal.top >= map.top - 0.5, `top ${elapsed}`);
    assert.ok(portal.left + portal.width <= map.left + map.width + 0.5, `right ${elapsed}`);
    assert.ok(portal.top + portal.height <= map.top + map.height + 0.5, `bottom ${elapsed}`);
  }
});
