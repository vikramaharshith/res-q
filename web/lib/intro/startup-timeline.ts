export const INTRO_STORAGE_KEY = "resq.intro.seen";

/** Full cinematic length once playback is running. Holds for a late map do not count. */
export const INTRO_MS = 2500;

/** Globe is fully formed here. Playback waits at this frame until the live map can be shown. */
export const INTRO_HOLD_MS = 1500;

const CIRCLE_START = 400;
const CIRCLE_END = 1000;
const TITLE_FADE_START = 1000;
const TITLE_FADE_END = 1380;
const MORPH_START = 1080;
const MORPH_END = 1500;
const DRIFT_START = 1280;
const ZOOM_START = 1500;
const ZOOM_END = 2200;
const OPEN_END = 1700;
const SQUARE_START = 1900;
const GLOBE_FADE_START = 1680;
const GLOBE_FADE_END = 1880;
const CHROME_START = 2200;

/** Radius of the limb circle inside the 100×100 globe viewBox. */
export const LIMB_RATIO = 0.46;

const MAP_BRIGHT_START = 0.16;
const MAP_BRIGHT_END = 0.82;
const MAP_SAT_START = 0.08;
const MAP_SAT_END = 0.72;

export type IntroSample = {
  titleOpacity: number;
  circle: number;
  morph: number;
  zoom: number;
  drift: number;
  open: number;
  square: number;
  globeOpacity: number;
  chrome: number;
  panel: number;
  spin: number;
  mapBright: number;
  mapSat: number;
};

export type Viewport = {
  width: number;
  height: number;
};

export type MapBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type IntroPortal = {
  left: number;
  top: number;
  width: number;
  height: number;
  radius: number;
  globeX: number;
  globeY: number;
  globeSize: number;
};

export function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function segment(elapsed: number, start: number, end: number): number {
  if (end <= start) return elapsed >= end ? 1 : 0;
  return clamp01((elapsed - start) / (end - start));
}

export function easeInOutCubic(value: number): number {
  const t = clamp01(value);
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export function easeOutCubic(value: number): number {
  const t = clamp01(value);
  return 1 - (1 - t) ** 3;
}

export function restGlobeSize(viewport: Viewport): number {
  const shortest = Math.min(viewport.width, viewport.height);
  return Math.max(300, Math.min(shortest * 0.72, 560));
}

export function sampleIntro(elapsed: number): IntroSample {
  const circle = easeInOutCubic(segment(elapsed, CIRCLE_START, CIRCLE_END));
  const morph = easeInOutCubic(segment(elapsed, MORPH_START, MORPH_END));
  const zoom = easeInOutCubic(segment(elapsed, ZOOM_START, ZOOM_END));
  const chrome = easeOutCubic(segment(elapsed, CHROME_START, INTRO_MS));
  return {
    titleOpacity: 1 - easeInOutCubic(segment(elapsed, TITLE_FADE_START, TITLE_FADE_END)),
    circle,
    morph,
    zoom,
    drift: easeInOutCubic(segment(elapsed, DRIFT_START, INTRO_HOLD_MS)),
    open: easeOutCubic(segment(elapsed, ZOOM_START, OPEN_END)),
    square: easeInOutCubic(segment(elapsed, SQUARE_START, ZOOM_END)),
    globeOpacity: 1 - easeInOutCubic(segment(elapsed, GLOBE_FADE_START, GLOBE_FADE_END)),
    chrome,
    panel: Math.min(1, chrome * 1.25),
    spin: -16 * morph + 6 * zoom,
    mapBright: MAP_BRIGHT_START + (MAP_BRIGHT_END - MAP_BRIGHT_START) * zoom,
    mapSat: MAP_SAT_START + (MAP_SAT_END - MAP_SAT_START) * zoom,
  };
}

export function introPortal(
  sample: IntroSample,
  viewport: Viewport,
  map: MapBox | null,
): IntroPortal {
  const target = map ?? {
    left: 0,
    top: 0,
    width: viewport.width,
    height: viewport.height,
  };
  const endR = Math.min(target.width, target.height) / 2;
  const naturalRest = restGlobeSize(viewport) * LIMB_RATIO;
  const restR = map ? Math.min(naturalRest, Math.max(88, endR * 0.72)) : naturalRest;
  const globeR = restR + (endR - restR) * sample.zoom;
  const vx = viewport.width / 2;
  const vy = viewport.height / 2;
  const mapCx = target.left + target.width / 2;
  const mapCy = target.top + target.height / 2;
  const cx = vx + (mapCx - vx) * sample.drift;
  const cy = vy + (mapCy - vy) * sample.drift;
  const circleSize = globeR * 2 * sample.open;
  const width = circleSize + (target.width - circleSize) * sample.square;
  const height = circleSize + (target.height - circleSize) * sample.square;
  const left = cx - circleSize / 2 + (target.left - (cx - circleSize / 2)) * sample.square;
  const top = cy - circleSize / 2 + (target.top - (cy - circleSize / 2)) * sample.square;
  const radius = (Math.min(Math.max(width, 0), Math.max(height, 0)) / 2) * (1 - sample.square);
  return {
    left,
    top,
    width,
    height,
    radius,
    globeX: cx,
    globeY: cy,
    globeSize: globeR / LIMB_RATIO,
  };
}
