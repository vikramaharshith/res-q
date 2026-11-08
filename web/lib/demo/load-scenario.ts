import "server-only";

import { DEMO_SCENARIO } from "@/lib/demo/scenario";
import type { Scenario } from "@/lib/demo/types";
import { redactServerText } from "@/lib/supabase/server";
import { fetchStandardDemoScenario } from "@/lib/supabase/standard-demo";

/**
 * One loader for the dashboard and Nemotron investigations.
 * A warm result is reused across requests. Client interactions do not call it.
 * Supabase failures fall back to the local deterministic scenario.
 */

const SUCCESS_TTL_MS = 5 * 60 * 1000;
const FALLBACK_TTL_MS = 15 * 1000;

export interface CommandScenario {
  scenario: Scenario;
  source: "supabase" | "fallback";
}

interface CacheEntry extends CommandScenario {
  storedAt: number;
}

interface CacheState {
  cached: CacheEntry | null;
  inFlight: Promise<CommandScenario> | null;
}

const CACHE_KEY = Symbol.for("resq.commandScenario");

function cacheState(): CacheState {
  const host = globalThis as typeof globalThis & { [CACHE_KEY]?: CacheState };
  const existing = host[CACHE_KEY];
  if (existing) return existing;
  const created: CacheState = { cached: null, inFlight: null };
  host[CACHE_KEY] = created;
  return created;
}

function ttl(entry: CacheEntry): number {
  return entry.source === "supabase" ? SUCCESS_TTL_MS : FALLBACK_TTL_MS;
}

function safeDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : "Scenario load failed";
  return redactServerText(message).slice(0, 400);
}

async function readCommandScenario(): Promise<CommandScenario> {
  const state = cacheState();
  try {
    const scenario = await fetchStandardDemoScenario();
    const value: CacheEntry = {
      scenario,
      source: "supabase",
      storedAt: Date.now(),
    };
    state.cached = value;
    console.info(
      `[resq-data] source=supabase scenario=${scenario.id} incidents=${scenario.incidents.length} reports=${scenario.reports.length} responders=${scenario.responders.length} assignments=${scenario.assignments.length}`,
    );
    return { scenario, source: "supabase" };
  } catch (error) {
    console.error(`[resq-data] source=fallback detail=${safeDetail(error)}`);
    const value: CacheEntry = {
      scenario: DEMO_SCENARIO,
      source: "fallback",
      storedAt: Date.now(),
    };
    state.cached = value;
    return { scenario: DEMO_SCENARIO, source: "fallback" };
  }
}

export function invalidateCommandScenarioCache(): void {
  cacheState().cached = null;
}

export async function reloadCommandScenario(): Promise<CommandScenario> {
  const state = cacheState();
  state.cached = null;
  if (state.inFlight) {
    await state.inFlight.catch(() => undefined);
  }
  state.cached = null;
  return loadCommandScenario();
}

export function loadCommandScenario(): Promise<CommandScenario> {
  const state = cacheState();
  const now = Date.now();
  if (state.cached && now - state.cached.storedAt < ttl(state.cached)) {
    return Promise.resolve({
      scenario: state.cached.scenario,
      source: state.cached.source,
    });
  }
  if (!state.inFlight) {
    state.inFlight = readCommandScenario().finally(() => {
      state.inFlight = null;
    });
  }
  return state.inFlight;
}
