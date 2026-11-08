import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { importSimulationText } from "@/lib/simulation-import/import-simulation";
import { MemoryImportLedger } from "@/lib/simulation-import/ledger";
import {
  DEMO_SCENARIO_ID,
  IDEMPOTENCY_CONSTRAINT,
  MAX_STAGED_EMERGENCY_OBSERVATIONS,
  MAX_STAGED_PAYLOAD_BYTES,
  MemoryStagingStore,
  RUN_ID_CONSTRAINT,
  classifyUniqueViolation,
  planBelongsToRun,
  planChaosImport,
  stageChaosImport,
  stageValidatedChaosText,
  type ChaosStagingPlan,
  type StagingSnapshot,
} from "@/lib/simulation-import/stage-plan";
import type {
  PublicAssignment,
  PublicEmergencyObservation,
  PublicOperationalObservation,
  PublicUnit,
  SimulationImport,
} from "@/lib/simulation-import/types";

const DESTINATION = "scn_chaos_offline";
const sampleText = readFileSync(new URL("../../../resq-handoff/sample-simulation.json", import.meta.url), "utf8");
const sql = readFileSync(new URL("../../scripts/2026-11-08-chaos-import-staging.sql", import.meta.url), "utf8");

function sampleImport(): SimulationImport {
  const result = importSimulationText(sampleText, new MemoryImportLedger());
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("Sample export did not import.");
  return result.simulation;
}

function withDigest(simulation: SimulationImport, digestHex: string): SimulationImport {
  return {
    source: {
      ...simulation.source,
      digestHex,
      idempotencyKey: `${simulation.document.schemaVersion}:${simulation.document.runId}:${digestHex}`,
    },
    document: simulation.document,
  };
}

function withEmergencyCount(simulation: SimulationImport, count: number): SimulationImport {
  const template = simulation.document.emergencyObservations[0];
  assert.ok(template);
  const emergencyObservations: PublicEmergencyObservation[] = Array.from({ length: count }, (_, index) => ({
    ...template,
    reportId: `rpt_limit_${index}`,
  }));
  return {
    source: simulation.source,
    document: {
      ...simulation.document,
      emergencyObservations,
      summary: {
        ...simulation.document.summary,
        emergencyObservationCount: count,
      },
    },
  };
}

function withIdentity(simulation: SimulationImport, runId: string, digestHex: string): SimulationImport {
  return {
    source: {
      ...simulation.source,
      digestHex,
      idempotencyKey: `${simulation.document.schemaVersion}:${runId}:${digestHex}`,
    },
    document: {
      ...simulation.document,
      runId,
    },
  };
}

function withOperationalCount(simulation: SimulationImport, count: number): SimulationImport {
  const template = simulation.document.operationalObservations[0];
  assert.ok(template);
  const operationalObservations: PublicOperationalObservation[] = Array.from({ length: count }, (_, index) => ({
    ...template,
    observationId: `operation_limit_${index}`,
  }));
  return {
    source: simulation.source,
    document: {
      ...simulation.document,
      operationalObservations,
      summary: { ...simulation.document.summary, operationalObservationCount: count },
    },
  };
}

function withUnitCount(simulation: SimulationImport, count: number): SimulationImport {
  const template = simulation.document.units[0];
  assert.ok(template);
  const units: PublicUnit[] = Array.from({ length: count }, (_, index) => ({
    ...template,
    unitId: `unit_limit_${index}`,
  }));
  return {
    source: simulation.source,
    document: {
      ...simulation.document,
      units,
      summary: { ...simulation.document.summary, unitCount: count },
    },
  };
}

function withAssignmentCount(simulation: SimulationImport, count: number): SimulationImport {
  const template = simulation.document.assignments[0];
  assert.ok(template);
  const assignments: PublicAssignment[] = Array.from({ length: count }, (_, index) => ({
    ...template,
    assignmentId: `assignment_limit_${index}`,
  }));
  return {
    source: simulation.source,
    document: {
      ...simulation.document,
      assignments,
      summary: { ...simulation.document.summary, assignmentCount: count },
    },
  };
}

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

function assertUnchanged(store: MemoryStagingStore, before: StagingSnapshot): void {
  assert.deepEqual(store.read(), before);
}

function stagedPlan(simulation: SimulationImport, destination = DESTINATION): ChaosStagingPlan {
  const decision = planChaosImport(simulation, destination, new MemoryStagingStore());
  if (!decision.ok) throw new Error(decision.message);
  return decision.plan;
}

test("a repeated artifact is a duplicate and writes nothing", () => {
  const simulation = sampleImport();
  const store = new MemoryStagingStore();
  const first = stageChaosImport(simulation, DESTINATION, store);
  assert.equal(first.ok, true);
  const committed = structuredClone(store.read());
  assert.equal(committed.runs.length, 1);

  const second = stageChaosImport(simulation, "scn_chaos_other", store);
  assert.equal(second.ok, false);
  if (!second.ok) {
    assert.equal(second.outcome, "duplicate");
    assert.equal(second.code, "DUPLICATE_IMPORT");
    assert.equal(second.message, "This artifact was already imported.");
  }
  assert.deepEqual(store.read(), committed);
  assert.equal(store.read().runs[0]?.digest_hex, simulation.source.digestHex);
});

test("the same runId with a different digest stays unchanged for manual review", () => {
  const simulation = sampleImport();
  const store = new MemoryStagingStore();
  assert.equal(stageChaosImport(simulation, DESTINATION, store).ok, true);
  const committed = structuredClone(store.read());
  const changed = withDigest(simulation, `${"ab".repeat(32)}`);

  const decision = stageChaosImport(changed, DESTINATION, store);
  assert.equal(decision.ok, false);
  if (!decision.ok) {
    assert.equal(decision.outcome, "review");
    assert.equal(decision.code, "RUN_DIGEST_CONFLICT");
    assert.match(decision.message, /manual review/);
  }
  assert.deepEqual(store.read(), committed);
  assert.equal(store.read().runs[0]?.digest_hex, simulation.source.digestHex);
  assert.notEqual(store.read().runs[0]?.digest_hex, changed.source.digestHex);
});

test("scn_demo_flood is rejected before any staging write", () => {
  const simulation = sampleImport();
  const empty = new MemoryStagingStore();
  const refused = stageChaosImport(simulation, DEMO_SCENARIO_ID, empty);
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.equal(refused.outcome, "rejected");
    assert.equal(refused.code, "DESTINATION_FORBIDDEN");
    assert.match(refused.message, /scn_demo_flood/);
  }
  assert.deepEqual(empty.read(), emptySnapshot());

  const occupied = new MemoryStagingStore();
  assert.equal(stageChaosImport(simulation, DESTINATION, occupied).ok, true);
  const committed = structuredClone(occupied.read());
  const repeated = stageChaosImport(simulation, DEMO_SCENARIO_ID, occupied);
  assert.equal(repeated.ok, false);
  if (!repeated.ok) assert.equal(repeated.code, "DESTINATION_FORBIDDEN");
  assert.deepEqual(occupied.read(), committed);
});

test("fictional grid coordinates are preserved exactly", () => {
  const simulation = sampleImport();
  const plan = stagedPlan(simulation);
  const document = simulation.document;

  document.emergencyObservations.forEach((observation, index) => {
    const row = plan.emergencyObservations[index];
    assert.ok(row);
    assert.equal(typeof row.grid_x, "number");
    assert.equal(typeof row.grid_y, "number");
    assert.ok(Object.is(row.grid_x, observation.location.x));
    assert.ok(Object.is(row.grid_y, observation.location.y));
    assert.equal(row.coordinate_system, "SIMULATED_LOCAL_GRID");
    assert.equal(row.fictional, true);
    assert.equal(row.description, observation.location.description);
    assert.equal(row.district, observation.location.district);
    assert.equal(row.primary_reference, observation.location.primaryReference);
    assert.equal(row.secondary_reference, observation.location.secondaryReference);
    assert.equal(row.precision, observation.location.precision);
  });

  document.units.forEach((unit, index) => {
    const row = plan.units[index];
    assert.ok(row);
    assert.ok(Object.is(row.grid_x, unit.location?.x ?? null));
    assert.ok(Object.is(row.grid_y, unit.location?.y ?? null));
  });

  document.operationalObservations.forEach((observation, index) => {
    const row = plan.operationalObservations[index];
    assert.ok(row);
    assert.ok(Object.is(row.grid_x, observation.content.location?.x ?? null));
    assert.ok(Object.is(row.grid_y, observation.content.location?.y ?? null));
    assert.ok(Object.is(row.fatigue, observation.content.fatigue));
    assert.equal(row.observed_at, observation.observedAt);
  });

  assert.equal(JSON.stringify(plan).includes("latitude"), false);
  assert.equal(JSON.stringify(plan).includes("longitude"), false);
  assert.equal(plan.run.simulation_start, document.simulationTime.startTime);
  assert.equal(plan.run.simulation_export, document.simulationTime.exportTime);
  assert.equal(plan.run.first_received_at, document.summary.firstReceivedAt);
  assert.equal(plan.run.last_received_at, document.summary.lastReceivedAt);
});

test("imported assignments stay out of the human assignment table", () => {
  const simulation = sampleImport();
  const store = new MemoryStagingStore();
  const decision = stageChaosImport(simulation, DESTINATION, store);
  assert.equal(decision.ok, true);
  if (!decision.ok) return;

  assert.equal(decision.plan.publicAssignmentWrites.length, 0);
  assert.equal(decision.plan.chaosPublicAssignments.length, simulation.document.assignments.length);
  assert.deepEqual(
    decision.plan.chaosPublicAssignments.map((row) => row.assignment_id),
    simulation.document.assignments.map((row) => row.assignmentId),
  );
  for (const row of decision.plan.chaosPublicAssignments) {
    assert.equal(row.local_id.startsWith("cimp_"), true);
    assert.equal(row.local_id.startsWith("asn_"), false);
    assert.equal("incident_id" in row, false);
    assert.equal("responder_id" in row, false);
    assert.equal("origin" in row, false);
    assert.equal("status" in row, false);
  }
  assert.deepEqual(Object.keys(store.read()).sort(), [
    "chaosPublicAssignments",
    "emergencyObservations",
    "operationalObservations",
    "runs",
    "sourceIds",
    "units",
  ]);
  assert.equal(JSON.stringify(store.read()).includes("\"assignments\""), false);
});

test("a failed commit rolls back and one store cannot see another scenario", () => {
  const simulation = sampleImport();
  const store = new MemoryStagingStore();
  store.failNextCommit = true;
  const failed = stageChaosImport(simulation, DESTINATION, store);
  assert.equal(failed.ok, false);
  if (!failed.ok) {
    assert.equal(failed.outcome, "rejected");
    assert.equal(failed.code, "COMMIT_FAILED");
    assert.equal(failed.message, "Staging commit failed.");
    assert.equal(failed.message.includes(simulation.document.scenario.seed), false);
    assert.equal(failed.message.includes(simulation.document.emergencyObservations[0]?.narrative ?? "narrative"), false);
  }
  assert.deepEqual(store.read(), emptySnapshot());

  const isolated = new MemoryStagingStore();
  const staged = stageChaosImport(simulation, DESTINATION, store);
  assert.equal(staged.ok, true);
  if (!staged.ok) return;
  assert.equal(store.read().runs.length, 1);
  assert.deepEqual(isolated.read(), emptySnapshot());
  assert.equal(staged.plan.destinationScenarioId, DESTINATION);
  assert.equal(staged.plan.run.source_scenario_id, simulation.document.scenario.scenarioId);
  assert.equal(staged.plan.run.source_scenario_id === DESTINATION, false);
  assert.equal(JSON.stringify(staged.plan.run).includes(DEMO_SCENARIO_ID), false);
  assertUnchanged(isolated, emptySnapshot());
});

test("the first writer accepts 10000 emergency observations and rejects 10001", () => {
  const simulation = sampleImport();
  const accepted = planChaosImport(withEmergencyCount(simulation, MAX_STAGED_EMERGENCY_OBSERVATIONS), DESTINATION, new MemoryStagingStore());
  assert.equal(accepted.ok, true);
  if (accepted.ok) {
    assert.equal(accepted.plan.emergencyObservations.length, 10_000);
    assert.equal(accepted.plan.run.emergency_count, 10_000);
    assert.equal(accepted.plan.emergencyObservations[0]?.ordinal, 0);
    assert.equal(accepted.plan.emergencyObservations[9_999]?.ordinal, 9_999);
  }

  const store = new MemoryStagingStore();
  const rejected = stageChaosImport(withEmergencyCount(simulation, MAX_STAGED_EMERGENCY_OBSERVATIONS + 1), DESTINATION, store);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) {
    assert.equal(rejected.code, "EMERGENCY_LIMIT");
    assert.match(rejected.message, /10000/);
  }
  assert.deepEqual(store.read(), emptySnapshot());
});

test("staging SQL adds locked service-role tables and leaves current RES-Q tables untouched", () => {
  const executable = sql.replace(/--.*$/gm, "");
  assert.match(executable, /CREATE TABLE public\.chaos_import_runs/);
  assert.match(executable, /CREATE TABLE public\.chaos_emergency_observations/);
  assert.match(executable, /CREATE TABLE public\.chaos_operational_observations/);
  assert.match(executable, /CREATE TABLE public\.chaos_units/);
  assert.match(executable, /CREATE TABLE public\.chaos_public_assignments/);
  assert.match(executable, /CREATE TABLE public\.chaos_source_ids/);
  assert.match(executable, /CREATE OR REPLACE FUNCTION public\.stage_chaos_import\(payload jsonb\)/);
  assert.match(executable, /scn_demo_flood/);
  assert.match(executable, /jsonb_array_length\(v_emergency\) > 10000/);
  assert.match(executable, /emergency_count BETWEEN 0 AND 10000/);
  assert.match(executable, /operational_count BETWEEN 0 AND 10000/);
  assert.match(executable, /unit_count BETWEEN 0 AND 10000/);
  assert.match(executable, /assignment_count BETWEEN 0 AND 10000/);
  assert.match(executable, /byte_length BETWEEN 0 AND 33554432/);
  assert.match(executable, /octet_length\(payload::text\) > 33554432/);
  assert.match(executable, /jsonb_array_length\(v_operational\) > 10000/);
  assert.match(executable, /jsonb_array_length\(v_units\) > 10000/);
  assert.match(executable, /jsonb_array_length\(v_assignments\) > 10000/);
  assert.match(executable, /jsonb_array_length\(v_source_ids\) > 40001/);
  assert.match(executable, /IS DISTINCT FROM v_import_id/);
  assert.match(executable, /pg_catalog\.pg_advisory_xact_lock\(pg_catalog\.hashtextextended/);
  assert.match(executable, /SECURITY INVOKER/);
  assert.match(executable, /SET search_path = pg_catalog, public, pg_temp/);
  assert.match(executable, /GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME/);
  assert.match(executable, /WHEN unique_violation THEN/);
  assert.doesNotMatch(executable, /FOR UPDATE/);
  assert.doesNotMatch(executable, /SECURITY DEFINER/);
  assert.doesNotMatch(executable, /GRANT UPDATE/i);
  assert.doesNotMatch(executable, /WHEN OTHERS/);
  assert.doesNotMatch(executable, /ON CONFLICT/);
  assert.doesNotMatch(executable, /CREATE POLICY/i);
  assert.doesNotMatch(executable, /apply_human_decision/);
  assert.doesNotMatch(executable, /\b(latitude|longitude)\b/i);
  assert.doesNotMatch(executable, /double precision/i);
  assert.doesNotMatch(executable, /::timestamptz/);
  assert.equal([...executable.matchAll(/timestamptz/gi)].length, 1);
  assert.match(executable, /grid_x numeric/);
  assert.match(executable, /grid_y numeric/);
  assert.match(executable, /fatigue numeric/);

  const protectedTables = "scenarios|incidents|reports|responders|assignments|agent_runs|approval_actions";
  assert.doesNotMatch(executable, new RegExp(`\\bALTER\\s+TABLE\\s+public\\.(${protectedTables})\\b`, "i"));
  assert.doesNotMatch(executable, new RegExp(`\\bDROP\\s+TABLE\\b`, "i"));
  assert.doesNotMatch(executable, new RegExp(`\\b(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+public\\.(${protectedTables})\\b`, "i"));
  assert.doesNotMatch(executable, new RegExp(`\\bREFERENCES\\s+public\\.(${protectedTables})\\b`, "i"));
  assert.doesNotMatch(executable, /\bUPDATE\s+public\.chaos_/i);
  assert.doesNotMatch(executable, /\bDELETE\s+FROM\b/i);

  assert.deepEqual([...executable.matchAll(/^GRANT .*;$/gm)].map((match) => match[0]), [
    "GRANT SELECT, INSERT ON TABLE public.chaos_import_runs TO service_role;",
    "GRANT SELECT, INSERT ON TABLE public.chaos_emergency_observations TO service_role;",
    "GRANT SELECT, INSERT ON TABLE public.chaos_operational_observations TO service_role;",
    "GRANT SELECT, INSERT ON TABLE public.chaos_units TO service_role;",
    "GRANT SELECT, INSERT ON TABLE public.chaos_public_assignments TO service_role;",
    "GRANT SELECT, INSERT ON TABLE public.chaos_source_ids TO service_role;",
    "GRANT EXECUTE ON FUNCTION public.stage_chaos_import(jsonb) TO service_role;",
  ]);
  for (const table of [
    "chaos_import_runs",
    "chaos_emergency_observations",
    "chaos_operational_observations",
    "chaos_units",
    "chaos_public_assignments",
    "chaos_source_ids",
  ]) {
    assert.match(executable, new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM service_role`));
  }
  assert.doesNotMatch(executable, /GRANT[\s\S]{0,120}TO anon/);
  assert.doesNotMatch(executable, /GRANT[\s\S]{0,120}TO authenticated/);
  for (const table of [
    "chaos_import_runs",
    "chaos_emergency_observations",
    "chaos_operational_observations",
    "chaos_units",
    "chaos_public_assignments",
    "chaos_source_ids",
  ]) {
    assert.match(executable, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(executable, new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM anon`));
    assert.match(executable, new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM authenticated`));
  }

  const insertAt = executable.indexOf("INSERT INTO public.chaos_import_runs");
  for (const token of [
    "DESTINATION_FORBIDDEN",
    "PAYLOAD_LIMIT",
    "EMERGENCY_LIMIT",
    "OPERATIONAL_LIMIT",
    "UNIT_LIMIT",
    "ASSIGNMENT_LIMIT",
    "SOURCE_LIMIT",
    "CROSS_RUN_REJECTED",
    "pg_catalog.pg_advisory_xact_lock",
  ]) {
    const at = executable.indexOf(token);
    assert.ok(at >= 0 && at < insertAt, token);
  }
  assert.ok(executable.indexOf("CHILD_ID_CONFLICT") < insertAt);
  const handler = executable.slice(executable.lastIndexOf("EXCEPTION"));
  const constraintAt = handler.indexOf("chaos_import_runs_run_uidx");
  const reviewAt = handler.indexOf("RUN_DIGEST_CONFLICT");
  const childAt = handler.lastIndexOf("CHILD_ID_CONFLICT");
  assert.ok(constraintAt >= 0 && constraintAt < reviewAt && reviewAt < childAt);
  assert.equal(handler.slice(0, constraintAt).includes("RUN_DIGEST_CONFLICT"), false);
  const beforeInsert = executable.slice(executable.indexOf("AS $fn$"), insertAt);
  assert.equal(/\bEXECUTE\b/.test(beforeInsert), false);
  assert.equal(/\bFORMAT\s*\(/.test(beforeInsert), false);

  const source = readFileSync(new URL("./stage-plan.ts", import.meta.url), "utf8");
  assert.equal(source.toLowerCase().includes("supabase"), false);
  assert.equal(source.toLowerCase().includes("nemotron"), false);
  assert.equal(source.includes("fetch("), false);
});

test("child id collisions stay distinct from a run digest conflict", () => {
  const simulation = sampleImport();
  const existing = {
    digest_hex: "ab".repeat(32),
    idempotency_key: `resq.simulation.v1:run_a:${"ab".repeat(32)}`,
  };
  const incoming = {
    digest_hex: "cd".repeat(32),
    idempotency_key: `resq.simulation.v1:run_a:${"cd".repeat(32)}`,
  };
  for (const constraintName of [
    "chaos_import_runs_pkey",
    "chaos_emergency_local_uidx",
    "chaos_emergency_report_uidx",
    "chaos_operational_local_uidx",
    "chaos_operational_id_uidx",
    "chaos_units_local_uidx",
    "chaos_public_assignments_local_uidx",
    "chaos_source_ids_local_uidx",
    "chaos_source_ids_pkey",
  ]) {
    const decision = classifyUniqueViolation(constraintName, existing, incoming);
    assert.equal(decision.ok, false);
    if (!decision.ok) {
      assert.equal(decision.code, "CHILD_ID_CONFLICT");
      assert.equal(decision.outcome, "rejected");
      assert.equal(decision.message.includes("manual review"), false);
    }
  }
  const review = classifyUniqueViolation(RUN_ID_CONSTRAINT, existing, incoming);
  assert.equal(review.ok, false);
  if (!review.ok) assert.equal(review.code, "RUN_DIGEST_CONFLICT");
  const absent = classifyUniqueViolation(RUN_ID_CONSTRAINT, undefined, incoming);
  assert.equal(absent.ok, false);
  if (!absent.ok) assert.equal(absent.code, "CHILD_ID_CONFLICT");
  const idempotency = classifyUniqueViolation(IDEMPOTENCY_CONSTRAINT, existing, incoming);
  assert.equal(idempotency.ok, false);
  if (!idempotency.ok) assert.equal(idempotency.code, "CHILD_ID_CONFLICT");

  const store = new MemoryStagingStore();
  assert.equal(stageChaosImport(simulation, DESTINATION, store).ok, true);
  const committed = structuredClone(store.read());
  const otherDigest = `${simulation.source.digestHex.slice(0, 12)}${"c".repeat(52)}`;
  const decision = stageChaosImport(withIdentity(simulation, "run_other_child", otherDigest), DESTINATION, store);
  assert.equal(decision.ok, false);
  if (!decision.ok) {
    assert.equal(decision.code, "CHILD_ID_CONFLICT");
    assert.equal(decision.message.includes("manual review"), false);
    assert.equal(decision.message.includes(simulation.document.scenario.seed), false);
  }
  assert.deepEqual(store.read(), committed);
  assert.equal(store.read().runs.length, 1);
  assert.equal(store.read().runs[0]?.run_id, simulation.document.runId);
});

test("row caps and payload size are refused before a staging write", () => {
  const simulation = sampleImport();
  const cases = [
    { code: "OPERATIONAL_LIMIT", simulation: withOperationalCount(simulation, 10_001) },
    { code: "UNIT_LIMIT", simulation: withUnitCount(simulation, 10_001) },
    { code: "ASSIGNMENT_LIMIT", simulation: withAssignmentCount(simulation, 10_001) },
  ] as const;
  for (const item of cases) {
    const store = new MemoryStagingStore();
    const decision = stageChaosImport(item.simulation, DESTINATION, store);
    assert.equal(decision.ok, false);
    if (!decision.ok) {
      assert.equal(decision.code, item.code);
      assert.match(decision.message, /10000/);
    }
    assert.deepEqual(store.read(), emptySnapshot());
  }

  const oversized = {
    ...simulation,
    source: { ...simulation.source, byteLength: MAX_STAGED_PAYLOAD_BYTES + 1 },
  };
  const sized = new MemoryStagingStore();
  const sizeDecision = stageChaosImport(oversized, DESTINATION, sized);
  assert.equal(sizeDecision.ok, false);
  if (!sizeDecision.ok) assert.equal(sizeDecision.code, "PAYLOAD_LIMIT");
  assert.deepEqual(sized.read(), emptySnapshot());

  const tight = new MemoryStagingStore();
  const tightDecision = stageChaosImport(simulation, DESTINATION, tight, { maxPayloadBytes: simulation.source.byteLength });
  assert.equal(tightDecision.ok, false);
  if (!tightDecision.ok) assert.equal(tightDecision.code, "PAYLOAD_LIMIT");
  assert.deepEqual(tight.read(), emptySnapshot());
});

test("public validation and a fresh SHA-256 happen before staging", () => {
  const store = new MemoryStagingStore();
  const staged = stageValidatedChaosText(sampleText, DESTINATION, store, new MemoryImportLedger());
  assert.equal(staged.ok, true);
  if (!staged.ok) return;
  const digest = createHash("sha256").update(sampleText).digest("hex");
  assert.equal(staged.plan.run.digest_hex, digest);
  assert.equal(store.read().runs[0]?.digest_hex, digest);
  assert.equal(planBelongsToRun(staged.plan), true);
  const foreign = {
    ...staged.plan,
    emergencyObservations: [{ ...staged.plan.emergencyObservations[0]!, import_run_id: "cimp_run_other" }],
  };
  assert.equal(planBelongsToRun(foreign), false);

  const padded = `${sampleText}\n`;
  const paddedStore = new MemoryStagingStore();
  const paddedResult = stageValidatedChaosText(padded, DESTINATION, paddedStore, new MemoryImportLedger());
  assert.equal(paddedResult.ok, true);
  if (!paddedResult.ok) return;
  assert.equal(paddedResult.plan.run.digest_hex, createHash("sha256").update(padded).digest("hex"));
  assert.notEqual(paddedResult.plan.run.digest_hex, createHash("sha256").update(JSON.stringify(JSON.parse(padded))).digest("hex"));
  assert.deepEqual(store.read().runs.map((run) => run.digest_hex), [digest]);

  const rejectedStore = new MemoryStagingStore();
  const rejected = stageValidatedChaosText('{"marker":"do-not-echo-marker"}', DESTINATION, rejectedStore, new MemoryImportLedger());
  assert.equal(rejected.ok, false);
  if (!rejected.ok) {
    assert.equal(rejected.code, "PAYLOAD_REJECTED");
    assert.equal(rejected.message.includes("do-not-echo-marker"), false);
  }
  assert.deepEqual(rejectedStore.read(), emptySnapshot());
});
