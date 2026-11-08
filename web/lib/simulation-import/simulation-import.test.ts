import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { importSimulationText, validateSimulationValue } from "@/lib/simulation-import/import-simulation";
import { collectSchemaIssues } from "@/lib/simulation-import/schema-validator";
import { MemoryImportLedger } from "@/lib/simulation-import/ledger";
import {
  FORBIDDEN_SIMULATION_KEYS,
  SCHEMA_VERSION,
  type ImportLedger,
  type ImportResult,
  type PublicSimulationDocument,
} from "@/lib/simulation-import/types";

const sampleUrl = new URL("../../../resq-handoff/sample-simulation.json", import.meta.url);
const sampleText = readFileSync(sampleUrl, "utf8");
const START = "2023-11-14T22:13:20.000Z";
const EXPORT = "2023-11-14T22:13:20.100Z";
const T1 = "2023-11-14T22:13:20.010Z";
const T2 = "2023-11-14T22:13:20.020Z";

test("sample export imports as public fictional observations", () => {
  const ledger = new MemoryImportLedger();
  const result = importSimulationText(sampleText, ledger);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const { document, source } = result.simulation;
  const parsed = JSON.parse(sampleText) as PublicSimulationDocument;
  assert.equal(document.schemaVersion, "resq.simulation.v1");
  assert.equal(document.engineVersion, "0.1.0");
  assert.equal(document.runId, "run_19kluv9nadmt1");
  assert.equal(document.scenario.fictional, true);
  assert.equal(document.scenario.seed, "resq-handoff-sample");
  assert.equal(document.scenario.scenarioId, "cli-flood-v1");
  assert.equal(document.scenario.difficulty, "CALM");
  assert.equal(document.simulationTime.status, "COMPLETED");
  assert.equal(document.emergencyObservations.length, 2);
  assert.equal(document.operationalObservations.length, 7);
  assert.equal(document.units.length, 1);
  assert.equal(document.assignments.length, 1);
  assert.equal(document.summary.emergencyObservationCount, 2);
  assert.equal(document.summary.operationalObservationCount, 7);
  assert.equal(document.units[0]?.callsign, "CLI-0001");
  assert.equal(document.assignments[0]?.assignmentId, "assignment_000001");
  assert.equal(document.assignments[0]?.unitId, "unit_000001");
  assert.equal(document.replayManifest?.presetVersion, "phase7b.v1");
  assert.deepEqual(document.emergencyObservations.map((item) => item.reportId), parsed.emergencyObservations.map((item) => item.reportId));
  assert.deepEqual(document.emergencyObservations.map((item) => item.narrative), parsed.emergencyObservations.map((item) => item.narrative));
  assert.deepEqual(document.operationalObservations.map((item) => item.observationId), parsed.operationalObservations.map((item) => item.observationId));
  for (const observation of document.emergencyObservations) {
    assert.equal(observation.status, "RECEIVED");
    assert.equal(observation.location.fictional, true);
    assert.equal(observation.location.coordinateSystem, "SIMULATED_LOCAL_GRID");
  }
  for (const observation of document.operationalObservations) {
    assert.equal(observation.deliveryStatus, "DELIVERED");
    assert.equal(observation.unitId, "unit_000001");
  }
  assert.equal(source.digestAlgorithm, "SHA-256");
  assert.equal(source.digestHex, createHash("sha256").update(sampleText).digest("hex"));
  assert.equal(source.idempotencyKey, `${SCHEMA_VERSION}:${document.runId}:${source.digestHex}`);
  assert.equal(source.byteLength, Buffer.byteLength(sampleText));
  assert.equal(Object.isFrozen(result.simulation), true);
  assert.equal(Object.isFrozen(document.emergencyObservations), true);
  assert.equal(validateSimulationValue(document).ok, true);
  assert.deepEqual(forbiddenPaths(document), []);
  assert.deepEqual(Object.keys(document).sort(), [
    "assignments",
    "emergencyObservations",
    "engineVersion",
    "operationalObservations",
    "replayManifest",
    "runId",
    "scenario",
    "schemaVersion",
    "simulationTime",
    "summary",
    "units",
  ]);
  assert.equal(ledger.list().length, 1);

  const duplicate = importSimulationText(sampleText, ledger);
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) {
    assert.equal(duplicate.stage, "duplicate");
    assert.equal(duplicate.issues[0]?.message, "This artifact was already imported.");
  }
  assert.equal(ledger.list().length, 1);

  const changed = importSimulationText(`${sampleText} `, ledger);
  assert.equal(changed.ok, false);
  if (!changed.ok) {
    assert.equal(changed.stage, "duplicate");
    assert.equal(changed.issues[0]?.path, "$.runId");
    assert.match(changed.issues[0]?.message ?? "", /manual review/);
  }
  assert.equal(ledger.list().length, 1);
  assert.equal(ledger.list()[0]?.document.scenario.label, "Fictional Urban Flood exercise");
});

test("minimal document with a null replay manifest imports", () => {
  const ledger = new MemoryImportLedger();
  const result = importJson(minimalDocument(), ledger);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.simulation.document.replayManifest, null);
  assert.equal(result.simulation.document.scenario.difficulty, null);
  assert.equal(result.simulation.document.summary.firstReceivedAt, null);
});

test("linked public references import without hidden fields", () => {
  const result = importJson(linkedDocument(), new MemoryImportLedger());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.simulation.document.operationalObservations[0]?.assignmentId, "assignment_000001");
  assert.deepEqual(forbiddenPaths(result.simulation), []);
});

test("invalid text and unsupported versions fail closed", () => {
  const ledger = new MemoryImportLedger();
  const parsed = importSimulationText("{", ledger);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.stage, "parse");

  const oversized = importSimulationText(JSON.stringify(minimalDocument()), ledger, { maxBytes: 8 });
  assert.equal(oversized.ok, false);
  if (!oversized.ok) assert.equal(oversized.stage, "read");

  const version = structuredClone(minimalDocument());
  version.schemaVersion = "resq.simulation.v999";
  const versionResult = importJson(version, ledger);
  assert.equal(versionResult.ok, false);
  if (!versionResult.ok) {
    assert.equal(versionResult.stage, "version");
    assert.equal(versionResult.issues.some((issue) => issue.message === "Unexpected property."), false);
  }

  const engine = structuredClone(minimalDocument());
  engine.engineVersion = "9.9.9";
  const engineResult = importJson(engine, ledger);
  assert.equal(engineResult.ok, false);
  if (!engineResult.ok) assert.equal(engineResult.stage, "version");
  assert.equal(ledger.list().length, 0);
});

test("private fields are rejected and omitted from errors", () => {
  assert.deepEqual(FORBIDDEN_SIMULATION_KEYS, [
    "internalIncidentId",
    "relatedIncidentId",
    "responderId",
    "relatedResponderId",
    "relatedTaskId",
    "taskId",
    "messageId",
    "severity",
    "environment",
    "infrastructure",
    "causeEventId",
    "ruleId",
    "cascadeDepth",
    "duplicateFamilyId",
    "duplicateOfReportId",
    "contradictionOfReportId",
    "sourceQuality",
    "reliabilityScore",
    "groundTruthLocation",
    "futureEvents",
    "failureReason",
    "attemptCount",
    "actualState",
    "privateEvaluation",
  ]);

  for (const key of FORBIDDEN_SIMULATION_KEYS) {
    const document = minimalDocument() as Record<string, unknown>;
    document[key] = { secret: "SHOULD_NOT_ECHO" };
    const result = importJson(document, new MemoryImportLedger());
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.stage, "schema");
      assert.equal(result.issues.some((issue) => issue.message === "Forbidden private field."), true);
      assert.equal(JSON.stringify(result.issues).includes("SHOULD_NOT_ECHO"), false);
    }
  }

  const nested = linkedDocument();
  (nested.emergencyObservations[0]?.location as { groundTruthLocation?: { secret: string } }).groundTruthLocation = { secret: "SHOULD_NOT_ECHO" };
  const nestedResult = importJson(nested, new MemoryImportLedger());
  assert.equal(nestedResult.ok, false);
  if (!nestedResult.ok) {
    assert.equal(nestedResult.issues.some((issue) => issue.message === "Forbidden private field."), true);
    assert.equal(JSON.stringify(nestedResult.issues).includes("SHOULD_NOT_ECHO"), false);
  }
});

test("unexpected properties, bad numbers, and prototype keys do not import", () => {
  const extra = minimalDocument() as Record<string, unknown>;
  extra.note = "hello";
  const extraResult = importJson(extra, new MemoryImportLedger());
  assert.equal(extraResult.ok, false);
  if (!extraResult.ok) {
    assert.equal(extraResult.stage, "schema");
    assert.equal(extraResult.issues[0]?.message, "Unexpected property.");
  }

  const infinite = minimalDocument();
  infinite.summary.emergencyObservationCount = Number.POSITIVE_INFINITY;
  const infiniteResult = validateSimulationValue(infinite);
  assert.equal(infiniteResult.ok, false);
  if (!infiniteResult.ok) {
    assert.equal(infiniteResult.stage, "schema");
    assert.match(infiniteResult.issues[0]?.message ?? "", /Non-finite/);
  }

  const fractional = linkedDocument();
  fractional.operationalObservations[0]!.content.inventory = { radio: 1.5 };
  const fractionalResult = importJson(fractional, new MemoryImportLedger());
  assert.equal(fractionalResult.ok, false);
  if (!fractionalResult.ok) assert.equal(fractionalResult.stage, "schema");

  const polluted = JSON.stringify(minimalDocument()).replace("{", '{"__proto__":{"polluted":true},');
  try {
    const result = importSimulationText(polluted, new MemoryImportLedger());
    assert.equal(result.ok, false);
    assert.equal((Object.prototype as { polluted?: boolean }).polluted, undefined);
  } finally {
    delete (Object.prototype as { polluted?: boolean }).polluted;
  }
});

test("cross-record rules reject inconsistent public documents", () => {
  const duplicate = linkedDocument();
  duplicate.emergencyObservations.push(report("rpt_0001", T2));
  syncSummary(duplicate);
  assertStage(importJson(duplicate, new MemoryImportLedger()), "cross-reference", "Identifier must be unique.");

  const missingUnit = linkedDocument();
  missingUnit.operationalObservations[0]!.unitId = "unit_missing";
  assertStage(importJson(missingUnit, new MemoryImportLedger()), "cross-reference", "Reference does not resolve.");

  const future = linkedDocument();
  future.emergencyObservations[0]!.submittedAt = "9999-12-31T23:59:59.998Z";
  future.emergencyObservations[0]!.receivedAt = "9999-12-31T23:59:59.999Z";
  syncSummary(future);
  assertStage(importJson(future, new MemoryImportLedger()), "cross-reference", "Observation was received after export time.");

  const summary = linkedDocument();
  summary.emergencyObservations[0]!.narrative = "SHOULD_NOT_ECHO";
  summary.summary.emergencyObservationCount = 0;
  const summaryResult = importJson(summary, new MemoryImportLedger());
  assert.equal(summaryResult.ok, false);
  if (!summaryResult.ok) {
    assert.equal(summaryResult.stage, "cross-reference");
    assert.equal(JSON.stringify(summaryResult.issues).includes("SHOULD_NOT_ECHO"), false);
  }

  const unsorted = linkedDocument();
  unsorted.emergencyObservations = [report("rpt_later", T2), report("rpt_sooner", T1)];
  syncSummary(unsorted);
  assertStage(importJson(unsorted, new MemoryImportLedger()), "cross-reference", "Observations are not in canonical receipt order.");

  const tie = linkedDocument();
  tie.emergencyObservations = [report("rpt_b", T1), report("rpt_a", T1)];
  syncSummary(tie);
  assertStage(importJson(tie, new MemoryImportLedger()), "cross-reference", "Observations are not in canonical receipt order.");
});

test("a failed commit does not report a successful import", () => {
  let committed = false;
  const ledger: ImportLedger = {
    findByKey: () => undefined,
    findByRun: () => undefined,
    commit() {
      committed = true;
      throw new Error("disk full");
    },
  };
  const result = importJson(minimalDocument(), ledger);
  assert.equal(committed, true);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.stage, "commit");
    assert.equal(result.issues[0]?.message, "Import commit failed.");
    assert.equal(JSON.stringify(result.issues).includes("disk full"), false);
    assert.equal(JSON.stringify(result.issues).includes("Fictional minimal exercise"), false);
  }
});

test("nesting deeper than the public document shape is rejected", () => {
  let nested: unknown = { fictional: true };
  for (let index = 0; index < 20; index += 1) nested = { child: nested };
  const result = validateSimulationValue(nested);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.stage, "schema");
    assert.match(result.issues[0]?.message ?? "", /nesting/);
  }
});

test("adapter modules do not reach Supabase, Nemotron, or the network", () => {
  for (const name of ["types.ts", "schema-validator.ts", "ledger.ts", "import-simulation.ts"]) {
    const source = readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
    assert.equal(source.toLowerCase().includes("supabase"), false);
    assert.equal(source.toLowerCase().includes("nemotron"), false);
    assert.equal(source.includes("fetch("), false);
  }
});

test("schema evaluator enforces every constraint in the public schema", () => {
  assert.deepEqual(collectSchemaIssues(minimalDocument()), []);
  assert.deepEqual(collectSchemaIssues(linkedDocument()), []);

  const boundary = linkedDocument();
  boundary.emergencyObservations[0]!.narrative = "a".repeat(2000);
  boundary.emergencyObservations[0]!.location.x = 1_000_000;
  boundary.emergencyObservations[0]!.location.y = -1_000_000;
  boundary.emergencyObservations[0]!.location.district = null;
  boundary.emergencyObservations[0]!.location.precision = null;
  boundary.scenario.scenarioId = "s".repeat(128);
  boundary.scenario.seed = "s".repeat(256);
  boundary.scenario.label = "s".repeat(256);
  boundary.runId = `r${"a".repeat(127)}`;
  boundary.operationalObservations[0]!.assignmentId = null;
  boundary.units[0]!.assignmentId = null;
  boundary.operationalObservations[0]!.content.fatigue = 100;
  boundary.operationalObservations[0]!.content.routeVersion = 1_000_000;
  boundary.operationalObservations[0]!.content.inventory = { [("k").repeat(2000)]: 10_000 };
  boundary.replayManifest = manifest({ durationMs: 604_800_000, reportCount: 10_000, responderCount: 1_000 });
  assert.deepEqual(collectSchemaIssues(boundary), []);

  const imported = importJson(boundary, new MemoryImportLedger());
  assert.equal(imported.ok, true);
  if (imported.ok) {
    const location = imported.simulation.document.emergencyObservations[0]?.location;
    assert.equal(location?.x, 1_000_000);
    assert.equal(location?.y, -1_000_000);
    assert.equal(location?.coordinateSystem, "SIMULATED_LOCAL_GRID");
    assert.equal(location?.fictional, true);
    assert.equal(Object.hasOwn(location ?? {}, "latitude"), false);
    assert.equal(Object.hasOwn(location ?? {}, "longitude"), false);
  }

  rejectSchema((document) => {
    document.scenario.fictional = false;
  }, "Value is not allowed.");
  rejectSchema((document) => {
    document.emergencyObservations[0]!.location.coordinateSystem = "WGS84";
  }, "Value is not allowed.");
  rejectSchema((document) => {
    (document.emergencyObservations[0]!.location as { latitude?: number }).latitude = 32.7;
  }, "Unexpected property.");
  rejectSchema((document) => {
    document.emergencyObservations[0]!.location.x = 1_000_000.1;
  }, "Number is above the contract maximum.");
  rejectSchema((document) => {
    document.emergencyObservations[0]!.location.y = -1_000_000.1;
  }, "Number is below the contract minimum.");
  rejectSchema((document) => {
    (document.emergencyObservations[0]!.location as { x: unknown }).x = "10";
  }, "Value has the wrong type.");
  rejectSchema((document) => {
    document.emergencyObservations[0]!.narrative = "";
  }, "Text is shorter than the contract allows.");
  rejectSchema((document) => {
    document.emergencyObservations[0]!.narrative = "a".repeat(2001);
  }, "Text is longer than the contract allows.");
  rejectSchema((document) => {
    document.emergencyObservations[0]!.location.district = "";
  }, "Text is shorter than the contract allows.");
  rejectSchema((document) => {
    document.scenario.scenarioId = "";
  }, "Text is shorter than the contract allows.");
  rejectSchema((document) => {
    document.scenario.scenarioId = "s".repeat(129);
  }, "Text is longer than the contract allows.");
  rejectSchema((document) => {
    document.scenario.seed = "s".repeat(257);
  }, "Text is longer than the contract allows.");
  rejectSchema((document) => {
    document.scenario.label = "s".repeat(257);
  }, "Text is longer than the contract allows.");
  rejectSchema((document) => {
    document.runId = "";
  }, "Value does not match the required pattern.");
  rejectSchema((document) => {
    document.runId = "-bad";
  }, "Value does not match the required pattern.");
  rejectSchema((document) => {
    document.runId = `r${"a".repeat(128)}`;
  }, "Value does not match the required pattern.");
  rejectSchema((document) => {
    document.runId = "bad id";
  }, "Value does not match the required pattern.");
  rejectSchema((document) => {
    document.simulationTime.exportTime = "2023-11-14T22:13:20Z";
  }, "Value does not match the required pattern.");
  rejectSchema((document) => {
    document.simulationTime.exportTime = "2023-11-14T22:13:20.000+00:00";
  }, "Value does not match the required pattern.");
  rejectSchema((document) => {
    document.simulationTime.exportTime = "2023-02-31T00:00:00.000Z";
  }, "Timestamp must be canonical UTC.");
  rejectSchema((document) => {
    document.scenario.difficulty = "calm";
  }, "Value is not allowed.");
  rejectSchema((document) => {
    (document.scenario as { difficulty: unknown }).difficulty = true;
  }, "Value has the wrong type.");
  rejectSchema((document) => {
    document.simulationTime.status = "DONE";
  }, "Value is not allowed.");
  rejectSchema((document) => {
    document.emergencyObservations[0]!.category = "NOT_A_CATEGORY";
  }, "Value is not allowed.");
  rejectSchema((document) => {
    document.operationalObservations[0]!.deliveryStatus = "PENDING";
  }, "Value is not allowed.");
  rejectSchema((document) => {
    document.emergencyObservations[0]!.status = "received";
  }, "Value is not allowed.");
  rejectSchema((document) => {
    document.emergencyObservations[0]!.claims = [{
      statement: "A fictional claim",
      stage: "ONGOING",
      assistanceRequested: true,
      value: null,
      confidence: null,
      detailStatus: null,
    }];
  }, "Required property is missing.");
  rejectSchema((document) => {
    document.emergencyObservations[0]!.claims = [{
      code: "water",
      statement: "A fictional claim",
      stage: "ONGOING",
      assistanceRequested: "yes",
      value: null,
      confidence: null,
      detailStatus: null,
    }];
  }, "Value has the wrong type.");
  rejectSchema((document) => {
    document.summary.emergencyObservationCount = 1.5;
  }, "Value has the wrong type.");
  rejectSchema((document) => {
    document.summary.emergencyObservationCount = 1_000_001;
  }, "Number is above the contract maximum.");
  rejectSchema((document) => {
    document.summary.unitCount = -1;
  }, "Number is below the contract minimum.");
  rejectSchema((document) => {
    document.operationalObservations[0]!.content.routeVersion = -1;
  }, "Number is below the contract minimum.");
  rejectSchema((document) => {
    document.operationalObservations[0]!.content.routeVersion = 1.5;
  }, "Value has the wrong type.");
  rejectSchema((document) => {
    document.operationalObservations[0]!.content.routeVersion = 1_000_001;
  }, "Number is above the contract maximum.");
  rejectSchema((document) => {
    document.operationalObservations[0]!.content.fatigue = -0.1;
  }, "Number is below the contract minimum.");
  rejectSchema((document) => {
    document.operationalObservations[0]!.content.fatigue = 100.1;
  }, "Number is above the contract maximum.");
  rejectSchema((document) => {
    document.operationalObservations[0]!.content.inventory = { radio: 10_001 };
  }, "Number is above the contract maximum.");
  rejectSchema((document) => {
    document.operationalObservations[0]!.content.inventory = { radio: -1 };
  }, "Number is below the contract minimum.");
  rejectSchema((document) => {
    document.operationalObservations[0]!.content.inventory = { "": 1 };
  }, "Text is shorter than the contract allows.");
  rejectSchema((document) => {
    document.operationalObservations[0]!.content.inventory = { [("k").repeat(2001)]: 1 };
  }, "Text is longer than the contract allows.");
  rejectSchema((document) => {
    document.replayManifest = manifest({ durationMs: 599_999 });
  }, "Number is below the contract minimum.");
  rejectSchema((document) => {
    document.replayManifest = manifest({ durationMs: 604_800_001 });
  }, "Number is above the contract maximum.");
  rejectSchema((document) => {
    document.replayManifest = manifest({ reportCount: 0 });
  }, "Number is below the contract minimum.");
  rejectSchema((document) => {
    document.replayManifest = manifest({ responderCount: 1_001 });
  }, "Number is above the contract maximum.");
  rejectSchema((document) => {
    document.replayManifest = manifest({ presetVersion: "phase9.v1" });
  }, "Value is not allowed.");

  const missingManifest = minimalDocument() as { replayManifest?: unknown };
  delete missingManifest.replayManifest;
  assert.equal(
    collectSchemaIssues(missingManifest).some((issue) => issue.message === "Required property is missing."),
    true,
  );

  const oversized = minimalDocument();
  oversized.emergencyObservations = Array.from({ length: 100_001 }, () => null) as never;
  assert.equal(collectSchemaIssues(oversized)[0]?.message, "Array exceeds the contract limit.");
});

function rejectSchema(mutate: (document: ReturnType<typeof linkedDocument>) => void, message: string): void {
  const document = linkedDocument();
  mutate(document);
  const messages = collectSchemaIssues(document).map((issue) => issue.message);
  assert.equal(messages.includes(message), true, messages.join(" | ") || "(no schema issues)");
}

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    presetVersion: "phase7b.v1" as string,
    engineVersion: "0.1.0",
    schemaVersion: "resq.simulation.v1",
    scenario: "flood",
    difficulty: "CALM",
    seed: "seed-minimal",
    reportCount: 1,
    responderCount: 1,
    durationMs: 600_000,
    ...overrides,
  };
}

function assertStage(result: ImportResult, stage: string, message: string): void {
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.stage, stage);
    assert.equal(result.issues.some((issue) => issue.message === message), true);
  }
}

function importJson(value: unknown, ledger: ImportLedger): ImportResult {
  return importSimulationText(JSON.stringify(value), ledger);
}

function forbiddenPaths(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => forbiddenPaths(item, `${path}[${index}]`));
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => [
    ...(FORBIDDEN_SIMULATION_KEYS.includes(key as (typeof FORBIDDEN_SIMULATION_KEYS)[number]) ? [`${path}.${key}`] : []),
    ...forbiddenPaths(child, `${path}.${key}`),
  ]);
}

function minimalDocument() {
  return {
    schemaVersion: "resq.simulation.v1" as string,
    engineVersion: "0.1.0" as string,
    runId: "run_minimal",
    scenario: {
      scenarioId: "scenario-minimal",
      seed: "seed-minimal",
      fictional: true,
      label: "Fictional minimal exercise",
      difficulty: null as string | null,
    },
    simulationTime: {
      startTime: START,
      exportTime: EXPORT,
      status: "COMPLETED",
    },
    emergencyObservations: [] as ReturnType<typeof report>[],
    operationalObservations: [] as ReturnType<typeof operation>[],
    units: [] as ReturnType<typeof unit>[],
    assignments: [] as ReturnType<typeof assignment>[],
    replayManifest: null as ReturnType<typeof manifest> | null,
    summary: {
      emergencyObservationCount: 0 as number,
      operationalObservationCount: 0 as number,
      unitCount: 0 as number,
      assignmentCount: 0 as number,
      firstReceivedAt: null as string | null,
      lastReceivedAt: null as string | null,
    },
  };
}

function linkedDocument() {
  const document = minimalDocument();
  document.units.push(unit());
  document.assignments.push(assignment());
  document.emergencyObservations.push(report("rpt_0001", T1));
  document.operationalObservations.push(operation("operation_00000001", T2));
  syncSummary(document);
  return document;
}

function syncSummary(document: ReturnType<typeof minimalDocument>): void {
  const receipts = [
    ...document.emergencyObservations.map((item) => item.receivedAt),
    ...document.operationalObservations.map((item) => item.receivedAt),
  ].sort();
  document.summary.emergencyObservationCount = document.emergencyObservations.length;
  document.summary.operationalObservationCount = document.operationalObservations.length;
  document.summary.unitCount = document.units.length;
  document.summary.assignmentCount = document.assignments.length;
  document.summary.firstReceivedAt = receipts[0] ?? null;
  document.summary.lastReceivedAt = receipts.at(-1) ?? null;
}

function location() {
  return {
    fictional: true,
    coordinateSystem: "SIMULATED_LOCAL_GRID",
    x: 10,
    y: 20,
    district: "Fictional Cedar District" as string | null,
    primaryReference: "Simulated Alder Road",
    secondaryReference: null,
    description: "Fictional reported location",
    precision: "EXACT" as string | null,
  };
}

function report(reportId: string, receivedAt: string) {
  return {
    reportId,
    category: "WATER_RESCUE",
    sourceType: "CIVILIAN_CALLER",
    observedAt: START,
    submittedAt: START,
    receivedAt,
    location: location(),
    narrative: "A fictional caller reports water nearby.",
    claims: [] as unknown[],
    status: "RECEIVED",
    urgency: null,
    sourceMetadata: null,
  };
}

function operation(observationId: string, receivedAt: string) {
  return {
    observationId,
    unitId: "unit_000001",
    assignmentId: "assignment_000001" as string | null,
    messageType: "ASSIGNMENT_ACKNOWLEDGED",
    observedAt: START,
    submittedAt: T1,
    receivedAt,
    source: "RESPONDER_UNIT",
    deliveryStatus: "DELIVERED",
    content: {
      availabilityState: "RESERVED",
      taskStatus: "ASSIGNED",
      travelStatus: null,
      communicationState: null,
      location: null,
      routeVersion: null as number | null,
      fatigue: null as number | null,
      equipmentItem: null,
      equipmentCondition: null,
      inventory: { radio: 1 } as Record<string, number> | null,
    },
  };
}

function unit() {
  return {
    unitId: "unit_000001",
    callsign: "CLI-0001",
    latestObservedAt: START,
    latestReceivedAt: T2,
    availabilityState: "RESERVED",
    assignmentId: "assignment_000001" as string | null,
    taskStatus: "ASSIGNED",
    travelStatus: null,
    communicationState: null,
    location: null,
  };
}

function assignment() {
  return {
    assignmentId: "assignment_000001",
    unitId: "unit_000001",
    firstReceivedAt: T2,
  };
}
