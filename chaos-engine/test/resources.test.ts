import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EQUIPMENT_CONDITIONS,
  SimulationConfigError,
  SimulationEngine,
  SimulationEventError,
  SimulationLimitError,
  validateResourceConfig,
  type InitialResponderDefinition,
  type SimulationConfig,
  type TaskDefinition,
} from "../src/index.js";

const START = 300_000;
const TRAVEL_MS = 360_000;
const WORK_MS = 360_000;
const RECOVERY_MS = 360_000;
const location = (x: number, y: number, label = "Fictional resource location") => ({ fictional: true as const, coordinateSystem: "SIMULATED_LOCAL_GRID" as const, x, y, label });

function unit(overrides: Partial<InitialResponderDefinition> = {}): InitialResponderDefinition {
  return {
    id: "rsp_custom_resource",
    callsign: "SUPPLY-601",
    responderType: "SUPPLY_DELIVERY",
    capabilities: ["LOGISTICS"],
    location: location(0, 0, "Fictional resource base"),
    crewCapacity: 3,
    equipmentInventory: { kit: 5, radio: 1, fuel: 10 },
    ...overrides,
  };
}

function resourceConfig() {
  return {
    enabled: true,
    travelFatiguePerHour: 100,
    workFatiguePerHour: 200,
    inactiveRecoveryPerHour: 0,
    recoveryReductionPerHour: 200,
    assignmentFatigueThreshold: 80,
    recoveryCompletionThreshold: 40,
    recoveryDurationMs: RECOVERY_MS,
    resourceDefinitions: {
      kit: { category: "EMERGENCY_SUPPLY" as const, consumable: true },
      radio: { category: "REUSABLE_EQUIPMENT" as const, consumable: false, essential: true },
      fuel: { category: "FUEL_ENERGY" as const, consumable: true },
    },
    initialStockpiles: [{ id: "stockpile_main", location: location(0, 0, "Fictional stockpile"), inventory: { kit: 20, fuel: 50 } }],
    defaultReplenishmentDelayMs: 1_000,
    maxReplenishmentDelayMs: 10_000,
  };
}

function config(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return {
    scenarioId: "phase-6e-resources",
    seed: "resource-seed",
    startTimeMs: START,
    maxDurationMs: 20_000_000,
    maxEventCount: 20_000,
    initialIncidents: [{ incidentType: "FICTIONAL_SUPPLY_OPERATION", location: { latitude: 0, longitude: 20 }, severity: 3 }],
    initialResponders: [unit()],
    roadNetwork: {
      nodes: [{ id: "node_a", location: location(0, 0, "Fictional A") }, { id: "node_b", location: location(20, 0, "Fictional B") }],
      segments: [{ id: "road_ab", fromNodeId: "node_a", toNodeId: "node_b", distanceUnits: 3_600, speedUnitsPerSecond: 10 }],
    },
    resources: resourceConfig(),
    ...overrides,
  };
}

function task(incidentId: string, overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return { relatedIncidentId: incidentId, requiredCapabilities: ["LOGISTICS"], requiredEquipment: { kit: 2, radio: 1 }, requiredCrewCapacity: 1, priority: "HIGH", estimatedEffortMs: WORK_MS, ...overrides };
}

function drain(engine: SimulationEngine): void { engine.start(); engine.runUntilEmpty(); }

function assigned(overrides: Partial<SimulationConfig> = {}) {
  const engine = new SimulationEngine(config(overrides));
  const incidentId = engine.getState().incidents[0]!.id;
  engine.createTask(task(incidentId));
  drain(engine);
  const taskId = engine.getTasks()[0]!.id;
  const responderId = engine.getResponders()[0]!.id;
  engine.assignTask(taskId, responderId);
  drain(engine);
  return { engine, incidentId, taskId, responderId };
}

function arrive(setup: ReturnType<typeof assigned>) {
  const departedAt = setup.engine.getState().currentTimeMs;
  setup.engine.departResponder(setup.taskId, departedAt, { responderSpeedUnitsPerSecond: 10, progressIntervalMs: 60_000 });
  drain(setup.engine);
  assert.equal(setup.engine.getTravel(setup.engine.getTravels()[0]!.id)?.status, "ARRIVED");
  return { departedAt, arrivedAt: setup.engine.getState().currentTimeMs };
}

describe("Phase 6E fatigue and task resources", () => {
  it("validates fatigue, recovery, resource, and stockpile bounds", () => {
    assert.deepEqual(EQUIPMENT_CONDITIONS, ["OPERATIONAL", "DEGRADED", "UNAVAILABLE", "UNDER_REPAIR"]);
    assert.throws(() => validateResourceConfig({ enabled: true, initialFatigue: -1 }), SimulationConfigError);
    assert.throws(() => validateResourceConfig({ enabled: true, travelFatiguePerHour: 2_000 }), SimulationConfigError);
    assert.throws(() => validateResourceConfig({ enabled: true, initialStockpiles: [{ id: "bad", location: location(0, 0), inventory: {} }] }), SimulationConfigError);
  });

  it("accumulates travel fatigue deterministically without double-counting elapsed time", () => {
    const setup = assigned();
    arrive(setup);
    const state = setup.engine.getResponderResourceState(setup.responderId)!;
    assert.ok(Math.abs(state.fatigue - 10) < 0.001);
    const at = setup.engine.getState().currentTimeMs;
    setup.engine.scheduleFatigueUpdate(setup.responderId, at);
    setup.engine.scheduleFatigueUpdate(setup.responderId, at);
    drain(setup.engine);
    assert.ok(Math.abs((setup.engine.getResponderResourceState(setup.responderId)?.fatigue ?? 0) - 10) < 0.001);
  });

  it("bounds fatigue and applies explicitly configured inactive rest", () => {
    const engine = new SimulationEngine(config({ resources: { ...resourceConfig(), initialFatigue: 100, inactiveRecoveryPerHour: 10 } }));
    const responderId = engine.getResponders()[0]!.id;
    assert.equal(engine.getResponderResourceState(responderId)?.fatigue, 100);
    engine.scheduleFatigueUpdate(responderId, START + 3_600_000);
    drain(engine);
    assert.equal(engine.getResponderResourceState(responderId)?.fatigue, 90);
  });

  it("consumes configured supplies once when work starts and preserves reusable equipment", () => {
    const setup = assigned();
    arrive(setup);
    setup.engine.scheduleTaskStateTransition(setup.taskId, "IN_PROGRESS", setup.engine.getState().currentTimeMs);
    drain(setup.engine);
    const resource = setup.engine.getResponderResourceState(setup.responderId)!;
    assert.equal(resource.inventory.kit, 3);
    assert.equal(resource.inventory.radio, 1);
    assert.equal(setup.engine.getTaskResourceState(setup.taskId)?.status, "CONSUMED");
    assert.equal(resource.history.filter((entry) => entry.action === "RESOURCE_CONSUMED").length, 1);
  });

  it("accumulates bounded work fatigue and then reduces it during recovery", () => {
    const setup = assigned();
    arrive(setup);
    setup.engine.scheduleTaskStateTransition(setup.taskId, "IN_PROGRESS", setup.engine.getState().currentTimeMs);
    drain(setup.engine);
    const startedAt = setup.engine.getState().currentTimeMs;
    setup.engine.scheduleTaskStateTransition(setup.taskId, "COMPLETED", startedAt + WORK_MS);
    drain(setup.engine);
    const resource = setup.engine.getResponderResourceState(setup.responderId)!;
    assert.ok(Math.abs(resource.fatigue - 10) < 0.001);
    assert.ok(resource.history.some((entry) => Math.abs(entry.fatigue - 30) < 0.001));
    assert.equal(setup.engine.getResponder(setup.responderId)?.availabilityState, "AVAILABLE");
    assert.equal(setup.engine.getIncident(setup.incidentId)?.status, "DETECTED");
  });

  it("rejects exhausted responders and insufficient consumable inventories", () => {
    const tired = new SimulationEngine(config({ resources: { ...resourceConfig(), initialFatigue: 80 } }));
    const tiredIncident = tired.getState().incidents[0]!.id;
    tired.createTask(task(tiredIncident));
    drain(tired);
    assert.throws(() => tired.assignTask(tired.getTasks()[0]!.id, tired.getResponders()[0]!.id), /fatigue or equipment/);

    const automatic = new SimulationEngine(config({ automaticTaskAssignment: true, resources: { ...resourceConfig(), initialFatigue: 80 } }));
    automatic.createTask(task(automatic.getState().incidents[0]!.id));
    drain(automatic);
    assert.equal(automatic.getTasks()[0]?.status, "PENDING");

    const short = new SimulationEngine(config({ initialResponders: [unit({ equipmentInventory: { kit: 1, radio: 1, fuel: 10 } })] }));
    const shortIncident = short.getState().incidents[0]!.id;
    short.createTask(task(shortIncident));
    drain(short);
    assert.throws(() => short.assignTask(short.getTasks()[0]!.id, short.getResponders()[0]!.id), /not eligible/);
  });

  it("releases unused reservations but never refunds consumed supplies", () => {
    const unused = assigned();
    unused.engine.scheduleTaskStateTransition(unused.taskId, "FAILED", unused.engine.getState().currentTimeMs);
    drain(unused.engine);
    assert.equal(unused.engine.getTaskResourceState(unused.taskId)?.status, "RELEASED");
    assert.equal(unused.engine.getResponderResourceState(unused.responderId)?.inventory.kit, 5);

    const consumed = assigned();
    arrive(consumed);
    consumed.engine.scheduleTaskStateTransition(consumed.taskId, "IN_PROGRESS", consumed.engine.getState().currentTimeMs);
    drain(consumed.engine);
    consumed.engine.scheduleTaskStateTransition(consumed.taskId, "FAILED", consumed.engine.getState().currentTimeMs);
    drain(consumed.engine);
    assert.equal(consumed.engine.getTaskResourceState(consumed.taskId)?.status, "CONSUMED");
    assert.equal(consumed.engine.getResponderResourceState(consumed.responderId)?.inventory.kit, 3);
  });
});

describe("Phase 6E equipment and recovery lifecycle", () => {
  it("degrades, fails, repairs, and restores equipment eligibility through events", () => {
    const engine = new SimulationEngine(config());
    const responderId = engine.getResponders()[0]!.id;
    engine.scheduleEquipmentFailure(responderId, "radio", "DEGRADED", "fictional inspection finding");
    drain(engine);
    assert.equal(engine.getResponderResourceState(responderId)?.equipmentConditions.radio, "DEGRADED");
    engine.scheduleEquipmentFailure(responderId, "radio", "UNAVAILABLE", "fictional component failure");
    drain(engine);
    assert.equal(engine.getResponderResourceState(responderId)?.equipmentConditions.radio, "UNAVAILABLE");
    engine.createTask(task(engine.getState().incidents[0]!.id));
    drain(engine);
    const taskId = engine.getTasks()[0]!.id;
    assert.deepEqual(engine.getEligibleRespondersForTask(taskId), []);
    engine.scheduleEquipmentRepair(responderId, "radio", "UNDER_REPAIR");
    drain(engine);
    engine.scheduleEquipmentRepair(responderId, "radio", "OPERATIONAL");
    drain(engine);
    assert.equal(engine.getResponderResourceState(responderId)?.equipmentConditions.radio, "OPERATIONAL");
    assert.equal(engine.getEligibleRespondersForTask(taskId).length, 1);
  });

  it("blocks task execution when required equipment fails after reservation", () => {
    const setup = assigned();
    arrive(setup);
    setup.engine.scheduleEquipmentFailure(setup.responderId, "radio", "UNAVAILABLE", "fictional impact");
    drain(setup.engine);
    const beforeTask = setup.engine.getTask(setup.taskId);
    const beforeInventory = setup.engine.getResponderResourceState(setup.responderId)?.inventory;
    setup.engine.scheduleTaskStateTransition(setup.taskId, "IN_PROGRESS", setup.engine.getState().currentTimeMs);
    setup.engine.start();
    assert.throws(() => setup.engine.runUntilEmpty(), SimulationEventError);
    assert.deepEqual(setup.engine.getTask(setup.taskId), beforeTask);
    assert.deepEqual(setup.engine.getResponderResourceState(setup.responderId)?.inventory, beforeInventory);
  });

  it("releases completed, failed, and cancelled responders through one recovery chain", () => {
    for (const terminal of ["FAILED", "CANCELLED"] as const) {
      const setup = assigned({ seed: `terminal-${terminal}` });
      setup.engine.scheduleTaskStateTransition(setup.taskId, terminal, setup.engine.getState().currentTimeMs);
      drain(setup.engine);
      assert.equal(setup.engine.getResponder(setup.responderId)?.availabilityState, "AVAILABLE");
      assert.equal(setup.engine.getResponder(setup.responderId)?.stateHistory.filter((entry) => entry.state === "RECOVERING").length, 1);
    }
  });

  it("cancels travel safely, prevents assignment during recovery, and completes recovery", () => {
    const setup = assigned();
    const now = setup.engine.getState().currentTimeMs;
    setup.engine.departResponder(setup.taskId, now, { responderSpeedUnitsPerSecond: 10, progressIntervalMs: 60_000 });
    setup.engine.scheduleTaskStateTransition(setup.taskId, "CANCELLED", now + 1);
    setup.engine.start();
    setup.engine.advanceUntil(now + 2);
    assert.equal(setup.engine.getTravels()[0]?.status, "CANCELLED");
    assert.equal(setup.engine.getResponder(setup.responderId)?.availabilityState, "RECOVERING");
    const other = setup.engine.createTask(task(setup.incidentId), now + 2);
    setup.engine.start();
    setup.engine.processNextEvent();
    setup.engine.pause();
    assert.throws(() => setup.engine.assignTask(other.relatedTaskId!, setup.responderId, now + 2), /not eligible/);
    setup.engine.start();
    setup.engine.runUntilEmpty();
    assert.equal(setup.engine.getResponder(setup.responderId)?.availabilityState, "AVAILABLE");
  });

  it("keeps responders offline after recovery when essential equipment is unavailable", () => {
    const setup = assigned();
    setup.engine.scheduleEquipmentFailure(setup.responderId, "radio", "UNAVAILABLE", "fictional failure");
    drain(setup.engine);
    setup.engine.scheduleTaskStateTransition(setup.taskId, "FAILED", setup.engine.getState().currentTimeMs);
    drain(setup.engine);
    assert.equal(setup.engine.getResponder(setup.responderId)?.availabilityState, "OFFLINE");
  });

  it("rejects invalid recovery starts and returns deeply immutable resource snapshots", () => {
    const setup = assigned();
    assert.throws(() => setup.engine.scheduleEvent({ type: "RECOVERY_START", scheduledTimeMs: setup.engine.getState().currentTimeMs, relatedTaskId: setup.taskId, relatedResponderId: setup.responderId, payload: {} }), /not ready|prerequisites/);
    const snapshot = setup.engine.getResponderResourceState(setup.responderId)!;
    assert.throws(() => (snapshot.history as unknown as Array<unknown>).push({}), TypeError);
    assert.throws(() => (snapshot.inventory as Record<string, number>).kit = 0, TypeError);
  });
});

describe("Phase 6E stockpiles, communication, and determinism", () => {
  it("registers bounded immutable stockpiles", () => {
    const engine = new SimulationEngine(config());
    const stockpile = engine.getStockpiles()[0]!;
    assert.equal(stockpile.id, "stockpile_main");
    assert.throws(() => (stockpile.inventory as Record<string, number>).kit = 99, TypeError);
    assert.throws(() => new SimulationEngine(config({ resources: { ...resourceConfig(), initialStockpiles: [{ id: "stockpile_main", location: location(0, 0), inventory: { kit: 1_000_001 } }] } })), SimulationConfigError);
  });

  it("transfers supplies after the configured delay and conserves total inventory", () => {
    const engine = new SimulationEngine(config());
    const responderId = engine.getResponders()[0]!.id;
    const beforeTotal = engine.getStockpiles()[0]!.inventory.kit! + engine.getResponderResourceState(responderId)!.inventory.kit!;
    const request = engine.requestReplenishment("stockpile_main", responderId, { kit: 3 });
    engine.start();
    engine.advanceUntil(request.scheduledTimeMs);
    assert.equal(engine.getReplenishments()[0]?.status, "PENDING");
    assert.equal(engine.getResponderResourceState(responderId)?.inventory.kit, 5);
    engine.runUntilEmpty();
    assert.equal(engine.getResponderResourceState(responderId)?.inventory.kit, 8);
    assert.equal(engine.getStockpiles()[0]?.inventory.kit, 17);
    assert.equal(engine.getStockpiles()[0]!.inventory.kit! + engine.getResponderResourceState(responderId)!.inventory.kit!, beforeTotal);
  });

  it("records failed replenishment without changing either inventory", () => {
    const engine = new SimulationEngine(config());
    const responderId = engine.getResponders()[0]!.id;
    const before = JSON.stringify({ stock: engine.getStockpiles(), responder: engine.getResponderResourceState(responderId) });
    engine.requestReplenishment("stockpile_main", responderId, { kit: 21 });
    drain(engine);
    assert.equal(engine.getReplenishments()[0]?.status, "FAILED");
    assert.equal(engine.getReplenishments()[0]?.failureReason, "INSUFFICIENT_STOCK");
    const after = JSON.stringify({ stock: engine.getStockpiles(), responder: engine.getResponderResourceState(responderId) });
    assert.equal(after, before);
  });

  it("allows physical recovery during an outage while delivered knowledge remains delayed", () => {
    const setup = assigned({ communication: { enabled: true, normalDelayMs: 10, retryIntervalMs: 50_000, maxRetriesPerMessage: 10 } });
    arrive(setup);
    setup.engine.scheduleTaskStateTransition(setup.taskId, "IN_PROGRESS", setup.engine.getState().currentTimeMs);
    drain(setup.engine);
    const terminalAt = setup.engine.getState().currentTimeMs + WORK_MS;
    setup.engine.scheduleCommunicationStateChange(setup.responderId, "OFFLINE", terminalAt - 1);
    setup.engine.scheduleTaskStateTransition(setup.taskId, "COMPLETED", terminalAt);
    setup.engine.scheduleCommunicationStateChange(setup.responderId, "RECOVERING", terminalAt + RECOVERY_MS + 1);
    setup.engine.scheduleCommunicationStateChange(setup.responderId, "CONNECTED", terminalAt + RECOVERY_MS + 2);
    setup.engine.start();
    setup.engine.advanceUntil(terminalAt + RECOVERY_MS);
    assert.equal(setup.engine.getResponder(setup.responderId)?.availabilityState, "AVAILABLE");
    assert.notEqual(setup.engine.getCommandCenterKnowledge(setup.responderId)?.availabilityState, "AVAILABLE");
    setup.engine.runUntilEmpty();
    assert.equal(setup.engine.getCommandCenterKnowledge(setup.responderId)?.availabilityState, "AVAILABLE");
    assert.ok(setup.engine.getPublicOperationalObservations().some((item) => item.messageType === "RECOVERY_COMPLETED"));
    const serialized = JSON.stringify(setup.engine.getPublicOperationalObservations());
    for (const forbidden of ["severity", "cascade", "causeEventId", "future", "failureReason"]) assert.ok(!serialized.includes(forbidden));
  });

  it("replays resource histories, transfers, IDs, ordering, and snapshots exactly", () => {
    const engine = new SimulationEngine(config());
    const run = () => {
      const responderId = engine.getResponders()[0]!.id;
      engine.requestReplenishment("stockpile_main", responderId, { kit: 2 });
      drain(engine);
      return JSON.stringify(engine.getState());
    };
    const first = run();
    engine.reset();
    assert.equal(run(), first);
  });

  it("preflights resource-event capacity without partial mutation", () => {
    const engine = new SimulationEngine(config({ resources: { ...resourceConfig(), maxResourceEvents: 2 } }));
    const responderId = engine.getResponders()[0]!.id;
    const before = JSON.stringify(engine.getState());
    assert.throws(() => engine.requestReplenishment("stockpile_main", responderId, { kit: 1 }), SimulationLimitError);
    assert.equal(JSON.stringify(engine.getState()), before);
    assert.equal(engine.getReplenishments().length, 0);
  });
});
