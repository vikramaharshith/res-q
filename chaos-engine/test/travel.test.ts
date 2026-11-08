import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SimulationConfigError,
  SimulationEngine,
  SimulationEventError,
  SimulationLimitError,
  createRoadNetwork,
  findShortestRoute,
  validateRoadNetworkConfig,
  validateTravelLocation,
  type InitialResponderDefinition,
  type RoadNetworkConfig,
  type SimulationConfig,
  type TaskDefinition,
} from "../src/index.js";

const START = 120_000;

const location = (x: number, y: number, label: string) => ({
  fictional: true as const,
  coordinateSystem: "SIMULATED_LOCAL_GRID" as const,
  x,
  y,
  label,
});

function network(withAlternative = true): RoadNetworkConfig {
  return {
    nodes: [
      { id: "node_a", location: location(0, 0, "Fictional node A") },
      { id: "node_b", location: location(10, 0, "Fictional node B") },
      { id: "node_c", location: location(20, 0, "Fictional node C") },
      { id: "node_d", location: location(10, 10, "Fictional node D") },
    ],
    segments: [
      {
        id: "road_ab",
        fromNodeId: "node_a",
        toNodeId: "node_b",
        distanceUnits: 10,
        speedUnitsPerSecond: 10,
        infrastructureType: "ROAD",
      },
      {
        id: "road_bc",
        fromNodeId: "node_b",
        toNodeId: "node_c",
        distanceUnits: 10,
        speedUnitsPerSecond: 10,
        infrastructureType: "ROAD",
      },
      ...(withAlternative
        ? [
            {
              id: "road_ad",
              fromNodeId: "node_a",
              toNodeId: "node_d",
              distanceUnits: 14,
              speedUnitsPerSecond: 10,
            },
            {
              id: "road_dc",
              fromNodeId: "node_d",
              toNodeId: "node_c",
              distanceUnits: 14,
              speedUnitsPerSecond: 10,
            },
          ]
        : []),
    ],
  };
}

function responder(
  overrides: Partial<InitialResponderDefinition> = {},
): InitialResponderDefinition {
  return {
    responderType: "SUPPLY_DELIVERY",
    capabilities: ["LOGISTICS"],
    location: location(0, 0, "Fictional response base"),
    crewCapacity: 3,
    equipmentInventory: { kit: 3 },
    ...overrides,
  };
}

function config(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return {
    scenarioId: "phase-6c-travel",
    seed: "travel-seed",
    startTimeMs: START,
    maxDurationMs: 100_000,
    initialIncidents: [
      {
        incidentType: "FICTIONAL_SUPPLY_REQUEST",
        location: { latitude: 0, longitude: 20, label: "Simulated incident site" },
        severity: 4,
      },
    ],
    initialResponders: [responder()],
    roadNetwork: network(),
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
    estimatedEffortMs: 10_000,
  };
}

function drain(engine: SimulationEngine): void {
  engine.start();
  engine.runUntilEmpty();
}

function assignedEngine(overrides: Partial<SimulationConfig> = {}) {
  const engine = new SimulationEngine(config(overrides));
  const incidentId = engine.getState().incidents[0]!.id;
  engine.createTask(task(incidentId));
  drain(engine);
  const taskId = engine.getTasks()[0]!.id;
  const responderId = engine.getResponders()[0]!.id;
  engine.assignTask(taskId, responderId);
  drain(engine);
  return { engine, taskId, responderId, incidentId };
}

function depart(setup: ReturnType<typeof assignedEngine>) {
  const event = setup.engine.departResponder(setup.taskId, START, {
    responderSpeedUnitsPerSecond: 10,
    progressIntervalMs: 500,
  });
  setup.engine.start();
  const record = setup.engine.processNextEvent();
  assert.equal(record?.event.type, "RESPONDER_DEPART");
  return { event, travel: setup.engine.getTravels()[0]! };
}

describe("Phase 6C road network and deterministic routing", () => {
  it("validates fictional coordinates and bounded graph references", () => {
    assert.throws(
      () =>
        validateTravelLocation({
          fictional: true,
          coordinateSystem: "SIMULATED_LOCAL_GRID",
          x: Number.POSITIVE_INFINITY,
          y: 0,
        }),
      SimulationConfigError,
    );
    assert.throws(
      () =>
        validateRoadNetworkConfig({
          nodes: [{ id: "node_a", location: location(0, 0, "Fictional A") }],
          segments: [
            {
              id: "road_missing",
              fromNodeId: "node_a",
              toNodeId: "node_missing",
              distanceUnits: 1,
              speedUnitsPerSecond: 1,
            },
          ],
        }),
      SimulationConfigError,
    );
  });

  it("generates the same stable shortest path for equal inputs", () => {
    const graph = createRoadNetwork(validateRoadNetworkConfig(network()));
    const start = location(0, 0, "Fictional start");
    const destination = location(20, 0, "Fictional destination");
    const first = findShortestRoute(graph, start, destination, 10);
    const second = findShortestRoute(graph, start, destination, 10);
    assert.deepEqual(first, second);
    assert.deepEqual(first?.segmentIds, ["road_ab", "road_bc"]);
    assert.equal(first?.distanceUnits, 20);
    assert.equal(first?.durationMs, 2_000);
  });

  it("uses stable segment IDs to break equal-cost path ties", () => {
    const equal: RoadNetworkConfig = {
      ...network(),
      segments: network().segments.map((segment) =>
        segment.id === "road_ad" || segment.id === "road_dc"
          ? { ...segment, distanceUnits: 10 }
          : segment,
      ),
    };
    const route = findShortestRoute(
      createRoadNetwork(validateRoadNetworkConfig(equal)),
      location(0, 0, "Fictional start"),
      location(20, 0, "Fictional destination"),
      10,
    );
    assert.deepEqual(route?.segmentIds, ["road_ab", "road_bc"]);
  });

  it("calculates deterministic congestion and degradation delays", () => {
    const congested: RoadNetworkConfig = {
      nodes: [
        { id: "node_a", location: location(0, 0, "Fictional A") },
        { id: "node_b", location: location(10, 0, "Fictional B") },
      ],
      segments: [
        {
          id: "road_ab",
          fromNodeId: "node_a",
          toNodeId: "node_b",
          distanceUnits: 10,
          speedUnitsPerSecond: 5,
          congestionPermille: 2_000,
          initialState: "DEGRADED",
        },
      ],
    };
    const route = findShortestRoute(
      createRoadNetwork(validateRoadNetworkConfig(congested)),
      location(0, 0, "Fictional start"),
      location(10, 0, "Fictional destination"),
      10,
    );
    assert.equal(route?.durationMs, 8_000);
  });
});

describe("Phase 6C departure, progress, and arrival", () => {
  it("rejects travel without assignment or by an unavailable responder", () => {
    const unassigned = new SimulationEngine(config());
    const incidentId = unassigned.getState().incidents[0]!.id;
    unassigned.createTask(task(incidentId));
    drain(unassigned);
    assert.throws(
      () => unassigned.departResponder(unassigned.getTasks()[0]!.id),
      SimulationEventError,
    );

    const setup = assignedEngine();
    setup.engine.scheduleResponderStateTransition(setup.responderId, "OFFLINE", START);
    drain(setup.engine);
    assert.throws(
      () => setup.engine.departResponder(setup.taskId),
      /unavailable/,
    );
  });

  it("departs through events and transitions responder and task state", () => {
    const setup = assignedEngine();
    const before = setup.engine.getResponder(setup.responderId)!.location;
    const result = depart(setup);
    assert.equal(result.travel.status, "EN_ROUTE");
    assert.equal(result.travel.departedAtMs, START);
    assert.equal(result.travel.estimatedArrivalAtMs, START + 2_000);
    assert.deepEqual(result.travel.currentLocation, before);
    assert.equal(setup.engine.getResponder(setup.responderId)?.availabilityState, "EN_ROUTE");
    assert.equal(setup.engine.getTask(setup.taskId)?.status, "EN_ROUTE");
    assert.equal(result.travel.eventHistory[0]?.eventId, result.event.id);
  });

  it("updates movement from elapsed virtual time without teleportation", () => {
    const setup = assignedEngine();
    depart(setup);
    setup.engine.advanceUntil(START + 1_000);
    const travel = setup.engine.getTravels()[0]!;
    assert.equal(travel.progressPermille, 500);
    assert.deepEqual(
      { x: travel.currentLocation.x, y: travel.currentLocation.y },
      { x: 10, y: 0 },
    );
    assert.notDeepEqual(travel.currentLocation, travel.destination);
    assert.equal(setup.engine.getResponder(setup.responderId)?.location.x, 0);
  });

  it("arrives only at the scheduled time and correct fictional destination", () => {
    const setup = assignedEngine();
    depart(setup);
    setup.engine.advanceUntil(START + 1_999);
    assert.equal(setup.engine.getTravels()[0]?.status, "EN_ROUTE");
    setup.engine.advanceUntil(START + 2_000);
    const travel = setup.engine.getTravels()[0]!;
    assert.equal(travel.status, "ARRIVED");
    assert.deepEqual(travel.currentLocation, travel.destination);
    assert.equal(setup.engine.getResponder(setup.responderId)?.availabilityState, "ON_SCENE");
    assert.equal(setup.engine.getResponder(setup.responderId)?.location.x, 20);
  });

  it("prevents task execution before arrival and enters BUSY after arrival", () => {
    const early = assignedEngine();
    depart(early);
    early.engine.scheduleTaskStateTransition(early.taskId, "IN_PROGRESS", START + 500);
    assert.throws(() => early.engine.advanceUntil(START + 500), /before responder arrival/);

    const valid = assignedEngine();
    depart(valid);
    valid.engine.runUntilEmpty();
    valid.engine.scheduleTaskStateTransition(valid.taskId, "IN_PROGRESS", START + 2_000);
    drain(valid.engine);
    assert.equal(valid.engine.getTask(valid.taskId)?.status, "IN_PROGRESS");
    assert.equal(valid.engine.getResponder(valid.responderId)?.availabilityState, "BUSY");
  });

  it("supports simultaneous independent responder travel with stable ordering", () => {
    const engine = new SimulationEngine(
      config({ initialResponders: [responder(), responder()] }),
    );
    const incidentId = engine.getState().incidents[0]!.id;
    engine.createTask(task(incidentId));
    engine.createTask(task(incidentId));
    drain(engine);
    const tasks = engine.getTasks();
    const responders = engine.getResponders();
    engine.assignTask(tasks[0]!.id, responders[0]!.id);
    engine.assignTask(tasks[1]!.id, responders[1]!.id);
    drain(engine);
    const first = engine.departResponder(tasks[0]!.id, START, { responderSpeedUnitsPerSecond: 10, progressIntervalMs: 500 });
    const second = engine.departResponder(tasks[1]!.id, START, { responderSpeedUnitsPerSecond: 10, progressIntervalMs: 500 });
    drain(engine);
    assert.equal(engine.getTravels().filter((travel) => travel.status === "ARRIVED").length, 2);
    assert.deepEqual(
      engine
        .getState()
        .eventHistory.filter((record) => record.event.type === "RESPONDER_DEPART")
        .map((record) => record.event.id),
      [first.id, second.id],
    );
  });
});

describe("Phase 6C road changes, rerouting, and interruption", () => {
  it("delays arrival deterministically when a remaining road degrades", () => {
    const setup = assignedEngine();
    const original = depart(setup).travel.estimatedArrivalAtMs!;
    const roadEvent = setup.engine.scheduleRoadStateChange("road_bc", "DEGRADED", START + 500);
    setup.engine.advanceUntil(START + 500);
    const travel = setup.engine.getTravels()[0]!;
    assert.equal(travel.routeVersion, 2);
    assert.ok(travel.estimatedArrivalAtMs! > original);
    assert.equal(travel.eventHistory.at(-1)?.causeEventId, roadEvent.id);
  });

  it("detects closure, selects the alternative route, and ignores stale arrival", () => {
    const setup = assignedEngine();
    const originalArrival = depart(setup).travel.estimatedArrivalAtMs!;
    const closure = setup.engine.scheduleRoadStateChange("road_bc", "BLOCKED", START + 500);
    setup.engine.runUntilEmpty();
    const travel = setup.engine.getTravels()[0]!;
    assert.equal(travel.status, "ARRIVED");
    assert.ok(!travel.route?.segmentIds.includes("road_bc"));
    assert.ok(travel.routeVersion > 1);
    const reroute = setup.engine
      .getState()
      .eventHistory.find((record) => record.event.type === "TRAVEL_REROUTE");
    assert.equal(reroute?.event.causeEventId, closure.id);
    assert.ok(
      setup.engine.getState().eventHistory.some(
        (record) =>
          record.event.type === "RESPONDER_ARRIVE" &&
          record.event.scheduledTimeMs === originalArrival &&
          "kind" in record.change &&
          record.change.kind === "TRAVEL_EVENT_IGNORED",
      ),
    );
  });

  it("marks no-route travel blocked and supports bounded explicit retry", () => {
    const setup = assignedEngine({ roadNetwork: network(false) });
    depart(setup);
    setup.engine.scheduleRoadStateChange("road_bc", "BLOCKED", START + 500);
    setup.engine.advanceUntil(START + 500);
    let travel = setup.engine.getTravels()[0]!;
    assert.equal(travel.status, "BLOCKED");
    assert.equal(travel.estimatedArrivalAtMs, undefined);
    setup.engine.scheduleRoadStateChange("road_bc", "ACCESSIBLE", START + 500);
    setup.engine.advanceBy(0);
    const retry = setup.engine.retryTravel(travel.id, START + 500);
    setup.engine.advanceBy(0);
    travel = setup.engine.getTravel(travel.id)!;
    assert.equal(travel.status, "EN_ROUTE");
    assert.equal(travel.retryCount, 1);
    assert.equal(travel.eventHistory.at(-1)?.eventId, retry.id);
    setup.engine.runUntilEmpty();
    assert.equal(setup.engine.getTravel(travel.id)?.status, "ARRIVED");
  });

  it("interrupts travel and suppresses the superseded arrival", () => {
    const setup = assignedEngine();
    const departure = depart(setup);
    setup.engine.interruptTravel(departure.travel.id, START + 500, -10);
    setup.engine.runUntilEmpty();
    assert.equal(setup.engine.getTravel(departure.travel.id)?.status, "INTERRUPTED");
    assert.notEqual(setup.engine.getResponder(setup.responderId)?.availabilityState, "ON_SCENE");
    assert.ok(
      !setup.engine
        .getState()
        .eventHistory.some(
          (record) =>
            record.event.type === "RESPONDER_ARRIVE" &&
            "kind" in record.change &&
            record.change.kind === "TRAVEL_ARRIVED",
        ),
    );
  });

  it("cancels active travel with its task and prevents phantom arrival", () => {
    const setup = assignedEngine();
    const departure = depart(setup);
    setup.engine.scheduleTaskStateTransition(setup.taskId, "CANCELLED", START + 500, -30);
    setup.engine.runUntilEmpty();
    assert.equal(setup.engine.getTask(setup.taskId)?.status, "CANCELLED");
    assert.equal(setup.engine.getTravel(departure.travel.id)?.status, "CANCELLED");
    assert.equal(setup.engine.getTravel(departure.travel.id)?.arrivedAtMs, undefined);
  });

  it("supersedes a future departure when its task is cancelled first", () => {
    const setup = assignedEngine();
    setup.engine.departResponder(setup.taskId, START + 1_000, {
      responderSpeedUnitsPerSecond: 10,
      progressIntervalMs: 500,
    });
    assert.throws(
      () => setup.engine.departResponder(setup.taskId, START + 1_000),
      /pending departure/,
    );
    setup.engine.scheduleTaskStateTransition(
      setup.taskId,
      "CANCELLED",
      START + 500,
      -30,
    );
    drain(setup.engine);
    assert.equal(setup.engine.status, "COMPLETED");
    assert.equal(setup.engine.getTasks()[0]?.status, "CANCELLED");
    assert.equal(setup.engine.getTravels()[0]?.status, "CANCELLED");
    assert.equal(setup.engine.getTravels()[0]?.departedAtMs, undefined);
  });

  it("maps current Phase 5 ROAD infrastructure failures to linked segments", () => {
    const setup = assignedEngine();
    depart(setup);
    setup.engine.scheduleEvolution({
      incidentId: setup.incidentId,
      disasterType: "FLOOD",
      stepCount: 1,
      stepIntervalMs: 500,
      initialEnvironment: { rainfall: 1, floodwater: 0.9 },
      observationProbability: 0,
    });
    setup.engine.advanceUntil(START + 500);
    const linked = setup.engine
      .getRoadNetwork()
      .segments.filter((segment) => segment.infrastructureType === "ROAD");
    assert.ok(linked.length > 0);
    assert.ok(linked.every((segment) => segment.state === "BLOCKED"));
  });
});

describe("Phase 6C safety, immutability, reset, and replay", () => {
  it("enforces travel event capacity without partial mutation", () => {
    const setup = assignedEngine({ maxEventCount: 20 });
    const before = setup.engine.getState();
    assert.throws(
      () =>
        setup.engine.departResponder(setup.taskId, START, {
          responderSpeedUnitsPerSecond: 10,
          progressIntervalMs: 1,
        }),
      SimulationLimitError,
    );
    assert.deepEqual(setup.engine.getState(), before);
  });

  it("rejects duplicate active travel attempts without consuming state", () => {
    const setup = assignedEngine();
    depart(setup);
    const before = setup.engine.getState();
    assert.throws(
      () => setup.engine.departResponder(setup.taskId),
      SimulationEventError,
    );
    assert.deepEqual(setup.engine.getState(), before);
  });

  it("returns deeply immutable travel, route, road, and event histories", () => {
    const setup = assignedEngine();
    depart(setup);
    const travel = setup.engine.getTravels()[0]!;
    const road = setup.engine.getRoadNetwork();
    assert.ok(Object.isFrozen(travel));
    assert.ok(Object.isFrozen(travel.currentLocation));
    assert.ok(Object.isFrozen(travel.route));
    assert.ok(Object.isFrozen(travel.route?.legs));
    assert.ok(Object.isFrozen(travel.eventHistory));
    assert.ok(Object.isFrozen(road));
    assert.ok(Object.isFrozen(road.segments));
    assert.ok(Object.isFrozen(setup.engine.getState().travels));
  });

  it("resets travel and road state and replays byte-for-byte", () => {
    const engine = new SimulationEngine(config());
    const initial = engine.getState();
    const replay = () => {
      const incidentId = engine.getState().incidents[0]!.id;
      engine.createTask(task(incidentId));
      drain(engine);
      const taskId = engine.getTasks()[0]!.id;
      engine.assignTask(taskId, engine.getResponders()[0]!.id);
      drain(engine);
      engine.departResponder(taskId, START, {
        responderSpeedUnitsPerSecond: 10,
        progressIntervalMs: 500,
      });
      engine.start();
      engine.processNextEvent();
      engine.scheduleRoadStateChange("road_bc", "BLOCKED", START + 500);
      return JSON.stringify(engine.runUntilEmpty());
    };
    const first = replay();
    engine.reset();
    assert.deepEqual(engine.getState(), initial);
    const second = replay();
    assert.equal(second, first);
  });
});
