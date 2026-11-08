import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COMMUNICATION_STATES,
  SimulationConfigError,
  SimulationEngine,
  SimulationEventError,
  SimulationLimitError,
  communicationTransitionPath,
  isValidCommunicationTransition,
  validateCommunicationConfig,
  type InitialResponderDefinition,
  type OperationalMessageRequest,
  type SimulationConfig,
  type TaskDefinition,
} from "../src/index.js";

const START = 200_000;
const location = (x: number, y: number, label = "Fictional communications base") => ({
  fictional: true as const,
  coordinateSystem: "SIMULATED_LOCAL_GRID" as const,
  x,
  y,
  label,
});

function responder(overrides: Partial<InitialResponderDefinition> = {}): InitialResponderDefinition {
  return {
    id: "rsp_custom_comms",
    callsign: "SUPPLY-901",
    responderType: "SUPPLY_DELIVERY",
    capabilities: ["LOGISTICS"],
    location: location(0, 0),
    crewCapacity: 3,
    equipmentInventory: { kit: 3 },
    ...overrides,
  };
}

function config(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return {
    scenarioId: "phase-6d-communications",
    seed: "communications-seed",
    startTimeMs: START,
    maxDurationMs: 500_000,
    maxEventCount: 20_000,
    initialIncidents: [{ incidentType: "FICTIONAL_SUPPLY_REQUEST", location: { latitude: 0, longitude: 20 }, severity: 3 }],
    initialResponders: [responder()],
    communication: {
      enabled: true,
      normalDelayMs: 10,
      degradedAdditionalDelayMs: 100,
      intermittentAdditionalDelayMs: 20,
      retryIntervalMs: 25,
      deterministicJitterMs: 0,
      maxRetriesPerMessage: 2,
      maxDeliveryDelayMs: 10_000,
    },
    ...overrides,
  };
}

function drain(engine: SimulationEngine): void {
  engine.start();
  engine.runUntilEmpty();
}

function message(engine: SimulationEngine, overrides: Partial<OperationalMessageRequest> = {}): OperationalMessageRequest {
  const responderId = engine.getResponders()[0]!.id;
  const now = engine.getState().currentTimeMs;
  return {
    responderId,
    messageType: "POSITION_UPDATED",
    observedAtMs: now,
    submittedAtMs: now,
    content: { availabilityState: engine.getResponder(responderId)!.availabilityState, location: location(1, 1, "Fictional telemetry") },
    ...overrides,
  };
}

function task(incidentId: string): TaskDefinition {
  return {
    relatedIncidentId: incidentId,
    requiredCapabilities: ["LOGISTICS"],
    requiredEquipment: { kit: 1 },
    requiredCrewCapacity: 1,
    priority: "HIGH",
    estimatedEffortMs: 1_000,
  };
}

describe("Phase 6D communication state and configuration", () => {
  it("supports all five states, validates bounds, and computes valid recovery paths", () => {
    assert.deepEqual(COMMUNICATION_STATES, ["CONNECTED", "DEGRADED", "INTERMITTENT", "OFFLINE", "RECOVERING"]);
    assert.equal(isValidCommunicationTransition("OFFLINE", "RECOVERING"), true);
    assert.equal(isValidCommunicationTransition("OFFLINE", "CONNECTED"), false);
    assert.deepEqual(communicationTransitionPath("OFFLINE", "CONNECTED"), ["RECOVERING", "CONNECTED"]);
    assert.throws(() => validateCommunicationConfig({ enabled: true, intermittentDeliveryProbability: 2 }), SimulationConfigError);
    assert.throws(() => validateCommunicationConfig({ enabled: true, maxRetriesPerMessage: 99 }), SimulationConfigError);
  });

  it("records immutable actual state histories and terminal-fails invalid queued transitions without mutation", () => {
    const engine = new SimulationEngine(config());
    drain(engine);
    const id = engine.getResponders()[0]!.id;
    const before = engine.getResponderCommunication(id)!;
    assert.throws(() => (before.eventHistory as unknown as Array<unknown>).push({}), TypeError);
    engine.scheduleCommunicationStateChange(id, "RECOVERING", engine.getState().currentTimeMs);
    engine.start();
    assert.throws(() => engine.runUntilEmpty(), SimulationEventError);
    assert.equal(engine.status, "FAILED");
    assert.deepEqual(engine.getResponderCommunication(id), before);
  });
});

describe("Phase 6D operational delivery behavior", () => {
  it("creates deterministic IDs and enforces observed/submitted/received ordering", () => {
    const run = () => {
      const engine = new SimulationEngine(config());
      drain(engine);
      engine.sendOperationalMessage(message(engine));
      drain(engine);
      return engine.getHiddenOperationalMessages();
    };
    const first = run();
    const second = run();
    assert.deepEqual(first, second);
    assert.ok(first.every((item) => item.id.startsWith("msg_auto_")));
    assert.ok(first.every((item) => item.observedAtMs <= item.submittedAtMs && item.submittedAtMs <= (item.receivedAtMs ?? Number.MAX_SAFE_INTEGER)));
    assert.equal(new Set(first.map((item) => item.id)).size, first.length);
  });

  it("applies connected and degraded deterministic delays", () => {
    const engine = new SimulationEngine(config());
    drain(engine);
    const id = engine.getResponders()[0]!.id;
    const connectedAt = engine.getState().currentTimeMs;
    engine.sendOperationalMessage(message(engine));
    drain(engine);
    const connected = engine.getHiddenOperationalMessages().at(-1)!;
    assert.equal(connected.receivedAtMs! - connectedAt, 10);

    engine.scheduleCommunicationStateChange(id, "DEGRADED", engine.getState().currentTimeMs);
    drain(engine);
    const degradedAt = engine.getState().currentTimeMs;
    engine.sendOperationalMessage(message(engine));
    drain(engine);
    const degraded = engine.getHiddenOperationalMessages().at(-1)!;
    assert.equal(degraded.receivedAtMs! - degradedAt, 110);
  });

  it("models intermittent loss, bounded retry, and permanent failure", () => {
    const engine = new SimulationEngine(config({ communication: { ...config().communication, enabled: true, intermittentDeliveryProbability: 0, maxRetriesPerMessage: 1, permanentlyFailedMessageTypes: ["TASK_FAILED"] } }));
    drain(engine);
    const id = engine.getResponders()[0]!.id;
    engine.scheduleCommunicationStateChange(id, "INTERMITTENT", engine.getState().currentTimeMs);
    drain(engine);
    engine.sendOperationalMessage(message(engine));
    drain(engine);
    assert.equal(engine.getHiddenOperationalMessages().at(-1)!.failureReason, "RETRY_LIMIT");
    assert.equal(engine.getHiddenOperationalMessages().at(-1)!.attemptCount, 2);

    engine.sendOperationalMessage(message(engine, { messageType: "TASK_FAILED" }));
    drain(engine);
    assert.equal(engine.getHiddenOperationalMessages().at(-1)!.failureReason, "PERMANENTLY_CONFIGURED");
  });

  it("queues during outage and delivers after ordered recovery without early public visibility", () => {
    const engine = new SimulationEngine(config());
    drain(engine);
    const id = engine.getResponders()[0]!.id;
    const now = engine.getState().currentTimeMs;
    engine.scheduleCommunicationStateChange(id, "OFFLINE", now, -1);
    engine.sendOperationalMessage(message(engine), now, 0);
    engine.scheduleCommunicationStateChange(id, "RECOVERING", now + 5);
    engine.scheduleCommunicationStateChange(id, "CONNECTED", now + 6);
    engine.start();
    engine.advanceUntil(now + 4);
    const pending = engine.getHiddenOperationalMessages().find((item) => item.messageType === "POSITION_UPDATED" && item.observedAtMs === now);
    assert.equal(pending?.deliveryStatus, "PENDING");
    assert.ok(!engine.getPublicOperationalObservations().some((item) => item.messageId === pending?.id));
    engine.runUntilEmpty();
    const delivered = engine.getHiddenOperationalMessages().find((item) => item.id === pending?.id);
    assert.equal(delivered?.deliveryStatus, "DELIVERED");
    assert.ok((delivered?.receivedAtMs ?? 0) >= now + 25);
  });

  it("preserves late stale observations without overwriting newer command knowledge", () => {
    const engine = new SimulationEngine(config());
    drain(engine);
    const id = engine.getResponders()[0]!.id;
    const now = engine.getState().currentTimeMs;
    engine.scheduleCommunicationStateChange(id, "DEGRADED", now);
    engine.sendOperationalMessage(message(engine, { observedAtMs: now, submittedAtMs: now, content: { availabilityState: "AVAILABLE", location: location(3, 3) } }), now, 1);
    engine.scheduleCommunicationStateChange(id, "CONNECTED", now + 1);
    engine.sendOperationalMessage(message(engine, { observedAtMs: now + 2, submittedAtMs: now + 2, content: { availabilityState: "OFFLINE", location: location(4, 4) } }), now + 2, 1);
    drain(engine);
    const observations = engine.getPublicOperationalObservations().filter((item) => item.messageType === "POSITION_UPDATED" && item.observedAtMs >= now);
    assert.equal(observations.length, 2);
    assert.ok(observations[0]!.observedAtMs > observations[1]!.observedAtMs);
    assert.equal(engine.getCommandCenterKnowledge(id)?.latestObservedAtMs, now + 2);
    assert.equal(engine.getCommandCenterKnowledge(id)?.availabilityState, "OFFLINE");
  });

  it("keeps undelivered content out of the allowlisted public projection", () => {
    const engine = new SimulationEngine(config({ communication: { ...config().communication, enabled: true, initialState: "OFFLINE", maxRetriesPerMessage: 0 } }));
    const publicBefore = engine.getPublicOperationalObservations();
    assert.deepEqual(publicBefore, []);
    drain(engine);
    assert.ok(engine.getHiddenOperationalMessages().some((item) => item.deliveryStatus === "FAILED"));
    assert.deepEqual(engine.getPublicOperationalObservations(), []);
  });
});

describe("Phase 6D integration, policy boundary, and safety", () => {
  it("keeps actual arrival ahead of known state during an outage, then reports it after recovery", () => {
    const engine = new SimulationEngine(config());
    drain(engine);
    const incidentId = engine.getState().incidents[0]!.id;
    const responderId = engine.getResponders()[0]!.id;
    engine.createTask(task(incidentId));
    drain(engine);
    const taskId = engine.getTasks()[0]!.id;
    engine.assignTask(taskId, responderId);
    drain(engine);
    engine.departResponder(taskId, engine.getState().currentTimeMs, { responderSpeedUnitsPerSecond: 10, progressIntervalMs: 500 });
    engine.start();
    engine.processNextEvent();
    engine.pause();
    const travel = engine.getTravels()[0]!;
    const eta = travel.estimatedArrivalAtMs!;
    engine.scheduleCommunicationStateChange(responderId, "OFFLINE", engine.getState().currentTimeMs, -20);
    engine.scheduleCommunicationStateChange(responderId, "RECOVERING", eta + 1);
    engine.scheduleCommunicationStateChange(responderId, "CONNECTED", eta + 2);
    engine.start();
    engine.advanceUntil(eta);
    assert.equal(engine.getResponder(responderId)?.availabilityState, "ON_SCENE");
    assert.notEqual(engine.getCommandCenterKnowledge(responderId)?.availabilityState, "ON_SCENE");
    engine.runUntilEmpty();
    assert.equal(engine.getCommandCenterKnowledge(responderId)?.availabilityState, "ON_SCENE");
    const arrival = engine.getPublicOperationalObservations().find((item) => item.messageType === "ARRIVAL_REPORTED");
    assert.ok(arrival && arrival.receivedAtMs > eta);
  });

  it("emits a route update after a deterministic road closure reroute", () => {
    const roadNetwork = {
      nodes: [
        { id: "node_a", location: location(0, 0, "A") },
        { id: "node_b", location: location(10, 0, "B") },
        { id: "node_c", location: location(20, 0, "C") },
        { id: "node_d", location: location(10, 10, "D") },
      ],
      segments: [
        { id: "road_ab", fromNodeId: "node_a", toNodeId: "node_b", distanceUnits: 10, speedUnitsPerSecond: 10 },
        { id: "road_bc", fromNodeId: "node_b", toNodeId: "node_c", distanceUnits: 10, speedUnitsPerSecond: 10 },
        { id: "road_ad", fromNodeId: "node_a", toNodeId: "node_d", distanceUnits: 14, speedUnitsPerSecond: 10 },
        { id: "road_dc", fromNodeId: "node_d", toNodeId: "node_c", distanceUnits: 14, speedUnitsPerSecond: 10 },
      ],
    } as const;
    const engine = new SimulationEngine(config({ roadNetwork }));
    drain(engine);
    const incidentId = engine.getState().incidents[0]!.id;
    const responderId = engine.getResponders()[0]!.id;
    engine.createTask(task(incidentId));
    drain(engine);
    const taskId = engine.getTasks()[0]!.id;
    engine.assignTask(taskId, responderId);
    drain(engine);
    const departedAt = engine.getState().currentTimeMs;
    engine.departResponder(taskId, departedAt, { responderSpeedUnitsPerSecond: 10, progressIntervalMs: 500 });
    engine.scheduleRoadStateChange("road_ab", "BLOCKED", departedAt + 100);
    drain(engine);
    assert.ok(engine.getPublicOperationalObservations().some((item) => item.messageType === "ROUTE_UPDATED"));
  });

  it("supports responder-specific initial disruption and immutable allowlisted projections", () => {
    const second = responder({ id: "rsp_custom_second", callsign: "SUPPLY-902", location: location(5, 0) });
    const engine = new SimulationEngine(config({
      initialResponders: [responder(), second],
      communication: { ...config().communication, enabled: true, responderInitialStates: { "SUPPLY-902": "OFFLINE" }, maxRetriesPerMessage: 0 },
    }));
    assert.equal(engine.getResponderCommunication("rsp_custom_comms")?.state, "CONNECTED");
    assert.equal(engine.getResponderCommunication("rsp_custom_second")?.state, "OFFLINE");
    drain(engine);
    const publicItems = engine.getPublicOperationalObservations();
    assert.ok(publicItems.every((item) => item.responderId !== "rsp_custom_second"));
    assert.throws(() => (publicItems as unknown as Array<unknown>).push({}), TypeError);
    const serialized = JSON.stringify(publicItems);
    for (const forbidden of ["severity", "casual", "cascade", "infrastructure", "causeEventId", "failureReason"]) assert.ok(!serialized.includes(forbidden));
  });

  it("uses delivered command knowledge for automatic assignment and actual state as a hard backstop", () => {
    const offline = new SimulationEngine(config({ automaticTaskAssignment: true, communication: { ...config().communication, enabled: true, initialState: "OFFLINE", maxRetriesPerMessage: 0 } }));
    const incidentId = offline.getState().incidents[0]!.id;
    offline.createTask(task(incidentId));
    drain(offline);
    assert.equal(offline.getTasks()[0]!.status, "PENDING");
    assert.equal(offline.getCommandCenterKnowledge(offline.getResponders()[0]!.id), undefined);

    const stale = new SimulationEngine(config({ automaticTaskAssignment: true }));
    drain(stale);
    const staleId = stale.getResponders()[0]!.id;
    const staleAt = stale.getState().currentTimeMs;
    stale.scheduleResponderStateTransition(staleId, "OFFLINE", staleAt);
    stale.createTask(task(stale.getState().incidents[0]!.id), staleAt);
    drain(stale);
    assert.equal(stale.getTasks()[0]!.status, "PENDING");
  });

  it("generates assignment, departure, progress, reroute-capable position, arrival, and task messages", () => {
    const engine = new SimulationEngine(config());
    drain(engine);
    const incidentId = engine.getState().incidents[0]!.id;
    const responderId = engine.getResponders()[0]!.id;
    engine.createTask(task(incidentId));
    drain(engine);
    const taskId = engine.getTasks()[0]!.id;
    engine.assignTask(taskId, responderId);
    drain(engine);
    engine.departResponder(taskId, engine.getState().currentTimeMs, { responderSpeedUnitsPerSecond: 10, progressIntervalMs: 500 });
    drain(engine);
    engine.scheduleTaskStateTransition(taskId, "IN_PROGRESS", engine.getState().currentTimeMs);
    drain(engine);
    engine.scheduleTaskStateTransition(taskId, "COMPLETED", engine.getState().currentTimeMs);
    drain(engine);
    const types = new Set(engine.getPublicOperationalObservations().map((item) => item.messageType));
    for (const type of ["RESPONDER_REGISTERED", "ASSIGNMENT_ACKNOWLEDGED", "UNIT_DEPARTED", "POSITION_UPDATED", "ARRIVAL_REPORTED", "TASK_STARTED", "TASK_COMPLETED"] as const) assert.ok(types.has(type));
    assert.equal(engine.getTask(taskId)?.status, "COMPLETED");
    assert.equal(engine.getIncident(incidentId)?.status, "DETECTED");
  });

  it("links Phase 5 communication infrastructure effects only to configured responders", () => {
    const engine = new SimulationEngine(config({ communication: { ...config().communication, enabled: true, infrastructureLink: { communicationTowerEffect: "GLOBAL" } } }));
    drain(engine);
    const incidentId = engine.getState().incidents[0]!.id;
    engine.scheduleEvolution({ incidentId, disasterType: "SEVERE_STORM", stepCount: 5, stepIntervalMs: 100, observationProbability: 0 });
    drain(engine);
    assert.equal(engine.getResponderCommunication(engine.getResponders()[0]!.id)?.state, "DEGRADED");
    assert.ok(engine.getState().eventHistory.some((entry) => entry.event.type === "COMMUNICATION_STATE_CHANGE" && entry.event.causeEventId !== undefined));
  });

  it("rejects invalid references and pending-message overflow before consuming deterministic message IDs", () => {
    const engine = new SimulationEngine(config());
    assert.throws(() => engine.sendOperationalMessage({ responderId: "rsp_missing", messageType: "POSITION_UPDATED", observedAtMs: START, content: {} }), /does not exist/);
    assert.throws(() => engine.sendOperationalMessage({ responderId: engine.getResponders()[0]!.id, relatedTaskId: "task_missing", messageType: "POSITION_UPDATED", observedAtMs: START, content: {} }), /does not exist/);

    const limited = new SimulationEngine(config({ communication: { ...config().communication, enabled: true, initialState: "OFFLINE", maxPendingMessages: 1, maxRetriesPerMessage: 2 } }));
    limited.start();
    limited.processNextEvent();
    limited.pause();
    assert.equal(limited.getHiddenOperationalMessages().length, 1);
    assert.throws(() => limited.sendOperationalMessage(message(limited), limited.getState().currentTimeMs), SimulationLimitError);
    assert.equal(limited.getHiddenOperationalMessages().length, 1);

    const communicationLimited = new SimulationEngine(config({ communication: { ...config().communication, enabled: true, maxCommunicationEvents: 3 } }));
    assert.throws(() => communicationLimited.sendOperationalMessage(message(communicationLimited)), SimulationLimitError);
    assert.equal(communicationLimited.getHiddenOperationalMessages().length, 0);
  });

  it("resets and replays messages, knowledge, event ordering, and IDs exactly", () => {
    const engine = new SimulationEngine(config());
    const execute = () => {
      drain(engine);
      engine.sendOperationalMessage(message(engine));
      drain(engine);
      return JSON.stringify({ state: engine.getState(), messages: engine.getHiddenOperationalMessages() });
    };
    const first = execute();
    engine.reset();
    const second = execute();
    assert.equal(second, first);
  });
});
