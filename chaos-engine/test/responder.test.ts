import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_RESPONDER_INVENTORY_QUANTITY_PER_ITEM,
  RESPONDER_AVAILABILITY_STATES,
  RESPONDER_TYPES,
  SimulationConfigError,
  SimulationEngine,
  SimulationEventError,
  SimulationLimitError,
  validateResponderDefinition,
  type InitialResponderDefinition,
  type ResponderType,
  type SimulationConfig,
} from "../src/index.js";

const START_TIME_MS = 50_000;

function definition(
  responderType: ResponderType,
  overrides: Partial<InitialResponderDefinition> = {},
): InitialResponderDefinition {
  return {
    responderType,
    location: {
      fictional: true,
      coordinateSystem: "SIMULATED_LOCAL_GRID",
      x: 10,
      y: -4,
      label: "Fictional Central Response Base",
    },
    crewCapacity: 4,
    equipmentInventory: { radio: 4, protectiveKit: 4 },
    ...overrides,
  };
}

function config(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return {
    scenarioId: "phase-6a-responders",
    seed: "responder-seed",
    startTimeMs: START_TIME_MS,
    maxDurationMs: 100_000,
    ...overrides,
  };
}

describe("Phase 6A responder registration", () => {
  it("registers all eight responder types with deterministic IDs and callsigns", () => {
    const run = () =>
      new SimulationEngine(
        config({ initialResponders: RESPONDER_TYPES.map((type) => definition(type)) }),
      ).getState();

    const first = run();
    const second = run();
    assert.equal(first.responders.length, 8);
    assert.deepEqual(
      first.responders.map((responder) => responder.responderType),
      RESPONDER_TYPES,
    );
    assert.deepEqual(first.responders, second.responders);
    assert.equal(new Set(first.responders.map((responder) => responder.id)).size, 8);
    assert.equal(new Set(first.responders.map((responder) => responder.callsign)).size, 8);
    assert.ok(first.responders.every((responder) => responder.id.startsWith("rsp_auto_")));
    assert.deepEqual(
      first.responders.map((responder) => responder.callsign),
      ["MED-001", "FIRE-001", "WATER-001", "SAR-001", "POLICE-001", "UTILITY-001", "EVAC-001", "SUPPLY-001"],
    );
  });

  it("validates capabilities, crew, fictional location, and bounded inventory", () => {
    const responder = validateResponderDefinition(
      definition("AMBULANCE", { capabilities: ["TRIAGE", "PATIENT_TRANSPORT"] }),
    );
    assert.deepEqual(responder.capabilities, ["TRIAGE", "PATIENT_TRANSPORT"]);
    assert.ok(Object.isFrozen(responder));
    assert.ok(Object.isFrozen(responder.location));
    assert.ok(Object.isFrozen(responder.equipmentInventory));

    assert.throws(
      () =>
        validateResponderDefinition(
          definition("AMBULANCE", {
            equipmentInventory: {
              medicalKit: MAX_RESPONDER_INVENTORY_QUANTITY_PER_ITEM + 1,
            },
          }),
        ),
      SimulationConfigError,
    );
    assert.throws(
      () =>
        validateResponderDefinition({
          ...definition("AMBULANCE"),
          location: {
            fictional: false,
            coordinateSystem: "SIMULATED_LOCAL_GRID",
            x: 0,
            y: 0,
            label: "Real Station",
          },
        }),
      SimulationConfigError,
    );
  });

  it("rejects duplicate explicit IDs and callsigns before queue growth", () => {
    const engine = new SimulationEngine(config());
    const first = definition("POLICE", {
      id: "rsp_custom_unit_1",
      callsign: "POLICE-77",
    });
    engine.registerResponder(first);
    assert.throws(() => engine.registerResponder(first), /Duplicate responder ID/);
    assert.throws(
      () =>
        engine.registerResponder(
          definition("AMBULANCE", {
            id: "rsp_custom_unit_2",
            callsign: "POLICE-77",
          }),
        ),
      /Duplicate responder callsign/,
    );
    assert.equal(engine.getState().pendingEventCount, 1);
  });

  it("enforces the configured responder-count limit", () => {
    const engine = new SimulationEngine(config({ maxResponderCount: 1 }));
    engine.registerResponder(definition("FIRE_ENGINE"));
    assert.throws(
      () => engine.registerResponder(definition("POLICE")),
      SimulationLimitError,
    );
  });
});

describe("Phase 6A responder lifecycle", () => {
  it("supports every state through validated queue-ordered transitions", () => {
    const engine = new SimulationEngine(
      config({ initialResponders: [definition("SEARCH_AND_RESCUE")] }),
    );
    const responderId = engine.getResponders()[0]!.id;
    const states = [
      "RESERVED",
      "EN_ROUTE",
      "ON_SCENE",
      "BUSY",
      "ON_SCENE",
      "RECOVERING",
      "AVAILABLE",
      "OFFLINE",
      "AVAILABLE",
    ] as const;
    states.forEach((state) =>
      engine.scheduleResponderStateTransition(responderId, state, START_TIME_MS + 1_000),
    );

    engine.start();
    engine.runUntilEmpty();
    const responder = engine.getResponder(responderId)!;
    assert.equal(responder.availabilityState, "AVAILABLE");
    assert.equal(responder.stateHistory.length, states.length + 1);
    assert.deepEqual(
      new Set(responder.stateHistory.map((entry) => entry.state)),
      new Set(RESPONDER_AVAILABILITY_STATES),
    );
    assert.deepEqual(
      engine
        .getState()
        .eventHistory.slice(1)
        .map((record) => record.change),
      states.map((state, index) => ({
        kind: "RESPONDER_STATE_CHANGED",
        responderId,
        previousState: index === 0 ? "AVAILABLE" : states[index - 1],
        state,
      })),
    );
  });

  it("fails deterministically on an invalid queued transition without mutation", () => {
    const engine = new SimulationEngine(
      config({ initialResponders: [definition("SUPPLY_DELIVERY")] }),
    );
    const responder = engine.getResponders()[0]!;
    engine.scheduleResponderStateTransition(
      responder.id,
      "BUSY",
      START_TIME_MS + 100,
    );
    engine.start();
    assert.throws(() => engine.runUntilEmpty(), SimulationEventError);
    assert.equal(engine.status, "FAILED");
    assert.equal(engine.getResponder(responder.id)?.availabilityState, "AVAILABLE");
    assert.equal(engine.getResponder(responder.id)?.stateHistory.length, 1);
  });

  it("returns deeply immutable responder snapshots and histories", () => {
    const engine = new SimulationEngine(
      config({ initialResponders: [definition("WATER_RESCUE")] }),
    );
    const responder = engine.getResponders()[0]!;
    assert.ok(Object.isFrozen(responder));
    assert.ok(Object.isFrozen(responder.capabilities));
    assert.ok(Object.isFrozen(responder.location));
    assert.ok(Object.isFrozen(responder.equipmentInventory));
    assert.ok(Object.isFrozen(responder.eventHistoryIds));
    assert.ok(Object.isFrozen(responder.stateHistory));
    assert.ok(Object.isFrozen(responder.stateHistory[0]));
    assert.throws(() => {
      (responder.capabilities as string[]).push("MUTATED");
    }, TypeError);
  });

  it("resets exact responder state and replays byte-for-byte", () => {
    const engine = new SimulationEngine(
      config({ initialResponders: [definition("UTILITY_REPAIR")] }),
    );
    const initial = engine.getState();
    const responderId = initial.responders[0]!.id;
    const replay = () => {
      engine.scheduleResponderStateTransition(
        responderId,
        "RESERVED",
        START_TIME_MS + 100,
      );
      engine.scheduleResponderStateTransition(
        responderId,
        "EN_ROUTE",
        START_TIME_MS + 200,
      );
      engine.start();
      return JSON.stringify(engine.runUntilEmpty());
    };

    const first = replay();
    engine.reset();
    assert.deepEqual(engine.getState(), initial);
    const second = replay();
    assert.equal(second, first);
  });
});
