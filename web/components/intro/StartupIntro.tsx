"use client";

import { useLayoutEffect, useRef } from "react";

import {
  INTRO_HOLD_MS,
  INTRO_MS,
  INTRO_STORAGE_KEY,
  introPortal,
  sampleIntro,
  type IntroPortal,
  type MapBox,
} from "@/lib/intro/startup-timeline";

function shadePath(width: number, height: number, portal: IntroPortal): string {
  const n = (value: number) => value.toFixed(2);
  const outer = `M0 0H${n(width)}V${n(height)}H0Z`;
  if (portal.width < 1 || portal.height < 1) return outer;
  const x = portal.left;
  const y = portal.top;
  const right = x + portal.width;
  const bottom = y + portal.height;
  const radius = Math.max(0, Math.min(portal.radius, portal.width / 2, portal.height / 2));
  if (radius < 0.5) {
    return `${outer}M${n(x)} ${n(y)}H${n(right)}V${n(bottom)}H${n(x)}Z`;
  }
  return (
    outer +
    `M${n(x + radius)} ${n(y)}` +
    `H${n(right - radius)}` +
    `A${n(radius)} ${n(radius)} 0 0 1 ${n(right)} ${n(y + radius)}` +
    `V${n(bottom - radius)}` +
    `A${n(radius)} ${n(radius)} 0 0 1 ${n(right - radius)} ${n(bottom)}` +
    `H${n(x + radius)}` +
    `A${n(radius)} ${n(radius)} 0 0 1 ${n(x)} ${n(bottom - radius)}` +
    `V${n(y + radius)}` +
    `A${n(radius)} ${n(radius)} 0 0 1 ${n(x + radius)} ${n(y)}Z`
  );
}

const LIMB_LENGTH = 2 * Math.PI * 46;
const FRAME_CAP_MS = 48;
const TILE_HOLD_MS = 8000;
const HARD_HOLD_MS = 12000;
const TITLE_CATCHUP_MS = 400;

function readSeen(): boolean {
  try {
    return window.sessionStorage.getItem(INTRO_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function markSeen(): void {
  try {
    window.sessionStorage.setItem(INTRO_STORAGE_KEY, "1");
  } catch {
    /* Private mode can block storage. The intro still ends. */
  }
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function mapBox(): MapBox | null {
  const slot = document.querySelector(".startup-map-slot");
  if (!(slot instanceof HTMLElement)) return null;
  const rect = slot.getBoundingClientRect();
  if (rect.width < 40 || rect.height < 40) return null;
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function localGridReady(): boolean {
  const slot = document.querySelector(".startup-map-slot");
  if (!(slot instanceof HTMLElement)) return false;
  return slot.querySelector("[data-local-grid]") instanceof Element;
}

function mapBoxReady(): boolean {
  const box = mapBox();
  if (!box) return false;
  if (document.querySelector(".resq-map .leaflet-container") instanceof HTMLElement) return true;
  return localGridReady();
}

function mapSurfaceReady(): boolean {
  if (localGridReady() && mapBox() !== null) return true;
  if (!mapBoxReady()) return false;
  const tiles = document.querySelectorAll(".resq-map img.leaflet-tile");
  for (const tile of tiles) {
    if (!(tile instanceof HTMLImageElement)) continue;
    if (tile.classList.contains("leaflet-tile-loaded")) return true;
    if (tile.complete && tile.naturalWidth > 0) return true;
  }
  return false;
}

function releaseShell(): void {
  const shell = document.querySelector("[data-command-shell]");
  if (!(shell instanceof HTMLElement)) return;
  shell.inert = false;
  shell.removeAttribute("aria-hidden");
}

function clearIntroStyles(): void {
  const root = document.documentElement;
  delete root.dataset.resqIntro;
  root.style.removeProperty("--resq-panel");
  root.style.removeProperty("--resq-map-bright");
  root.style.removeProperty("--resq-map-sat");
}

export function StartupIntro({
  replayToken,
  onLand,
}: {
  replayToken: number;
  onLand: () => void;
}) {
  const onLandRef = useRef(onLand);
  const overlayRef = useRef<HTMLDivElement>(null);
  const shadeRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<SVGSVGElement>(null);
  const limbRef = useRef<SVGCircleElement>(null);
  const graticuleRef = useRef<SVGGElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const skipRef = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    onLandRef.current = onLand;
  }, [onLand]);

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const shade = shadeRef.current;
    const globe = globeRef.current;
    const limb = limbRef.current;
    const graticule = graticuleRef.current;
    const title = titleRef.current;
    if (!overlay || !shade || !globe || !limb || !graticule || !title) return;

    const reduced = prefersReducedMotion();
    const replay = replayToken > 0;
    if (reduced || (!replay && readSeen())) {
      clearIntroStyles();
      releaseShell();
      return;
    }

    const shell = document.querySelector("[data-command-shell]");
    if (shell instanceof HTMLElement) {
      shell.inert = true;
      shell.setAttribute("aria-hidden", "true");
    }
    document.documentElement.dataset.resqIntro = "play";

    const lines = Array.from(
      graticule.querySelectorAll<SVGEllipseElement>("[data-axis]"),
    );
    const armedAt =
      replay
        ? undefined
        : (window as Window & { __resqIntroArmed?: number }).__resqIntroArmed;
    const lag = typeof armedAt === "number" ? performance.now() - armedAt : 0;
    let acc = Math.min(TITLE_CATCHUP_MS, Math.max(0, lag));
    let last = performance.now();
    let held = 0;
    let holdSpin = 0;
    let finished = false;
    let stopped = false;
    let nudged = false;
    let raf = 0;

    const apply = (elapsed: number, extraSpin: number) => {
      const sample = sampleIntro(elapsed);
      const viewport = {
        width: overlay.clientWidth || window.innerWidth,
        height: overlay.clientHeight || window.innerHeight,
      };
      const portal = introPortal(sample, viewport, mapBox());
      const root = document.documentElement;
      root.style.setProperty("--resq-panel", sample.panel.toFixed(4));
      root.style.setProperty("--resq-map-bright", sample.mapBright.toFixed(4));
      root.style.setProperty("--resq-map-sat", sample.mapSat.toFixed(4));

      shade.style.clipPath = `path(evenodd, "${shadePath(viewport.width, viewport.height, portal)}")`;
      shade.style.opacity = (1 - sample.chrome).toFixed(4);

      globe.style.left = `${portal.globeX}px`;
      globe.style.top = `${portal.globeY}px`;
      globe.style.width = `${portal.globeSize}px`;
      globe.style.height = `${portal.globeSize}px`;
      globe.style.transform = "translate(-50%, -50%)";
      globe.style.opacity = sample.globeOpacity.toFixed(4);
      const limbLength = limb.getTotalLength() || LIMB_LENGTH;
      if (sample.circle >= 0.999) {
        limb.style.strokeDasharray = "none";
        limb.style.strokeDashoffset = "0";
      } else {
        const drawn = limbLength * sample.circle;
        limb.style.strokeDasharray = `${drawn.toFixed(3)} ${limbLength.toFixed(3)}`;
        limb.style.strokeDashoffset = "0";
      }
      limb.style.opacity = sample.circle < 0.012 ? "0" : "1";

      const morph = sample.morph;
      graticule.style.opacity = morph <= 0.001 ? "0" : "1";
      graticule.setAttribute(
        "transform",
        `rotate(${(sample.spin + extraSpin).toFixed(3)} 50 50)`,
      );
      for (const line of lines) {
        const rx = Number(line.dataset.rx);
        const ry = Number(line.dataset.ry);
        if (line.dataset.axis === "lat") {
          line.setAttribute("rx", String(rx));
          line.setAttribute("ry", String(Math.max(0.2, ry * morph)));
        } else {
          line.setAttribute("rx", String(Math.max(0.2, rx * morph)));
          line.setAttribute("ry", String(ry));
        }
      }
      title.style.opacity = sample.titleOpacity.toFixed(4);
      overlay.style.setProperty("--resq-skip", (1 - sample.panel).toFixed(4));
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      stopped = true;
      window.cancelAnimationFrame(raf);
      skipRef.current = () => {};
      markSeen();
      const mobile = window.matchMedia("(max-width: 1023px)").matches;
      const slot = document.querySelector(".startup-map-slot");
      const mapAlreadyShown =
        slot instanceof HTMLElement && !slot.classList.contains("hidden");
      if (mobile && !mapAlreadyShown) {
        document.documentElement.dataset.resqLand = "map";
      }
      if (mobile) onLandRef.current();
      clearIntroStyles();
      releaseShell();
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      finish();
    };
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => {
      if (motion.matches) finish();
    };
    window.addEventListener("keydown", onKey);
    motion.addEventListener("change", onMotion);
    skipRef.current = finish;
    apply(acc, 0);

    const tick = (now: number) => {
      if (stopped) return;
      const dt = Math.min(FRAME_CAP_MS, Math.max(0, now - last));
      last = now;
      if (!document.hidden) {
        if (!nudged && document.querySelector(".resq-map .leaflet-container")) {
          nudged = true;
          window.dispatchEvent(new Event("resize"));
        }
        const next = acc + dt;
        const ready = mapSurfaceReady();
        const limit = mapBoxReady() ? TILE_HOLD_MS : HARD_HOLD_MS;
        const keepHolding = next >= INTRO_HOLD_MS && !ready && held + dt < limit;
        if (keepHolding) {
          acc = INTRO_HOLD_MS;
          held += dt;
          holdSpin += dt * 0.005;
        } else {
          acc = next;
        }
        if (acc >= INTRO_MS) {
          apply(INTRO_MS, 0);
          finish();
          return;
        }
        apply(acc, holdSpin * (1 - sampleIntro(acc).zoom));
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);

    return () => {
      stopped = true;
      window.cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      motion.removeEventListener("change", onMotion);
      if (!finished) {
        clearIntroStyles();
        releaseShell();
      }
    };
  }, [replayToken]);

  return (
    <div ref={overlayRef} className="intro-overlay" role="region" aria-label="Introduction">
      <div ref={shadeRef} className="intro-shade" />
      <svg
        ref={globeRef}
        className="intro-globe"
        viewBox="0 0 100 100"
        aria-hidden="true"
      >
        <defs>
          <clipPath id="resq-intro-clip">
            <circle cx="50" cy="50" r="46" />
          </clipPath>
        </defs>
        <circle ref={limbRef} cx="50" cy="50" r="46" />
        <g ref={graticuleRef} className="intro-graticule" clipPath="url(#resq-intro-clip)">
          <ellipse data-axis="lat" data-rx="46" data-ry="12" cx="50" cy="50" rx="46" ry="12" />
          <ellipse data-axis="lat" data-rx="46" data-ry="24" cx="50" cy="50" rx="46" ry="24" />
          <ellipse data-axis="lat" data-rx="46" data-ry="36" cx="50" cy="50" rx="46" ry="36" />
          <ellipse data-axis="mer" data-rx="12" data-ry="46" cx="50" cy="50" rx="12" ry="46" />
          <ellipse data-axis="mer" data-rx="24" data-ry="46" cx="50" cy="50" rx="24" ry="46" />
          <ellipse data-axis="mer" data-rx="36" data-ry="46" cx="50" cy="50" rx="36" ry="46" />
        </g>
      </svg>
      <div ref={titleRef} className="intro-title" aria-hidden="true">
        <p className="intro-title-mark">RES-Q</p>
        <p className="intro-title-by">by B7</p>
      </div>
      <button type="button" className="intro-skip" onClick={() => skipRef.current()}>
        Skip
      </button>
    </div>
  );
}
