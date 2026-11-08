import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SimulationEngine,
  SimulationEventError,
  SimulationLimitError,
  SimulationStateError,
  type InitialIncidentDefinition,
  type SimulationConfig,
} from "../src/index.js";

const initialIncident: InitialIncidentDefinition = {
  incidentType: "STRUCTURE_FIRE",
  location: { latitude: 41.881_832, longitude: -87.623_177, label: "Fictional Block A" },
  severity: 4,
};

function config(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return {
    scenarioId: "engine-test",
    seed: "engine-seed",
    startTimeMs: 10_000,
    maxDurationMs: 10_000,
    maxEventCount: 100,
    maxIncidentCount: 20,
    ...overrides,
  };
}

function engineWithIncident(overrides: Partial<SimulationConfig> = {}): {
  engine: SimulationEngine;
  incidentId: string;
} {
  const engine = new SimulationEngine(
    config({ initialIncidents: [initialIncident], ...overrides }),
  );
  const incident = engine.getState().incidents[0];
  assert.ok(incident);
  return { engine, incidentId: incident.id };
}

describe("SimulationEngine initialization and identifiers", () => {
  it("initializes incidents through recorded creation events", () => {
    const { engine, incidentId } = engineWithIncident();
    const state = engine.getState();

    assert.equal(state.status, "READY");
    assert.equal(state.currentTimeMs, 10_000);
    assert.equal(state.incidents.length, 1);
    assert.equal(state.incidents[0]?.status, "DETECTED");
    assert.equal(state.eventHistory.length, 1);
    assert.equal(state.eventHistory[0]?.event.type, "INCIDENT_CREATE");
    assert.deepEqual(state.incidents[0]?.eventHistoryIds, [state.eventHistory[0]?.event.id]);
    assert.match(engine.runId, /^run_/);
    assert.match(incidentId, /^inc_auto_/);
  });

  it("reproduces IDs for the same configuration", () => {
    const first = engineWithIncident().engine.getState();
    const second = engineWithIncident().engine.getState();

    assert.equal(first.runId, second.runId);
    assert.equal(first.incidents[0]?.id, second.incidents[0]?.id);
    assert.equal(first.eventHistory[0]?.event.id, second.eventHistory[0]?.event.id);
  });

  it("produces different deterministic identity for a different seed", () => {
    const first = engineWithIncident({ seed: "alpha" }).engine.getState();
    const second = engineWithIncident({ seed: "beta" }).engine.getState();

    assert.notEqual(first.runId, second.runId);
    assert.notEqual(first.incidents[0]?.id, second.incidents[0]?.id);
    assert.notEqual(first.eventHistory[0]?.event.id, second.eventHistory[0]?.event.id);
  });

  it("keeps generated incident and event IDs unique and type-prefixed", () => {
    const engine = new SimulationEngine(config());
    const events = Array.from({ length: 5 }, (_, index) =>
      engine.scheduleEvent({
        type: "INCIDENT_CREATE",
        scheduledTimeMs: 10_000 + index,
        payload: {
          ...initialIncident,
          location: { latitude: 40 + index / 100, longitude: -80 },
        },
      }),
    );

    assert.equal(new Set(events.map((event) => event.id)).size, events.length);
    assert.equal(new Set(events.map((event) => event.relatedIncidentId)).size, events.length);
    assert.ok(events.every((event) => event.id.startsWith("evt_")));
    assert.ok(events.every((event) => event.relatedIncidentId.startsWith("inc_auto_")));
  });
});

describe("SimulationEngine scheduling and ordering", () => {
  it("schedules creation without mutating incident state before processing", () => {
    const engine = new SimulationEngine(config());
    const event = engine.scheduleEvent({
      type: "INCIDENT_CREATE",
      scheduledTimeMs: 10_100,
      priority: 3,
      payload: initialIncident,
    });

    assert.equal(engine.getState().pendingEventCount, 1);
    assert.equal(engine.getState().incidents.length, 0);
    assert.equal(event.priority, 3);

    engine.start();
    engine.advanceUntil(10_100);
    assert.equal(engine.getIncident(event.relatedIncidentId)?.status, "DETECTED");
  });

  it("uses priority and stable insertion order for same-timestamp events", () => {
    const engine = new SimulationEngine(config());
    const latePriority = engine.scheduleEvent({
      type: "INCIDENT_CREATE",
      scheduledTimeMs: 10_100,
      priority: 5,
      payload: { ...initialIncident, incidentType: "LATE_PRIORITY" },
    });
    const firstTie = engine.scheduleEvent({
      type: "INCIDENT_CREATE",
      scheduledTimeMs: 10_100,
      priority: 1,
      payload: { ...initialIncident, incidentType: "FIRST_TIE" },
    });
    const secondTie = engine.scheduleEvent({
      type: "INCIDENT_CREATE",
      scheduledTimeMs: 10_100,
      priority: 1,
      payload: { ...initialIncident, incidentType: "SECOND_TIE" },
    });

    engine.start();
    engine.runUntilEmpty();
    assert.deepEqual(
      engine.getState().eventHistory.map((record) => record.event.id),
      [firstTie.id, secondTie.id, latePriority.id],
    );
  });

  it("rejects scheduling in the past or for a nonexistent incident", () => {
    const { engine } = engineWithIncident();

    assert.throws(
      () =>
        engine.scheduleEvent({
          type: "INCIDENT_CREATE",
          scheduledTimeMs: 9_999,
          payload: initialIncident,
        }),
      SimulationEventError,
    );
    assert.throws(
      () =>
        engine.scheduleEvent({
          type: "INCIDENT_ACTIVATE",
          scheduledTimeMs: 10_000,
          relatedIncidentId: "inc_missing",
        }),
      SimulationEventError,
    );
  });

  it("preserves valid causal references and rejects unknown causes", () => {
    const { engine, incidentId } = engineWithIncident();
    const creationId = engine.getState().eventHistory[0]?.event.id;
    assert.ok(creationId);

    const activation = engine.scheduleEvent({
      type: "INCIDENT_ACTIVATE",
      scheduledTimeMs: 10_100,
      relatedIncidentId: incidentId,
      causeEventId: creationId,
    });
    assert.equal(activation.causeEventId, creationId);

    assert.throws(
      () =>
        engine.scheduleEvent({
          type: "INCIDENT_STABILIZE",
          scheduledTimeMs: 10_200,
          relatedIncidentId: incidentId,
          causeEventId: "evt_unknown",
        }),
      SimulationEventError,
    );

    engine.start();
    engine.runUntilEmpty();
    assert.equal(engine.getState().eventHistory[1]?.event.causeEventId, creationId);
  });

  it("does not consume deterministic IDs for rejected scheduling requests", () => {
    const first = engineWithIncident();
    const second = engineWithIncident();

    assert.throws(
      () =>
        first.engine.scheduleEvent({
          type: "INCIDENT_SEVERITY_INCREASE",
          scheduledTimeMs: 10_100,
          relatedIncidentId: first.incidentId,
          payload: { amount: 0 },
        }),
      SimulationEventError,
    );

    const afterRejection = first.engine.scheduleEvent({
      type: "INCIDENT_ACTIVATE",
      scheduledTimeMs: 10_100,
      relatedIncidentId: first.incidentId,
    });
    const baseline = second.engine.scheduleEvent({
      type: "INCIDENT_ACTIVATE",
      scheduledTimeMs: 10_100,
      relatedIncidentId: second.incidentId,
    });
    assert.equal(afterRejection.id, baseline.id);
  });
});

describe("SimulationEngine incident lifecycle", () => {
  it("applies the complete valid lifecycle with bounded severity", () => {
    const { engine, incidentId } = engineWithIncident();
    engine.scheduleEvent({
      type: "INCIDENT_ACTIVATE",
      scheduledTimeMs: 10_100,
      relatedIncidentId: incidentId,
    });
    engine.scheduleEvent({
      type: "INCIDENT_SEVERITY_INCREASE",
      scheduledTimeMs: 10_200,
      relatedIncidentId: incidentId,
      payload: { amount: 3 },
    });
    engine.scheduleEvent({
      type: "INCIDENT_SEVERITY_DECREASE",
      scheduledTimeMs: 10_300,
      relatedIncidentId: incidentId,
      payload: { amount: 2 },
    });
    engine.scheduleEvent({
      type: "INCIDENT_STABILIZE",
      scheduledTimeMs: 10_400,
      relatedIncidentId: incidentId,
    });
    engine.scheduleEvent({
      type: "INCIDENT_RESOLVE",
      scheduledTimeMs: 10_500,
      relatedIncidentId: incidentId,
    });

    engine.start();
    engine.runUntilEmpty();
    const incident = engine.getIncident(incidentId);
    assert.equal(incident?.status, "RESOLVED");
    assert.equal(incident?.severity, 5);
    assert.equal(incident?.lastUpdatedAtMs, 10_500);
    assert.equal(incident?.eventHistoryIds.length, 6);
  });

  it("fails deterministically on an invalid transition without partial mutation", () => {
    const { engine, incidentId } = engineWithIncident();
    const invalid = engine.scheduleEvent({
      type: "INCIDENT_RESOLVE",
      scheduledTimeMs: 10_100,
      relatedIncidentId: incidentId,
    });

    engine.start();
    assert.throws(() => engine.runUntilEmpty(), SimulationEventError);
    const state = engine.getState();
    assert.equal(state.status, "FAILED");
    assert.equal(state.failure?.eventId, invalid.id);
    assert.equal(state.incidents[0]?.status, "DETECTED");
    assert.equal(state.eventHistory.length, 1);
  });

  it("enforces upper and lower severity bounds during processing", () => {
    const upper = engineWithIncident({
      initialIncidents: [{ ...initialIncident, severity: 10 }],
    });
    upper.engine.scheduleEvent({
      type: "INCIDENT_ACTIVATE",
      scheduledTimeMs: 10_100,
      relatedIncidentId: upper.incidentId,
    });
    upper.engine.scheduleEvent({
      type: "INCIDENT_SEVERITY_INCREASE",
      scheduledTimeMs: 10_200,
      relatedIncidentId: upper.incidentId,
      payload: { amount: 1 },
    });
    upper.engine.start();
    assert.throws(() => upper.engine.runUntilEmpty(), /severity cannot exceed/);
    assert.equal(upper.engine.getIncident(upper.incidentId)?.severity, 10);

    const lower = engineWithIncident({
      initialIncidents: [{ ...initialIncident, severity: 1 }],
    });
    lower.engine.scheduleEvent({
      type: "INCIDENT_ACTIVATE",
      scheduledTimeMs: 10_100,
      relatedIncidentId: lower.incidentId,
    });
    lower.engine.scheduleEvent({
      type: "INCIDENT_SEVERITY_DECREASE",
      scheduledTimeMs: 10_200,
      relatedIncidentId: lower.incidentId,
      payload: { amount: 1 },
    });
    lower.engine.start();
    assert.throws(() => lower.engine.runUntilEmpty(), /severity cannot be less/);
    assert.equal(lower.engine.getIncident(lower.incidentId)?.severity, 1);
  });

  it("never permits a resolved incident to become active again", () => {
    const { engine, incidentId } = engineWithIncident();
    for (const [type, time] of [
      ["INCIDENT_ACTIVATE", 10_100],
      ["INCIDENT_STABILIZE", 10_200],
      ["INCIDENT_RESOLVE", 10_300],
    ] as const) {
      engine.scheduleEvent({ type, scheduledTimeMs: time, relatedIncidentId: incidentId });
    }
    engine.start();
    engine.runUntilEmpty();

    engine.scheduleEvent({
      type: "INCIDENT_ACTIVATE",
      scheduledTimeMs: 10_400,
      relatedIncidentId: incidentId,
    });
    engine.start();
    assert.throws(() => engine.runUntilEmpty(), /resolved and cannot transition/);
    assert.equal(engine.getIncident(incidentId)?.status, "RESOLVED");
  });

  it("records event history and resulting changes", () => {
    const { engine, incidentId } = engineWithIncident();
    const activation = engine.scheduleEvent({
      type: "INCIDENT_ACTIVATE",
      scheduledTimeMs: 10_250,
      relatedIncidentId: incidentId,
    });
    engine.start();
    engine.runUntilEmpty();

    const record = engine.getState().eventHistory[1];
    assert.equal(record?.event.id, activation.id);
    assert.equal(record?.processedAtMs, 10_250);
    assert.deepEqual(record?.change, {
      incidentId,
      previousStatus: "DETECTED",
      status: "ACTIVE",
      previousSeverity: 4,
      severity: 4,
    });
  });
});

describe("SimulationEngine execution controls", () => {
  it("pauses and resumes without advancing while paused", () => {
    const { engine } = engineWithIncident();
    engine.start();
    engine.advanceBy(100);
    engine.pause();
    const pausedAt = engine.getState().currentTimeMs;

    assert.throws(() => engine.advanceBy(100), SimulationStateError);
    assert.equal(engine.getState().currentTimeMs, pausedAt);

    engine.resume();
    engine.advanceBy(100);
    assert.equal(engine.getState().currentTimeMs, pausedAt + 100);
  });

  it("supports deterministic incremental event stepping", () => {
    const { engine, incidentId } = engineWithIncident();
    engine.scheduleEvent({
      type: "INCIDENT_ACTIVATE",
      scheduledTimeMs: 10_100,
      relatedIncidentId: incidentId,
    });
    engine.scheduleEvent({
      type: "INCIDENT_STABILIZE",
      scheduledTimeMs: 10_200,
      relatedIncidentId: incidentId,
    });
    engine.start();

    assert.equal(engine.processNextEvent()?.event.type, "INCIDENT_ACTIVATE");
    assert.equal(engine.getState().currentTimeMs, 10_100);
    assert.equal(engine.getIncident(incidentId)?.status, "ACTIVE");
    assert.equal(engine.processNextEvent()?.event.type, "INCIDENT_STABILIZE");
    assert.equal(engine.getState().currentTimeMs, 10_200);
  });

  it("advanceUntil processes only events at or before its target", () => {
    const { engine, incidentId } = engineWithIncident();
    engine.scheduleEvent({
      type: "INCIDENT_ACTIVATE",
      scheduledTimeMs: 10_100,
      relatedIncidentId: incidentId,
    });
    engine.scheduleEvent({
      type: "INCIDENT_STABILIZE",
      scheduledTimeMs: 10_300,
      relatedIncidentId: incidentId,
    });
    engine.start();
    const state = engine.advanceUntil(10_200);

    assert.equal(state.currentTimeMs, 10_200);
    assert.equal(state.pendingEventCount, 1);
    assert.equal(state.incidents[0]?.status, "ACTIVE");
  });

  it("reset restores exact initial conditions and identifiers", () => {
    const { engine, incidentId } = engineWithIncident();
    const initial = engine.getState();
    engine.scheduleEvent({
      type: "INCIDENT_ACTIVATE",
      scheduledTimeMs: 10_100,
      relatedIncidentId: incidentId,
    });
    engine.start();
    engine.runUntilEmpty();

    engine.reset();
    assert.deepEqual(engine.getState(), initial);
  });

  it("replays byte-for-byte-equivalent public state for the same inputs", () => {
    const run = (): string => {
      const { engine, incidentId } = engineWithIncident();
      engine.scheduleEvent({
        type: "INCIDENT_ACTIVATE",
        scheduledTimeMs: 10_100,
        relatedIncidentId: incidentId,
      });
      engine.scheduleEvent({
        type: "INCIDENT_STABILIZE",
        scheduledTimeMs: 10_200,
        relatedIncidentId: incidentId,
      });
      engine.start();
      engine.runUntilEmpty();
      return JSON.stringify(engine.getState());
    };

    assert.equal(run(), run());
  });

  it("handles an empty queue safely", () => {
    const engine = new SimulationEngine(config());
    engine.start();

    assert.equal(engine.processNextEvent(), undefined);
    const state = engine.runUntilEmpty();
    assert.equal(state.status, "COMPLETED");
    assert.equal(state.processedEventCount, 0);
  });
});

describe("SimulationEngine safety and state integrity", () => {
  it("enforces total event and incident limits before queue growth", () => {
    const eventLimited = engineWithIncident({ maxEventCount: 2 });
    eventLimited.engine.scheduleEvent({
      type: "INCIDENT_ACTIVATE",
      scheduledTimeMs: 10_100,
      relatedIncidentId: eventLimited.incidentId,
    });
    assert.throws(
      () =>
        eventLimited.engine.scheduleEvent({
          type: "INCIDENT_STABILIZE",
          scheduledTimeMs: 10_200,
          relatedIncidentId: eventLimited.incidentId,
        }),
      SimulationLimitError,
    );

    const incidentLimited = new SimulationEngine(config({ maxIncidentCount: 1 }));
    incidentLimited.scheduleEvent({
      type: "INCIDENT_CREATE",
      scheduledTimeMs: 10_000,
      payload: initialIncident,
    });
    assert.throws(
      () =>
        incidentLimited.scheduleEvent({
          type: "INCIDENT_CREATE",
          scheduledTimeMs: 10_001,
          payload: initialIncident,
        }),
      SimulationLimitError,
    );
  });

  it("enforces maximum simulation duration for scheduling and advancement", () => {
    const engine = new SimulationEngine(config({ maxDurationMs: 100 }));
    assert.throws(
      () =>
        engine.scheduleEvent({
          type: "INCIDENT_CREATE",
          scheduledTimeMs: 10_101,
          payload: initialIncident,
        }),
      SimulationLimitError,
    );

    engine.start();
    assert.throws(() => engine.advanceUntil(10_101), SimulationLimitError);
    assert.equal(engine.getState().currentTimeMs, 10_000);
  });

  it("returns deeply immutable public state snapshots", () => {
    const { engine } = engineWithIncident();
    const state = engine.getState();

    assert.ok(Object.isFrozen(state));
    assert.ok(Object.isFrozen(state.incidents));
    assert.ok(Object.isFrozen(state.incidents[0]));
    assert.ok(Object.isFrozen(state.incidents[0]?.location));
    assert.ok(Object.isFrozen(state.incidents[0]?.eventHistoryIds));
    assert.ok(Object.isFrozen(state.eventHistory));
    assert.ok(Object.isFrozen(state.eventHistory[0]));
    assert.throws(() => {
      (state.incidents as unknown as IncidentSnapshotForMutation[]).push(
        {} as IncidentSnapshotForMutation,
      );
    }, TypeError);
    assert.equal(engine.getState().incidents.length, 1);
  });

  it("fails on a queued transition invalidated by an earlier event", () => {
    const { engine, incidentId } = engineWithIncident();
    const first = engine.scheduleEvent({
      type: "INCIDENT_ACTIVATE",
      scheduledTimeMs: 10_100,
      priority: 0,
      relatedIncidentId: incidentId,
    });
    const rejected = engine.scheduleEvent({
      type: "INCIDENT_ACTIVATE",
      scheduledTimeMs: 10_100,
      priority: 1,
      relatedIncidentId: incidentId,
    });

    engine.start();
    assert.throws(() => engine.runUntilEmpty(), SimulationEventError);
    const state = engine.getState();
    assert.equal(state.status, "FAILED");
    assert.equal(state.incidents[0]?.status, "ACTIVE");
    assert.equal(state.eventHistory.at(-1)?.event.id, first.id);
    assert.equal(state.failure?.eventId, rejected.id);
    assert.ok(!state.eventHistory.some((record) => record.event.id === rejected.id));
  });
});

type IncidentSnapshotForMutation = {
  id?: string;
};

