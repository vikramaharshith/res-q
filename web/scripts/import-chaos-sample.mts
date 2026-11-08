import { readFileSync } from "node:fs";

import {
  chaosImportCliMode,
  runControlledChaosImport,
  type ChaosImportAttempt,
} from "@/lib/simulation-import/chaos-import";

/**
 * Dry-run for the two-report handoff export.
 * This script never creates a Supabase client and never calls stage_chaos_import.
 */

function printAttempt(attempt: ChaosImportAttempt): void {
  console.log("RES-Q Chaos sample import");
  console.log(`Mode: ${attempt.mode}`);
  console.log(`Database writes: ${attempt.databaseWrites}`);
  console.log(`External calls: ${attempt.externalCalls}`);
  console.log(`Remote checked: ${attempt.remoteChecked}`);
  if (!attempt.ok) {
    console.log(`Outcome: ${attempt.outcome}`);
    console.log(`Code: ${attempt.code}`);
    console.log(attempt.message);
    return;
  }
  if (attempt.mode === "dry-run") {
    const summary = attempt.summary;
    console.log("Outcome: ready");
    console.log(`RPC: ${summary.rpc}`);
    console.log(`Destination: ${summary.destinationScenarioId}`);
    console.log(`Import run: ${summary.importRunId}`);
    console.log(`Run: ${summary.runId}`);
    console.log(`Schema: ${summary.schemaVersion}`);
    console.log(`Digest: ${summary.digestAlgorithm} ${summary.digestHex}`);
    console.log(`Idempotency: ${summary.idempotencyKey}`);
    console.log(`Source bytes: ${summary.byteLength}`);
    console.log(`Source scenario: ${summary.sourceScenarioId}`);
    console.log(
      `Counts: emergency=${summary.emergencyCount} operational=${summary.operationalCount} units=${summary.unitCount} assignments=${summary.assignmentCount}`,
    );
    console.log(`Reports: ${summary.reportIds.join(", ")}`);
    console.log(`Payload bytes: ${summary.payloadBytes}`);
    console.log(`Payload SHA-256: ${summary.payloadSha256}`);
    console.log("No Supabase call was made.");
    return;
  }
  console.log("Outcome: staged");
  console.log(`Import run: ${attempt.importRunId}`);
}

async function main(): Promise<void> {
  const mode = chaosImportCliMode(process.argv.slice(2));
  if (mode !== "dry-run") {
    console.error("This script only prepares a dry-run. No import was attempted.");
    process.exitCode = 2;
    return;
  }
  const text = readFileSync(new URL("../../resq-handoff/sample-simulation.json", import.meta.url), "utf8");
  const attempt = await runControlledChaosImport({ text, mode: "dry-run" });
  printAttempt(attempt);
  if (!attempt.ok || attempt.databaseWrites || attempt.externalCalls || attempt.remoteChecked) {
    process.exitCode = 1;
  }
}

try {
  await main();
} catch {
  console.error("Chaos sample dry-run failed before a payload was prepared. Nothing was called.");
  process.exitCode = 1;
}
