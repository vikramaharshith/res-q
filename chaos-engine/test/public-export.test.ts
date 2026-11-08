import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  CHAOS_ENGINE_VERSION,
  COMMUNICATION_STATES,
  OPERATIONAL_MESSAGE_TYPES,
  PUBLIC_SIMULATION_SCHEMA_VERSION,
  PublicSimulationExportError,
  REPORT_CATEGORIES,
  REPORT_SOURCE_TYPES,
  RESPONDER_AVAILABILITY_STATES,
  SimulationEngine,
  TASK_STATUSES,
  TRAVEL_STATUSES,
  createPublicSimulationExport,
  serializePublicSimulationExport,
  validatePublicSimulationExport,
  writePublicSimulationExport,
  type InitialResponderDefinition,
  type PublicSimulationExport,
  type SimulationConfig,
} from "../src/index.js";

const START = 10_000;
const grid = (x: number, y: number, label = "Fictional export location") => ({ fictional: true as const, coordinateSystem: "SIMULATED_LOCAL_GRID" as const, x, y, label });

function reportEngine(count = 3, future = false): SimulationEngine {
  const engine = new SimulationEngine({
    scenarioId: "phase-7a-export",
    seed: "phase-7a-seed",
    startTimeMs: START,
    maxDurationMs: 1_000_000,
    maxEventCount: count + 20,
    initialIncidents: [{ incidentType: "FICTIONAL_FLOOD", location: { latitude: 1, longitude: 2, label: "Fictional Export Ward" }, severity: 4 }],
  });
  engine.start(); engine.runUntilEmpty();
  engine.scheduleReports({ reportCount: count, ...(future ? { startTimeMs: START + 100_000 } : {}), frequencyMs: 0, categories: ["WATER_RESCUE"] });
  engine.start();
  if (future) engine.advanceUntil(START + 1_000); else engine.runUntilEmpty();
  return engine;
}

function responder(): InitialResponderDefinition {
  return { id: "rsp_custom_export", callsign: "EXPORT-1", responderType: "SUPPLY_DELIVERY", capabilities: ["LOGISTICS"], location: grid(0, 0), crewCapacity: 2, equipmentInventory: { kit: 2 } };
}

function operationalEngine(): SimulationEngine {
  const config: SimulationConfig = {
    scenarioId: "phase-7a-operational",
    seed: "phase-7a-operational-seed",
    startTimeMs: START,
    maxDurationMs: 200_000,
    maxEventCount: 10_000,
    initialIncidents: [{ incidentType: "FICTIONAL_SUPPLY", location: { latitude: 0, longitude: 20 }, severity: 2 }],
    initialResponders: [responder()],
    roadNetwork: {
      nodes: [{ id: "node_a", location: grid(0, 0, "A") }, { id: "node_b", location: grid(20, 0, "B") }],
      segments: [{ id: "road_ab", fromNodeId: "node_a", toNodeId: "node_b", distanceUnits: 20, speedUnitsPerSecond: 10 }],
    },
    communication: { enabled: true, normalDelayMs: 1, retryIntervalMs: 100, maxRetriesPerMessage: 10, maxDeliveryDelayMs: 100_000 },
  };
  const engine = new SimulationEngine(config);
  engine.start(); engine.runUntilEmpty();
  const incidentId = engine.getState().incidents[0]!.id;
  engine.createTask({ relatedIncidentId: incidentId, requiredCapabilities: ["LOGISTICS"], requiredEquipment: { kit: 1 }, requiredCrewCapacity: 1, priority: "HIGH", estimatedEffortMs: 1_000 });
  engine.start(); engine.runUntilEmpty();
  const taskId = engine.getTasks()[0]!.id; const responderId = engine.getResponders()[0]!.id;
  engine.assignTask(taskId, responderId); engine.start(); engine.runUntilEmpty();
  const now = engine.getState().currentTimeMs;
  engine.departResponder(taskId, now, { responderSpeedUnitsPerSecond: 10, progressIntervalMs: 500 });
  engine.scheduleCommunicationStateChange(responderId, "OFFLINE", now, -20);
  engine.scheduleCommunicationStateChange(responderId, "RECOVERING", now + 5_000);
  engine.scheduleCommunicationStateChange(responderId, "CONNECTED", now + 5_001);
  engine.start(); engine.advanceUntil(now + 2_000);
  return engine;
}

function clone(document: PublicSimulationExport): Record<string, unknown> {
  return structuredClone(document) as unknown as Record<string, unknown>;
}

describe("Phase 7A public export contract and privacy", () => {
  it("creates a valid versioned fictional export with required deterministic metadata", () => {
    const engine = reportEngine(); const before = JSON.stringify(engine.getState());
    const document = createPublicSimulationExport(engine, { difficulty: "CALM", scenarioLabel: "Fictional Phase 7A exercise" });
    assert.equal(document.schemaVersion, PUBLIC_SIMULATION_SCHEMA_VERSION);
    assert.equal(document.runId, engine.runId);
    assert.equal(document.scenario.seed, engine.config.seed);
    assert.equal(document.scenario.fictional, true);
    assert.equal(document.scenario.difficulty, "CALM");
    assert.equal(validatePublicSimulationExport(document).valid, true);
    assert.equal(JSON.stringify(engine.getState()), before);
  });

  it("projects emergency reports in stable receipt order while preserving duplicates and contradictions", () => {
    const engine = new SimulationEngine({ scenarioId: "phase-7a-noise", seed: "noise", startTimeMs: START, maxEventCount: 100, initialIncidents: [{ incidentType: "FLOOD", location: { latitude: 0, longitude: 0 }, severity: 3 }] });
    engine.start(); engine.runUntilEmpty();
    engine.scheduleReports({ reportCount: 3, frequencyMs: 0, categories: ["WATER_RESCUE"], noise: { probabilityOverrides: { duplicate: true, contradiction: true }, maxDuplicatesPerOriginal: 1, minAdditionalDelayMs: 0, maxAdditionalDelayMs: 10, maxFinalReportCount: 6 } });
    engine.start(); engine.runUntilEmpty();
    const document = createPublicSimulationExport(engine);
    assert.equal(document.emergencyObservations.length, engine.getPublicObservations().length);
    assert.ok(document.emergencyObservations.length > 3);
    for (let index = 1; index < document.emergencyObservations.length; index += 1) assert.ok(document.emergencyObservations[index - 1]!.receivedAt <= document.emergencyObservations[index]!.receivedAt);
    assert.equal(new Set(document.emergencyObservations.map((item) => item.reportId)).size, document.emergencyObservations.length);
  });

  it("excludes unreceived reports and rejects unsupported historical or future exports", () => {
    const engine = reportEngine(3, true);
    assert.equal(createPublicSimulationExport(engine).emergencyObservations.length, 0);
    const current = engine.getState().currentTimeMs;
    assert.throws(() => createPublicSimulationExport(engine, { exportTimeMs: current - 1 }), /Historical exports are unsupported/);
    assert.throws(() => createPublicSimulationExport(engine, { exportTimeMs: current + 1 }), /cannot be later/);
  });

  it("exports delivered command knowledge rather than uncommunicated physical responder state", () => {
    const engine = operationalEngine();
    assert.equal(engine.getResponders()[0]!.availabilityState, "ON_SCENE");
    assert.ok(engine.getHiddenOperationalMessages().some((item) => item.deliveryStatus === "PENDING"));
    const document = createPublicSimulationExport(engine);
    assert.ok(document.operationalObservations.every((item) => item.deliveryStatus === "DELIVERED"));
    assert.ok(document.units.length > 0);
    assert.notEqual(document.units[0]!.availabilityState, "ON_SCENE");
    assert.ok(!document.operationalObservations.some((item) => item.messageType === "ARRIVAL_REPORTED"));
  });

  it("passes a recursive hidden-ground-truth audit and uses only public unit and assignment IDs", () => {
    const document = createPublicSimulationExport(operationalEngine());
    const serialized = serializePublicSimulationExport(document);
    for (const forbidden of ["internalIncidentId", "relatedIncidentId", "responderId", "relatedTaskId", "messageId", "severity", "environment", "infrastructure", "cascadeDepth", "duplicateFamilyId", "contradictionOfReportId", "sourceQuality", "failureReason", "attemptCount"]) assert.equal(serialized.includes(`\"${forbidden}\"`), false);
    assert.ok(document.units.every((item) => item.unitId.startsWith("unit_")));
    assert.ok(document.assignments.every((item) => item.assignmentId.startsWith("assignment_")));
  });

  it("serializes byte-identically with canonical object ordering and canonical UTC timestamps", () => {
    const document = createPublicSimulationExport(reportEngine());
    const reversed = Object.fromEntries(Object.entries(structuredClone(document)).reverse());
    const first = serializePublicSimulationExport(document); const second = serializePublicSimulationExport(reversed);
    assert.equal(first, second);
    assert.ok(first.endsWith("\n"));
    assert.match(document.simulationTime.exportTime, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(first.includes("undefined"), false);
  });

  it("replays an identical export after reset", () => {
    const engine = reportEngine(10); const first = serializePublicSimulationExport(createPublicSimulationExport(engine));
    engine.reset(); engine.start(); engine.runUntilEmpty(); engine.scheduleReports({ reportCount: 10, frequencyMs: 0, categories: ["WATER_RESCUE"] }); engine.start(); engine.runUntilEmpty();
    assert.equal(serializePublicSimulationExport(createPublicSimulationExport(engine)), first);
  });

  it("ships a schema synchronized to the complete TypeScript contract", async () => {
    const raw = await readFile(new URL("../src/export/public-simulation-export-v1.schema.json", import.meta.url), "utf8");
    const schema = JSON.parse(raw) as {
      properties: { schemaVersion: { const: string }; engineVersion: { const: string } };
      required: string[];
      $defs: Record<string, { additionalProperties?: boolean; required?: string[]; properties?: Record<string, { enum?: unknown[] }>; enum?: unknown[] }>;
    };
    assert.equal(schema.properties.schemaVersion.const, PUBLIC_SIMULATION_SCHEMA_VERSION);
    assert.equal(schema.properties.engineVersion.const, CHAOS_ENGINE_VERSION);
    for (const key of ["schemaVersion", "engineVersion", "runId", "scenario", "simulationTime", "emergencyObservations", "operationalObservations", "units", "assignments", "replayManifest", "summary"]) assert.ok(schema.required.includes(key));
    assert.deepEqual(schema.$defs.emergencyObservation!.properties!.category!.enum, REPORT_CATEGORIES);
    assert.deepEqual(schema.$defs.emergencyObservation!.properties!.sourceType!.enum, REPORT_SOURCE_TYPES);
    assert.deepEqual(schema.$defs.operationalObservation!.properties!.messageType!.enum, OPERATIONAL_MESSAGE_TYPES);
    assert.deepEqual(schema.$defs.nullableAvailabilityState!.enum, [...RESPONDER_AVAILABILITY_STATES, null]);
    assert.deepEqual(schema.$defs.nullableTaskStatus!.enum, [...TASK_STATUSES, null]);
    assert.deepEqual(schema.$defs.nullableTravelStatus!.enum, [...TRAVEL_STATUSES, null]);
    assert.deepEqual(schema.$defs.nullableCommunicationState!.enum, [...COMMUNICATION_STATES, null]);
    for (const definition of ["sourceMetadata", "operationalContent"]) {
      assert.equal(schema.$defs[definition]!.additionalProperties, false);
      assert.ok((schema.$defs[definition]!.required?.length ?? 0) > 0);
    }
  });
});

describe("Phase 7A validation", () => {
  it("rejects versions, duplicate IDs, broken references, future data, coordinates, summaries, and non-finite numbers", () => {
    const base = createPublicSimulationExport(reportEngine());
    const cases: Array<(value: Record<string, unknown>) => void> = [
      (value) => { value.schemaVersion = "resq.simulation.v999"; },
      (value) => { const reports = value.emergencyObservations as Array<Record<string, unknown>>; reports.push(structuredClone(reports[0]!)); },
      (value) => { (value.summary as Record<string, unknown>).emergencyObservationCount = 999; },
      (value) => { ((value.emergencyObservations as Array<Record<string, unknown>>)[0]!.location as Record<string, unknown>).x = 2_000_000; },
      (value) => { ((value.emergencyObservations as Array<Record<string, unknown>>)[0]!.location as Record<string, unknown>).y = Number.NaN; },
      (value) => { (value.emergencyObservations as Array<Record<string, unknown>>)[0]!.receivedAt = "9999-12-31T23:59:59.999Z"; },
    ];
    for (const mutate of cases) { const value = clone(base); mutate(value); assert.equal(validatePublicSimulationExport(value).valid, false); assert.throws(() => serializePublicSimulationExport(value), PublicSimulationExportError); }

    const operational = clone(createPublicSimulationExport(operationalEngine()));
    (operational.operationalObservations as Array<Record<string, unknown>>)[0]!.unitId = "unit_missing";
    assert.equal(validatePublicSimulationExport(operational).valid, false);
  });

  it("rejects incompatible engine metadata and unreplayable manifests", () => {
    const base = createPublicSimulationExport(reportEngine());
    const engineVersion = clone(base); engineVersion.engineVersion = "999.0.0";
    assert.equal(validatePublicSimulationExport(engineVersion).valid, false);

    const label = clone(base); (label.scenario as Record<string, unknown>).label = "x".repeat(257);
    assert.equal(validatePublicSimulationExport(label).valid, false);

    const replayable = clone(base);
    replayable.replayManifest = {
      presetVersion: "phase7b.v1", engineVersion: CHAOS_ENGINE_VERSION, schemaVersion: PUBLIC_SIMULATION_SCHEMA_VERSION,
      scenario: "flood", difficulty: "CALM", seed: "phase-8", reportCount: 1, responderCount: 1, durationMs: 599_999,
    };
    assert.equal(validatePublicSimulationExport(replayable).valid, false);
  });

  it("rejects unexpected and recursively nested private fields", () => {
    const document = clone(createPublicSimulationExport(reportEngine()));
    const report = (document.emergencyObservations as Array<Record<string, unknown>>)[0]!;
    (report.location as Record<string, unknown>).privateEvaluation = { sourceQuality: { reliabilityScore: 0.9 } };
    const result = validatePublicSimulationExport(document);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((item) => item.path.includes("privateEvaluation") || item.path.includes("sourceQuality")));
  });
});

describe("Phase 7A safe file writing", () => {
  it("writes UTF-8 safely, refuses overwrite, supports explicit overwrite, and rejects traversal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chaos-export-"));
    try {
      const document = createPublicSimulationExport(reportEngine());
      const path = await writePublicSimulationExport(document, { destinationDirectory: directory, filename: "safe-export.json" });
      assert.equal(await readFile(path, "utf8"), serializePublicSimulationExport(document));
      await assert.rejects(writePublicSimulationExport(document, { destinationDirectory: directory, filename: "safe-export.json" }), /already exists/);
      const replacement = clone(document); (replacement.scenario as Record<string, unknown>).label = "Fictional replacement";
      await writePublicSimulationExport(replacement, { destinationDirectory: directory, filename: "safe-export.json", overwrite: true });
      assert.equal(JSON.parse(await readFile(path, "utf8")).scenario.label, "Fictional replacement");
      await assert.rejects(writePublicSimulationExport(document, { destinationDirectory: directory, filename: "../escape.json" }), /safe local/);
      await assert.rejects(writePublicSimulationExport(document, { destinationDirectory: join(directory, "missing") }), /not accessible/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

describe("Phase 7A export scale", () => {
  for (const count of [1_000, 5_000, 10_000]) {
    it(`exports and validates ${count.toLocaleString("en-US")} received reports`, () => {
      const engine = reportEngine(count); const document = createPublicSimulationExport(engine); const serialized = serializePublicSimulationExport(document);
      assert.equal(document.emergencyObservations.length, count);
      assert.equal(validatePublicSimulationExport(document).valid, true);
      assert.equal(JSON.parse(serialized).summary.emergencyObservationCount, count);
    });
  }
});
