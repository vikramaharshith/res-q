import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CHAOS_PAYLOAD_KEYS,
  SAMPLE_CHAOS_BYTES,
  SAMPLE_CHAOS_DESTINATION,
  SAMPLE_CHAOS_DIGEST_HEX,
  SAMPLE_CHAOS_RUN_ID,
  SAMPLE_CHAOS_SEED,
  SAMPLE_IMPORT_APPROVAL,
  SAMPLE_REPORT_IDS,
  STAGE_CHAOS_IMPORT_RPC,
  chaosImportCliMode,
  chaosServerCallAllowed,
  interpretStageChaosImportResult,
  isSampleChaosPayload,
  prepareSampleChaosImport,
  runControlledChaosImport,
  type ChaosImportExecutor,
  type StageChaosImportPayload,
} from "@/lib/simulation-import/chaos-import";
import { MemoryImportLedger } from "@/lib/simulation-import/ledger";
import {
  DEMO_SCENARIO_ID,
  MemoryStagingStore,
  stageValidatedChaosText,
  type ChaosStagingPlan,
  type StagingSnapshot,
} from "@/lib/simulation-import/stage-plan";

const sampleText = readFileSync(new URL("../../../resq-handoff/sample-simulation.json", import.meta.url), "utf8");

function emptySnapshot(): StagingSnapshot {
  return {
    runs: [],
    emergencyObservations: [],
    operationalObservations: [],
    units: [],
    chaosPublicAssignments: [],
    sourceIds: [],
  };
}

function throwingExecutor(marker: string): ChaosImportExecutor {
  return () => {
    throw new Error(marker);
  };
}

test("the sample payload is the stage_chaos_import object for the two-report export", async () => {
  assert.equal(createHash("sha256").update(sampleText).digest("hex"), SAMPLE_CHAOS_DIGEST_HEX);
  assert.equal(Buffer.byteLength(sampleText), SAMPLE_CHAOS_BYTES);

  const store = new MemoryStagingStore();
  const prepared = prepareSampleChaosImport(sampleText, { store, ledger: new MemoryImportLedger() });
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;

  const direct = stageValidatedChaosText(sampleText, SAMPLE_CHAOS_DESTINATION, new MemoryStagingStore(), new MemoryImportLedger());
  assert.equal(direct.ok, true);
  if (!direct.ok) return;
  assert.deepEqual(Object.keys(prepared.payload), [...CHAOS_PAYLOAD_KEYS]);
  assert.equal("publicAssignmentWrites" in prepared.payload, false);
  assert.deepEqual(prepared.payload.run, direct.plan.run);
  assert.deepEqual(prepared.payload.emergencyObservations, direct.plan.emergencyObservations);
  assert.deepEqual(prepared.payload.operationalObservations, direct.plan.operationalObservations);
  assert.deepEqual(prepared.payload.units, direct.plan.units);
  assert.deepEqual(prepared.payload.chaosPublicAssignments, direct.plan.chaosPublicAssignments);
  assert.deepEqual(prepared.payload.sourceIds, direct.plan.sourceIds);
  assert.equal(direct.plan.publicAssignmentWrites.length, 0);
  assert.equal(prepared.payload.destinationScenarioId, SAMPLE_CHAOS_DESTINATION);
  assert.equal(prepared.payload.run.id, `cimp_run_${SAMPLE_CHAOS_DIGEST_HEX.slice(0, 32)}`);
  assert.equal(prepared.payload.run.idempotency_key, `resq.simulation.v1:${SAMPLE_CHAOS_RUN_ID}:${SAMPLE_CHAOS_DIGEST_HEX}`);
  assert.deepEqual(prepared.summary.reportIds, [...SAMPLE_REPORT_IDS]);
  assert.equal(prepared.summary.rpc, STAGE_CHAOS_IMPORT_RPC);
  assert.equal(prepared.summary.emergencyCount, 2);
  assert.equal(prepared.summary.operationalCount, 7);
  assert.equal(prepared.summary.unitCount, 1);
  assert.equal(prepared.summary.assignmentCount, 1);
  assert.equal(prepared.summary.payloadSha256, createHash("sha256").update(JSON.stringify(prepared.payload)).digest("hex"));
  assert.equal(prepared.payload.emergencyObservations[0]?.grid_x, 47588);
  assert.equal(prepared.payload.emergencyObservations[0]?.grid_y, 46344);
  assert.equal(prepared.payload.emergencyObservations[1]?.grid_x, 47596);
  assert.equal(prepared.payload.emergencyObservations[1]?.grid_y, 46368);
  assert.equal(prepared.payload.emergencyObservations[0]?.status, "RECEIVED");
  assert.equal(JSON.stringify(prepared.payload).includes(DEMO_SCENARIO_ID), false);
  assert.equal(isSampleChaosPayload(prepared.payload), true);
  assert.equal(store.read().runs.length, 1);
  assert.equal(store.read().runs[0]?.digest_hex, SAMPLE_CHAOS_DIGEST_HEX);

  const dryRun = await runControlledChaosImport({ text: sampleText });
  assert.equal(dryRun.ok, true);
  if (!dryRun.ok || dryRun.mode !== "dry-run") return;
  assert.equal(dryRun.outcome, "ready");
  assert.equal(dryRun.code, "DRY_RUN");
  assert.equal(dryRun.invoked, false);
  assert.equal(dryRun.databaseWrites, false);
  assert.equal(dryRun.externalCalls, false);
  assert.equal(dryRun.remoteChecked, false);
  assert.deepEqual(dryRun.payload, prepared.payload);
});

test("a repeated sample is a duplicate and a changed digest stays in review", async () => {
  const store = new MemoryStagingStore();
  const execute = throwingExecutor("duplicate-path");
  const first = await runControlledChaosImport({
    text: sampleText,
    store,
    ledger: new MemoryImportLedger(),
    mode: "dry-run",
    execute,
  });
  assert.equal(first.ok, true);
  const committed = structuredClone(store.read());

  const duplicate = await runControlledChaosImport({
    text: sampleText,
    store,
    ledger: new MemoryImportLedger(),
    mode: "apply",
    execute,
  });
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) {
    assert.equal(duplicate.outcome, "duplicate");
    assert.equal(duplicate.code, "DUPLICATE_IMPORT");
    assert.equal(duplicate.message, "This artifact was already imported.");
    assert.equal(duplicate.invoked, false);
    assert.equal(duplicate.databaseWrites, false);
    assert.equal(duplicate.externalCalls, false);
    assert.equal(duplicate.message.includes(SAMPLE_CHAOS_SEED), false);
  }
  assert.deepEqual(store.read(), committed);

  const ledger = new MemoryImportLedger();
  const ledgerStore = new MemoryStagingStore();
  assert.equal((await runControlledChaosImport({ text: sampleText, store: ledgerStore, ledger })).ok, true);
  const ledgerSnapshot = structuredClone(ledgerStore.read());
  const repeatedLedger = await runControlledChaosImport({
    text: sampleText,
    store: ledgerStore,
    ledger,
    mode: "apply",
    execute,
  });
  assert.equal(repeatedLedger.ok, false);
  if (!repeatedLedger.ok) {
    assert.equal(repeatedLedger.code, "PAYLOAD_REJECTED");
    assert.equal(repeatedLedger.externalCalls, false);
  }
  assert.deepEqual(ledgerStore.read(), ledgerSnapshot);

  const reviewStore = new MemoryStagingStore();
  const seeded = prepareSampleChaosImport(sampleText, { store: new MemoryStagingStore(), ledger: new MemoryImportLedger() });
  assert.equal(seeded.ok, true);
  if (!seeded.ok) return;
  const otherDigest = "ab".repeat(32);
  const seededPlan: ChaosStagingPlan = {
    destinationScenarioId: seeded.payload.destinationScenarioId,
    run: {
      ...seeded.payload.run,
      digest_hex: otherDigest,
      idempotency_key: `resq.simulation.v1:${SAMPLE_CHAOS_RUN_ID}:${otherDigest}`,
    },
    emergencyObservations: seeded.payload.emergencyObservations,
    operationalObservations: seeded.payload.operationalObservations,
    units: seeded.payload.units,
    chaosPublicAssignments: seeded.payload.chaosPublicAssignments,
    sourceIds: seeded.payload.sourceIds,
    publicAssignmentWrites: [],
  };
  reviewStore.commit(seededPlan);
  const beforeReview = structuredClone(reviewStore.read());
  const review = await runControlledChaosImport({
    text: sampleText,
    store: reviewStore,
    ledger: new MemoryImportLedger(),
    mode: "apply",
    execute,
  });
  assert.equal(review.ok, false);
  if (!review.ok) {
    assert.equal(review.outcome, "review");
    assert.equal(review.code, "RUN_DIGEST_CONFLICT");
    assert.match(review.message, /manual review/);
    assert.equal(review.externalCalls, false);
  }
  assert.deepEqual(reviewStore.read(), beforeReview);
  assert.equal(reviewStore.read().runs[0]?.digest_hex, otherDigest);
});

test("invalid input, the demo scenario, and a foreign destination produce no payload", async () => {
  const execute = throwingExecutor("error-path");
  const invalidStore = new MemoryStagingStore();
  const invalidLedger = new MemoryImportLedger();
  const invalid = await runControlledChaosImport({
    text: "{\"marker\":\"do-not-echo-marker\"}",
    store: invalidStore,
    ledger: invalidLedger,
    mode: "apply",
    execute,
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.code, "PAYLOAD_REJECTED");
    assert.equal(invalid.message.includes("do-not-echo-marker"), false);
    assert.equal(invalid.externalCalls, false);
    assert.equal(invalid.databaseWrites, false);
  }
  assert.deepEqual(invalidStore.read(), emptySnapshot());
  assert.equal(invalidLedger.list().length, 0);

  const demoStore = new MemoryStagingStore();
  const demoLedger = new MemoryImportLedger();
  const demo = await runControlledChaosImport({
    text: sampleText,
    destinationScenarioId: DEMO_SCENARIO_ID,
    store: demoStore,
    ledger: demoLedger,
    mode: "apply",
    execute,
  });
  assert.equal(demo.ok, false);
  if (!demo.ok) {
    assert.equal(demo.code, "DESTINATION_FORBIDDEN");
    assert.match(demo.message, /scn_demo_flood/);
    assert.equal(demo.externalCalls, false);
  }
  assert.deepEqual(demoStore.read(), emptySnapshot());
  assert.equal(demoLedger.list().length, 0);

  const foreign = await runControlledChaosImport({
    text: sampleText,
    destinationScenarioId: "scn_chaos_other",
    mode: "dry-run",
    execute,
  });
  assert.equal(foreign.ok, false);
  if (!foreign.ok) {
    assert.equal(foreign.code, "SAMPLE_SHAPE");
    assert.equal(foreign.message.includes(SAMPLE_CHAOS_SEED), false);
    assert.equal(foreign.externalCalls, false);
  }
});

test("dry-run never calls an executor, and apply handles transport and function results", async () => {
  let calls = 0;
  const execute: ChaosImportExecutor = async (payload) => {
    calls += 1;
    return { data: { ok: true, outcome: "staged", code: "STAGED", import_run_id: payload.run.id, note: SAMPLE_CHAOS_SEED }, error: null };
  };
  const dryRun = await runControlledChaosImport({ text: sampleText, mode: "dry-run", execute });
  assert.equal(dryRun.ok, true);
  assert.equal(calls, 0);
  if (dryRun.ok && dryRun.mode === "dry-run") {
    assert.equal(dryRun.databaseWrites, false);
    assert.equal(dryRun.externalCalls, false);
  }

  const omitted = await runControlledChaosImport({ text: sampleText, mode: "apply" });
  assert.equal(omitted.ok, false);
  if (!omitted.ok) {
    assert.equal(omitted.code, "APPLY_REFUSED");
    assert.equal(omitted.message, "Live import was not approved. Nothing was written.");
    assert.equal(omitted.invoked, false);
    assert.equal(omitted.databaseWrites, false);
    assert.equal(omitted.externalCalls, false);
  }

  const staged = await runControlledChaosImport({ text: sampleText, mode: "apply", execute });
  assert.equal(calls, 1);
  assert.equal(staged.ok, true);
  if (staged.ok && staged.mode === "apply") {
    assert.equal(staged.outcome, "staged");
    assert.equal(staged.databaseWrites, true);
    assert.equal(staged.importRunId, `cimp_run_${SAMPLE_CHAOS_DIGEST_HEX.slice(0, 32)}`);
    assert.equal(JSON.stringify(staged).includes(SAMPLE_CHAOS_SEED), false);
  }

  const mismatched = await runControlledChaosImport({
    text: sampleText,
    mode: "apply",
    execute: async () => ({ data: { ok: true, outcome: "staged", code: "STAGED", import_run_id: "cimp_run_other" }, error: null }),
  });
  assert.equal(mismatched.ok, false);
  if (!mismatched.ok) {
    assert.equal(mismatched.code, "RPC_FAILED");
    assert.equal(mismatched.databaseWrites, false);
    assert.equal(mismatched.externalCalls, true);
  }

  const duplicate = await runControlledChaosImport({
    text: sampleText,
    mode: "apply",
    execute: async () => ({
      data: { ok: false, outcome: "duplicate", code: "DUPLICATE_IMPORT", message: `keep ${SAMPLE_CHAOS_SEED} hidden` },
      error: null,
    }),
  });
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) {
    assert.equal(duplicate.code, "DUPLICATE_IMPORT");
    assert.equal(duplicate.message, "This artifact was already imported.");
    assert.equal(duplicate.databaseWrites, false);
    assert.equal(duplicate.message.includes(SAMPLE_CHAOS_SEED), false);
  }

  const driver = await runControlledChaosImport({
    text: sampleText,
    mode: "apply",
    execute: async () => ({ data: null, error: { code: "42501", message: "permission denied eyJabc.def.ghi" } }),
  });
  assert.equal(driver.ok, false);
  if (!driver.ok) {
    assert.equal(driver.code, "RPC_FAILED");
    assert.match(driver.message, /\[redacted\]/);
    assert.equal(driver.message.includes("eyJabc"), false);
    assert.equal(driver.databaseWrites, false);
  }

  const seededError = await runControlledChaosImport({
    text: sampleText,
    mode: "apply",
    execute: async () => {
      throw new Error(`connection failed ${SAMPLE_CHAOS_SEED}`);
    },
  });
  assert.equal(seededError.ok, false);
  if (!seededError.ok) {
    assert.equal(seededError.message.includes(SAMPLE_CHAOS_SEED), false);
    assert.equal(seededError.databaseWrites, false);
    assert.equal(seededError.externalCalls, true);
  }

  const interpreted = interpretStageChaosImportResult(
    { ok: false, outcome: "rejected", code: "DESTINATION_FORBIDDEN", message: "do-not-echo-marker" },
    "cimp_run_unused",
  );
  assert.equal(interpreted.ok, false);
  if (!interpreted.ok) {
    assert.equal(interpreted.code, "DESTINATION_FORBIDDEN");
    assert.equal(interpreted.message, "scn_demo_flood cannot be an import destination.");
    assert.equal(interpreted.message.includes("do-not-echo-marker"), false);
    assert.equal(interpreted.databaseWrites, false);
  }
});

test("the approval latch and the sample script stay on dry-run", () => {
  assert.equal(chaosServerCallAllowed("dry-run", SAMPLE_IMPORT_APPROVAL), false);
  assert.equal(chaosServerCallAllowed("apply", undefined), false);
  assert.equal(chaosServerCallAllowed("apply", "sample-two-report-later"), false);
  assert.equal(chaosServerCallAllowed("apply", SAMPLE_IMPORT_APPROVAL), true);
  assert.equal(chaosImportCliMode([]), "dry-run");
  assert.equal(chaosImportCliMode(["--dry-run"]), "dry-run");
  assert.equal(chaosImportCliMode(["--apply"]), "refused");
  assert.equal(chaosImportCliMode(["--dry-run", "--apply"]), "refused");

  const moduleSource = readFileSync(new URL("./chaos-import.ts", import.meta.url), "utf8");
  assert.match(moduleSource, /stageValidatedChaosText\(/);
  assert.equal(moduleSource.includes("supabase"), false);
  assert.equal(moduleSource.includes("server-only"), false);
  assert.equal(moduleSource.includes("fetch("), false);
  assert.equal(moduleSource.includes("process.env"), false);
  assert.equal(moduleSource.includes("nemotron"), false);
  assert.equal(moduleSource.includes("apply_human_decision"), false);

  const serverSource = readFileSync(new URL("./chaos-import-server.ts", import.meta.url), "utf8");
  assert.match(serverSource, /^import "server-only";/);
  assert.match(serverSource, /import \{ createSupabaseServerClient \} from "@\/lib\/supabase\/server"/);
  const gate = serverSource.indexOf("if (!chaosServerCallAllowed(");
  const clientCall = serverSource.indexOf("createSupabaseServerClient()");
  assert.ok(gate >= 0 && clientCall > gate);
  assert.match(serverSource, /process\.env\.RESQ_CHAOS_IMPORT_APPROVED/);
  assert.match(serverSource, /rpc\(STAGE_CHAOS_IMPORT_RPC/);
  assert.equal(serverSource.includes("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), false);
  assert.equal(serverSource.includes("SUPABASE_SECRET_KEY"), false);
  assert.equal(serverSource.includes("fetch("), false);
  assert.equal(serverSource.includes("nemotron"), false);
  assert.equal(serverSource.includes("apply_human_decision"), false);
  assert.equal(serverSource.includes("load-scenario"), false);
  assert.equal(serverSource.includes(".from("), false);

  const scriptSource = readFileSync(new URL("../../scripts/import-chaos-sample.mts", import.meta.url), "utf8");
  assert.equal(scriptSource.includes("supabase"), false);
  assert.equal(scriptSource.includes("createSupabaseServerClient"), false);
  assert.equal(scriptSource.includes("fetch("), false);
  assert.equal(scriptSource.includes("process.env"), false);
  assert.match(scriptSource, /mode: "dry-run"/);
  assert.equal(scriptSource.includes("mode: \"apply\""), false);
});

test("a sample-shaped payload that is not the handoff file is refused", () => {
  const prepared = prepareSampleChaosImport(sampleText, { ledger: new MemoryImportLedger() });
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const tampered = {
    ...prepared.payload,
    run: { ...prepared.payload.run, emergency_count: 3 },
  } as StageChaosImportPayload;
  assert.equal(isSampleChaosPayload(tampered), false);
  assert.equal(JSON.stringify(tampered).includes("publicAssignmentWrites"), false);
});
