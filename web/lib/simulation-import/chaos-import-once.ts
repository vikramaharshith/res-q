import { createHash } from "node:crypto";

import { MemoryImportLedger } from "@/lib/simulation-import/ledger";
import {
  SAMPLE_CHAOS_BYTES,
  SAMPLE_CHAOS_DESTINATION,
  SAMPLE_CHAOS_DIGEST_HEX,
  SAMPLE_CHAOS_RUN_ID,
  prepareSampleChaosImport,
  type ChaosImportAttempt,
} from "@/lib/simulation-import/chaos-import";
import { MemoryStagingStore } from "@/lib/simulation-import/stage-plan";

/**
 * One local preparation of the two-report sample.
 * The importer is invoked once, and only after the run id and digest match.
 */

const IMPORT_RUN_ID = `cimp_run_${SAMPLE_CHAOS_DIGEST_HEX.slice(0, 32)}`;
const IMPORT_ID_PATTERN = /^cimp_run_[0-9a-f]{32}$/;

const SAFE_OUTCOMES = new Set([
  "STAGED",
  "DUPLICATE_IMPORT",
  "RUN_DIGEST_CONFLICT",
  "APPLY_REFUSED",
  "PAYLOAD_REJECTED",
  "PAYLOAD_LIMIT",
  "SAMPLE_SHAPE",
  "DESTINATION_FORBIDDEN",
  "RPC_FAILED",
  "EMERGENCY_LIMIT",
  "OPERATIONAL_LIMIT",
  "UNIT_LIMIT",
  "ASSIGNMENT_LIMIT",
  "SOURCE_LIMIT",
  "CROSS_RUN_REJECTED",
  "CHILD_ID_CONFLICT",
  "COMMIT_FAILED",
  "rejected",
]);

export interface ChaosOnceImporter {
  (
    text: string,
    options: { readonly mode: "apply"; readonly destinationScenarioId: typeof SAMPLE_CHAOS_DESTINATION },
  ): Promise<ChaosImportAttempt>;
}

export interface SampleChaosPreflight {
  readonly ok: true;
  readonly importRunId: string;
  readonly runId: string;
  readonly digestHex: string;
  readonly emergencyCount: number;
  readonly operationalCount: number;
  readonly unitCount: number;
  readonly assignmentCount: number;
}

interface SampleChaosPreflightFailure {
  readonly ok: false;
  readonly outcome: string;
}

export type ChaosOnceResult = {
  readonly exitCode: number;
  readonly output: string;
};

function safeOutcome(outcome: string): string {
  return SAFE_OUTCOMES.has(outcome) ? outcome : "rejected";
}

function render(outcome: string, preflight: SampleChaosPreflight | null): string {
  const lines = [`Outcome: ${safeOutcome(outcome)}`];
  if (!preflight || !IMPORT_ID_PATTERN.test(preflight.importRunId)) return lines.join("\n");
  lines.push(`Import: ${preflight.importRunId}`);
  lines.push(`Emergency: ${preflight.emergencyCount}`);
  lines.push(`Operational: ${preflight.operationalCount}`);
  lines.push(`Units: ${preflight.unitCount}`);
  lines.push(`Assignments: ${preflight.assignmentCount}`);
  return lines.join("\n");
}

/** Checks the known sample bytes and run id. This does not open a connection. */
export function preflightSampleChaosText(text: string): SampleChaosPreflight | SampleChaosPreflightFailure {
  if (typeof text !== "string" || Buffer.byteLength(text) !== SAMPLE_CHAOS_BYTES) {
    return { ok: false, outcome: "PAYLOAD_REJECTED" };
  }
  const digestHex = createHash("sha256").update(text).digest("hex");
  if (digestHex !== SAMPLE_CHAOS_DIGEST_HEX) return { ok: false, outcome: "PAYLOAD_REJECTED" };
  const prepared = prepareSampleChaosImport(text, {
    destinationScenarioId: SAMPLE_CHAOS_DESTINATION,
    store: new MemoryStagingStore(),
    ledger: new MemoryImportLedger(),
  });
  if (!prepared.ok) return { ok: false, outcome: safeOutcome(prepared.code) };
  if (
    prepared.summary.runId !== SAMPLE_CHAOS_RUN_ID
    || prepared.summary.digestHex !== SAMPLE_CHAOS_DIGEST_HEX
    || prepared.summary.importRunId !== IMPORT_RUN_ID
    || prepared.summary.destinationScenarioId !== SAMPLE_CHAOS_DESTINATION
    || prepared.summary.emergencyCount !== 2
  ) {
    return { ok: false, outcome: "SAMPLE_SHAPE" };
  }
  return {
    ok: true,
    importRunId: prepared.summary.importRunId,
    runId: prepared.summary.runId,
    digestHex: prepared.summary.digestHex,
    emergencyCount: prepared.summary.emergencyCount,
    operationalCount: prepared.summary.operationalCount,
    unitCount: prepared.summary.unitCount,
    assignmentCount: prepared.summary.assignmentCount,
  };
}

function outcomeOf(attempt: ChaosImportAttempt, preflight: SampleChaosPreflight): { outcome: string; exitCode: number } {
  if (attempt.ok && attempt.mode === "apply" && attempt.code === "STAGED") {
    return attempt.importRunId === preflight.importRunId
      ? { outcome: "STAGED", exitCode: 0 }
      : { outcome: "RPC_FAILED", exitCode: 1 };
  }
  if (!attempt.ok && attempt.code === "DUPLICATE_IMPORT") return { outcome: "DUPLICATE_IMPORT", exitCode: 1 };
  if (!attempt.ok && attempt.code === "RUN_DIGEST_CONFLICT") return { outcome: "RUN_DIGEST_CONFLICT", exitCode: 1 };
  if (!attempt.ok && SAFE_OUTCOMES.has(attempt.code)) return { outcome: attempt.code, exitCode: 1 };
  return { outcome: "rejected", exitCode: 1 };
}

/**
 * Validates the sample, then calls the supplied importer one time.
 * A thrown importer becomes a rejected outcome and is not tried again.
 */
export async function runChaosSampleOnce(text: string, importOnServer: ChaosOnceImporter): Promise<ChaosOnceResult> {
  const preflight = preflightSampleChaosText(text);
  if (!preflight.ok) return { exitCode: 1, output: render(preflight.outcome, null) };
  let attempt: ChaosImportAttempt;
  try {
    attempt = await importOnServer(text, {
      mode: "apply",
      destinationScenarioId: SAMPLE_CHAOS_DESTINATION,
    });
  } catch {
    return { exitCode: 1, output: render("rejected", preflight) };
  }
  const decision = outcomeOf(attempt, preflight);
  return { exitCode: decision.exitCode, output: render(decision.outcome, preflight) };
}
