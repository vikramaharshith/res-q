import { createHash } from "node:crypto";
import { MemoryImportLedger } from "@/lib/simulation-import/ledger";
import {
  MemoryStagingStore,
  planBelongsToRun,
  stageValidatedChaosText,
} from "@/lib/simulation-import/stage-plan";
import {
  stageChaosImportPayload,
  type StageChaosImportPayload,
} from "@/lib/simulation-import/chaos-import";

export const LARGE_DESTINATION = /^scn_chaos_large_[a-z0-9_]{1,64}$/;
export const LARGE_CHAOS_RPC = "stage_large_chaos_import";

/** Strict existing schema + semantic validation, before any connection or credential read. */
export function prepareLargeChaosImport(text: string, destination: string) {
  if (!LARGE_DESTINATION.test(destination))
    throw new Error(
      "Use a NEW scn_chaos_large_<name> destination; sample and Urban Flood are forbidden.",
    );
  const staged = stageValidatedChaosText(
    text,
    destination,
    new MemoryStagingStore(),
    new MemoryImportLedger(),
  );
  if (!staged.ok) throw new Error(`Public export rejected: ${staged.code}`);
  if (!planBelongsToRun(staged.plan))
    throw new Error("Cross-run payload rejected.");
  const count = staged.plan.emergencyObservations.length;
  if (count < 5000 || count > 9000)
    throw new Error(
      "Large import requires 5,000–9,000 final emergency observations.",
    );
  const payload = stageChaosImportPayload(staged.plan);
  const encoded = JSON.stringify(payload);
  // PostgreSQL jsonb adds spaces. Reserve space for it as well as HTTP serialization.
  const conservativeBytes = Buffer.byteLength(JSON.stringify(payload, null, 1));
  if (conservativeBytes > 32 * 1024 * 1024)
    throw new Error("Staging payload exceeds the database byte limit.");
  return {
    payload,
    summary: {
      destination,
      importRunId: payload.run.id,
      runId: payload.run.run_id,
      sha256: createHash("sha256").update(text).digest("hex"),
      sourceBytes: Buffer.byteLength(text),
      payloadBytes: Buffer.byteLength(encoded),
      emergency: count,
      operational: payload.operationalObservations.length,
      units: payload.units.length,
      assignments: payload.chaosPublicAssignments.length,
    },
  };
}

export function largeImportApproved(
  mode: string,
  digest: string,
  destination: string,
  supplied: string | undefined,
): boolean {
  return (
    mode === "apply" &&
    /^[a-f0-9]{64}$/.test(digest) &&
    LARGE_DESTINATION.test(destination) &&
    supplied === `${digest}:${destination}`
  );
}

export async function executeLargeChaosImport(
  prepared: ReturnType<typeof prepareLargeChaosImport>,
  execute: (
    payload: StageChaosImportPayload,
  ) => Promise<{ data: unknown; error: unknown }>,
) {
  // No retries: a transport failure has an UNKNOWN commit outcome; inspect the run before retrying.
  let result: { data: unknown; error: unknown };
  try {
    result = await execute(prepared.payload);
  } catch {
    throw new Error(
      "Import transport failed; commit outcome unknown. Inspect importRunId before retrying.",
    );
  }
  if (result.error)
    throw new Error(
      "Import RPC failed; commit outcome unknown. Inspect importRunId before retrying.",
    );
  const data = result.data as {
    code?: string;
    ok?: boolean;
    import_run_id?: string;
  } | null;
  if (
    !data ||
    data.ok !== true ||
    data.code !== "STAGED" ||
    data.import_run_id !== prepared.summary.importRunId
  ) {
    const code = [
      "DUPLICATE_IMPORT",
      "RUN_DIGEST_CONFLICT",
      "DESTINATION_EXISTS",
      "DESTINATION_FORBIDDEN",
    ].includes(data?.code ?? "")
      ? data?.code
      : "REJECTED";
    throw new Error(
      `Import result: ${code}. Inspect the run; nothing is overwritten.`,
    );
  }
  return data;
}
