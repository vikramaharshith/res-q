import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  INTEGRATION_DIFFICULTIES,
  SimulationEngine,
  canonicalizeResponderIntegrationState,
  createResponderIntegrationPreset,
  executeResponderIntegrationWorkload,
  runResponderIntegrationWorkload,
  type ResponderIntegrationRun,
} from "../src/index.js";

const runs = new Map<string, ResponderIntegrationRun>();
function workload(name: (typeof INTEGRATION_DIFFICULTIES)[number]): ResponderIntegrationRun {
  const existing = runs.get(name);
  if (existing !== undefined) return existing;
  const result = runResponderIntegrationWorkload(name);
  runs.set(name, result);
  return result;
}

describe("Phase 6F full responder integration", () => {
  it("defines exact deterministic workload sizes and explicitly enables communications and resources", () => {
    const expected = [[10, 100], [50, 1_000], [100, 5_000], [200, 10_000]];
    INTEGRATION_DIFFICULTIES.forEach((name, index) => {
      const preset = createResponderIntegrationPreset(name);
      assert.deepEqual([preset.responderCount, preset.baseReportCount], expected[index]);
      assert.equal(preset.config.initialResponders?.length, preset.responderCount);
      assert.equal(preset.config.communication?.enabled, true);
      assert.equal(preset.config.resources?.enabled, true);
      assert.equal(preset.config.automaticTaskAssignment, false);
    });
  });

  it("runs flood, earthquake, severe-storm, and urban-fire behavior through assignment to recovery", () => {
    const result = workload("CALM");
    const state = result.engine.getState();
    assert.deepEqual(result.invariantViolations, []);
    assert.deepEqual(result.publicAuditViolations, []);
    assert.ok(state.incidents.some((item) => item.incidentType === "URBAN_FLOOD"));
    assert.ok(state.incidents.some((item) => item.incidentType === "EARTHQUAKE_AFTERMATH"));
    assert.ok(state.incidents.some((item) => item.incidentType === "SEVERE_STORM"));
    assert.ok(state.incidents.some((item) => item.incidentType === "URBAN_FIRE"));
    assert.ok(state.tasks.some((item) => item.requiredCapabilities.includes("WATER_RESCUE")));
    assert.ok(state.tasks.some((item) => item.requiredCapabilities.includes("SEARCH_AND_RESCUE")));
    assert.ok(state.tasks.some((item) => item.requiredCapabilities.includes("ELECTRICAL_REPAIR")));
    assert.ok(state.tasks.some((item) => item.requiredCapabilities.includes("FIRE_SUPPRESSION")));
    assert.ok(state.tasks.filter((item) => item.assignedResponderId !== undefined).every((item) => item.assignmentOrigin === "SIMULATION_BASELINE"));
    assert.ok(state.responders.filter((item) => state.tasks.some((task) => task.assignedResponderId === item.id)).every((item) => item.availabilityState === "AVAILABLE"));
  });

  it("reroutes around a closure and keeps physical arrival independent from delayed notification", () => {
    const result = workload("CALM");
    const state = result.engine.getState();
    assert.ok(state.roadNetwork.segments.find((item) => item.id === "road_hub_flood")?.history.some((item) => item.state === "BLOCKED"));
    assert.ok(state.travels.some((item) => item.rerouteCount > 0));
    const arrivals = new Map(state.travels.filter((item) => item.arrivedAtMs !== undefined).map((item) => [item.responderId, item.arrivedAtMs!]));
    assert.ok(result.engine.getPublicOperationalObservations().some((item) => item.messageType === "ARRIVAL_REPORTED" && item.receivedAtMs > (arrivals.get(item.responderId) ?? item.receivedAtMs)));
    assert.ok(result.metrics.communicationMessagesDelayed > 0);
    assert.ok(result.metrics.communicationMessagesFailed > 0);
  });

  it("conserves resources, consumes once, records shortages, and recovers responders", () => {
    const result = workload("CALM");
    const state = result.engine.getState();
    assert.ok(state.taskResources.some((item) => item.status === "CONSUMED"));
    assert.ok(state.taskResources.every((item) => item.eventHistoryIds.length <= 2));
    assert.ok(state.responderResources.every((item) => Object.values(item.inventory).every((quantity) => quantity >= 0)));
    assert.ok(state.replenishments.some((item) => item.status === "COMPLETED"));
    assert.ok(state.replenishments.some((item) => item.status === "FAILED"));
    assert.ok(result.metrics.resourceShortages > 0);
    assert.ok(state.eventHistory.some((item) => item.event.type === "RECOVERY_COMPLETE"));
  });

  it("keeps causal references ordered and public snapshots recursively isolated and immutable", () => {
    const result = workload("CALM");
    const state = result.engine.getState();
    const seen = new Set<string>();
    for (const record of state.eventHistory) {
      if (record.event.causeEventId !== undefined) assert.ok(seen.has(record.event.causeEventId));
      seen.add(record.event.id);
    }
    const emergency = result.engine.getPublicObservations();
    const operational = result.engine.getPublicOperationalObservations();
    assert.throws(() => (emergency as unknown as unknown[]).push({}), TypeError);
    assert.throws(() => (operational as unknown as unknown[]).push({}), TypeError);
    assert.equal(JSON.stringify(emergency).includes("internalIncidentId"), false);
    assert.equal(JSON.stringify(operational).includes("failureReason"), false);
  });

  it("resets and repeats a complete workload exactly", () => {
    const preset = createResponderIntegrationPreset("CALM");
    const engine = new SimulationEngine(preset.config);
    executeResponderIntegrationWorkload(engine, preset);
    const first = canonicalizeResponderIntegrationState(engine);
    engine.reset();
    executeResponderIntegrationWorkload(engine, preset);
    assert.equal(canonicalizeResponderIntegrationState(engine), first);
  });
});

describe("Phase 6F exact stress workloads and deterministic replay", () => {
  for (const difficulty of INTEGRATION_DIFFICULTIES) {
    it(`${difficulty} processes its exact base workload with real responder activity and replays identically`, () => {
      const first = workload(difficulty);
      const replay = runResponderIntegrationWorkload(difficulty);
      assert.equal(replay.canonicalState, first.canonicalState);
      assert.deepEqual(first.invariantViolations, []);
      assert.deepEqual(first.publicAuditViolations, []);
      assert.equal(first.metrics.baseReportCount, createResponderIntegrationPreset(difficulty).baseReportCount);
      assert.equal(first.metrics.responderCount, createResponderIntegrationPreset(difficulty).responderCount);
      assert.ok(first.metrics.assignedTasks > 0);
      assert.ok(first.metrics.completedTasks > 0);
      assert.ok(first.metrics.totalProcessedEvents > first.metrics.baseReportCount);
      assert.ok(first.metrics.peakEventQueueSize >= first.metrics.baseReportCount);
      assert.ok(first.metrics.cascadingEvents > 0);
    });
  }
});
