export interface VirtualClockOptions {
  startTimeMs?: number;
  playbackSpeed?: number;
  paused?: boolean;
}

/**
 * A caller-driven simulation clock. It never reads the system clock.
 */
export class VirtualClock {
  readonly #initialTimeMs: number;
  readonly #initialPlaybackSpeed: number;
  readonly #initialPaused: boolean;

  #timeMs: number;
  #playbackSpeed: number;
  #paused: boolean;
  #fractionalMs = 0;

  public constructor(options: VirtualClockOptions = {}) {
    const startTimeMs = options.startTimeMs ?? 0;
    const playbackSpeed = options.playbackSpeed ?? 1;
    const paused = options.paused ?? false;

    assertSafeInteger(startTimeMs, "Clock start time");
    assertPlaybackSpeed(playbackSpeed);

    this.#initialTimeMs = startTimeMs;
    this.#initialPlaybackSpeed = playbackSpeed;
    this.#initialPaused = paused;
    this.#timeMs = startTimeMs;
    this.#playbackSpeed = playbackSpeed;
    this.#paused = paused;
  }

  public get timeMs(): number {
    return this.#timeMs;
  }

  public get playbackSpeed(): number {
    return this.#playbackSpeed;
  }

  public get isPaused(): boolean {
    return this.#paused;
  }

  public pause(): void {
    this.#paused = true;
  }

  public resume(): void {
    this.#paused = false;
  }

  public setPlaybackSpeed(playbackSpeed: number): void {
    assertPlaybackSpeed(playbackSpeed);
    this.#playbackSpeed = playbackSpeed;
  }

  /**
   * Advances by an explicitly supplied base duration, scaled by playback speed.
   * Fractional simulated milliseconds are retained for later calls.
   */
  public advance(elapsedMs: number): number {
    if (!Number.isSafeInteger(elapsedMs) || elapsedMs < 0) {
      throw new RangeError("Elapsed time must be a non-negative safe integer.");
    }

    if (this.#paused || elapsedMs === 0) {
      return this.#timeMs;
    }

    const scaledMs = elapsedMs * this.#playbackSpeed + this.#fractionalMs;
    if (!Number.isFinite(scaledMs)) {
      throw new RangeError("Clock advance exceeds the supported numeric range.");
    }

    const wholeMs = Math.trunc(scaledMs);
    const nextTimeMs = this.#timeMs + wholeMs;
    assertSafeInteger(nextTimeMs, "Clock time");

    this.#timeMs = nextTimeMs;
    this.#fractionalMs = scaledMs - wholeMs;
    return this.#timeMs;
  }

  /** Restores the time, speed, and pause state supplied to the constructor. */
  public reset(): void {
    this.#timeMs = this.#initialTimeMs;
    this.#playbackSpeed = this.#initialPlaybackSpeed;
    this.#paused = this.#initialPaused;
    this.#fractionalMs = 0;
  }
}

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer number of milliseconds.`);
  }
}

function assertPlaybackSpeed(value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError("Playback speed must be a finite number greater than zero.");
  }
}

