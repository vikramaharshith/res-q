import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SimulationEngine,
  SimulationLimitError,
  type DisasterType,
  type SimulationConfig,
} from "../src/index.js";

function config(seed = "evolution-seed", overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return {
    scenarioId: "phase-5-evolution",
    seed,
    startTimeMs: 0,
    maxDurationMs: 1_000_000,
    maxEventCount: 30_000,
    maxIncidentCount: 20,
    initialIncidents: [
      {
        incidentType: "HAZARDOUS_CONDITIONS",
        location: { latitude: 5, longitude: 5 },
        severity: 4,
      },
    ],
    ...overrides,
  };
}

function evolve(type: DisasterType, seed = `seed-${type}`, stepCount = 6): SimulationEngine {
  const engine = new SimulationEngine(config(seed));
  const incidentId = engine.getState().incidents[0]?.id;
  assert.ok(incidentId);
  engine.scheduleEvolution({
    incidentId,
    disasterType: type,
    stepCount,
    stepIntervalMs: 1_000,
    observationProbability: 1,
    maximumSecondaryEvents: 4,
    reportNoise: { duplicateProbability: 0.1, maxFinalReportCount: 20 },
  });
  engine.start();
  engine.runUntilEmpty();
  return engine;
}

describe("deterministic disaster evolution", () => {
  it("replays identical hidden evolution and observations", () => {
    const run = (): string => {
      const engine = evolve("FLOOD", "replay");
      return JSON.stringify({
        environment: engine.getHiddenEnvironmentHistory(),
        infrastructure: engine.getHiddenInfrastructure(),
        cascades: engine.getHiddenCascadeApplications(),
        observations: engine.getPublicObservations(),
      });
    };
    assert.equal(run(), run());
  });

  it("changes deterministic evolution for a different seed", () => {
    assert.notEqual(
      JSON.stringify(evolve("FLOOD", "alpha").getHiddenEnvironmentHistory()),
      JSON.stringify(evolve("FLOOD", "beta").getHiddenEnvironmentHistory()),
    );
  });

  it("models heavy-rain flood growth followed by drainage and recession", () => {
    const engine = evolve("FLOOD");
    const states = engine.getHiddenEnvironmentHistory().map((entry) => entry.state);
    assert.ok((states[2]?.floodwater ?? 0) > (states[0]?.floodwater ?? 0));
    assert.ok((states.at(-1)?.floodwater ?? 1) < (states[2]?.floodwater ?? 0));
    assert.ok(
      engine
        .getHiddenCascadeApplications()
        .some((application) => application.ruleId === "HEAVY_RAIN_INCREASES_FLOODWATER"),
    );
  });

  it("models fire growth, structural damage, and later suppression", () => {
    const states = evolve("URBAN_FIRE").getHiddenEnvironmentHistory().map((entry) => entry.state);
    assert.ok((states[2]?.fire ?? 0) > (states[0]?.fire ?? 0));
    assert.ok((states.at(-1)?.fire ?? 1) < (states[2]?.fire ?? 0));
    assert.ok((states.at(-1)?.structuralDamage ?? 0) >= (states[0]?.structuralDamage ?? 0));
  });

  it("models storm wind changes and power damage", () => {
    const engine = evolve("SEVERE_STORM");
    const states = engine.getHiddenEnvironmentHistory().map((entry) => entry.state);
    assert.ok((states[2]?.wind ?? 0) > (states[0]?.wind ?? 0));
    assert.ok((states.at(-1)?.wind ?? 1) < (states[2]?.wind ?? 0));
    assert.ok(engine.getHiddenInfrastructure().some((item) => item.type === "ELECTRICAL_SUBSTATION" && item.history.length > 0));
  });

  it("creates bounded earthquake secondary collapse incidents", () => {
    const engine = evolve("EARTHQUAKE_AFTERMATH", "quake", 5);
    const origins = engine.getHiddenSecondaryOrigins();
    const secondaryIds = Object.keys(origins);
    assert.ok(secondaryIds.length > 0 && secondaryIds.length <= 4);
    assert.ok(secondaryIds.every((id) => engine.getIncident(id)?.incidentType === "BUILDING_COLLAPSE"));
  });

  it("keeps every environment field normalized", () => {
    for (const type of ["FLOOD", "SEVERE_STORM", "EARTHQUAKE_AFTERMATH", "URBAN_FIRE"] as const) {
      for (const entry of evolve(type, `bounds-${type}`, 4).getHiddenEnvironmentHistory()) {
        for (const value of Object.values(entry.state)) assert.ok(value >= 0 && value <= 1);
      }
    }
  });
});

describe("cascade rules, infrastructure, and observations", () => {
  it("applies flood rules only when their preconditions hold", () => {
    const floodRules = new Set(evolve("FLOOD").getHiddenCascadeApplications().map((item) => item.ruleId));
    const fireRules = new Set(evolve("URBAN_FIRE").getHiddenCascadeApplications().map((item) => item.ruleId));
    assert.ok(floodRules.has("FLOODWATER_CLOSES_ROAD"));
    assert.ok(!fireRules.has("FLOODWATER_CLOSES_ROAD"));
    assert.ok(fireRules.has("FIRE_DAMAGES_NEARBY_STRUCTURE"));
  });

  it("preserves causal event references and bounded cascade depth", () => {
    const engine = new SimulationEngine(config("depth"));
    const incidentId = engine.getState().incidents[0]?.id;
    assert.ok(incidentId);
    engine.scheduleEvolution({ incidentId, disasterType: "FLOOD", stepCount: 8, stepIntervalMs: 100, maximumCascadeDepth: 3, perRuleActivationLimit: 1, observationProbability: 0 });
    engine.start();
    engine.runUntilEmpty();
    const applications = engine.getHiddenCascadeApplications();
    assert.ok(applications.every((item) => item.depth <= 3));
    const counts = new Map<string, number>();
    for (const item of applications) counts.set(item.ruleId, (counts.get(item.ruleId) ?? 0) + 1);
    assert.ok([...counts.values()].every((count) => count <= 1));
    assert.ok(
      engine
        .getHiddenEnvironmentHistory()
        .slice(1)
        .every((entry) => entry.causeEventId !== undefined),
    );
  });

  it("records infrastructure status history with causal rules", () => {
    const infrastructure = evolve("FLOOD").getHiddenInfrastructure();
    const changed = infrastructure.filter((item) => item.history.length > 0);
    assert.ok(changed.length > 0);
    assert.ok(changed.every((item) => item.history.every((entry) => entry.ruleId.length > 0)));
    assert.ok(
      infrastructure.some(
        (item) => item.type === "ROAD" && item.status === "RECOVERING",
      ),
    );
    assert.ok(Object.isFrozen(infrastructure));
  });

  it("emits follow-up reports without leaking hidden evolution truth", () => {
    const engine = evolve("FLOOD", "observed");
    assert.ok(engine.getPublicObservations().length > 0);
    const serialized = JSON.stringify(engine.getPublicObservations());
    for (const forbidden of ["ruleIds", "cascadeDepth", "causeEventId", "environment", "structuralDamage", "electricalAvailability"]) {
      assert.ok(!serialized.includes(forbidden));
    }
    assert.ok(engine.getPrivateReportEvaluations().length > 0);
  });

  it("rejects unsafe plans without mutating current state", () => {
    const engine = new SimulationEngine(config("capacity", { maxEventCount: 3 }));
    const incidentId = engine.getState().incidents[0]?.id;
    assert.ok(incidentId);
    const before = engine.getState();
    assert.throws(
      () => engine.scheduleEvolution({ incidentId, disasterType: "FLOOD", stepCount: 3, stepIntervalMs: 1_000, observationProbability: 1 }),
      SimulationLimitError,
    );
    assert.deepEqual(engine.getState(), before);
    assert.equal(engine.getHiddenEnvironmentHistory().length, 0);
  });

  it("resets hidden evolution and reproduces the same plan", () => {
    const engine = new SimulationEngine(config("reset-evolution"));
    const schedule = (): void => {
      const incidentId = engine.getState().incidents[0]?.id;
      assert.ok(incidentId);
      engine.scheduleEvolution({ incidentId, disasterType: "URBAN_FIRE", stepCount: 4, stepIntervalMs: 1_000, observationProbability: 0 });
      engine.start();
      engine.runUntilEmpty();
    };
    schedule();
    const first = JSON.stringify(engine.getHiddenEnvironmentHistory());
    engine.reset();
    schedule();
    assert.equal(JSON.stringify(engine.getHiddenEnvironmentHistory()), first);
  });

  it("processes a multi-thousand-report run alongside bounded evolution", () => {
    const engine = new SimulationEngine(config("combined-load"));
    const incidentId = engine.getState().incidents[0]?.id;
    assert.ok(incidentId);
    engine.scheduleEvolution({ incidentId, disasterType: "SEVERE_STORM", stepCount: 10, stepIntervalMs: 1_000, observationProbability: 0.5 });
    engine.scheduleReports({ reportCount: 5_000, frequencyMs: 0, noise: { maxFinalReportCount: 10_000 } });
    engine.start();
    engine.runUntilEmpty();
    assert.ok(engine.getReports().length >= 5_000);
    assert.equal(engine.getState().pendingEventCount, 0);
  });
});

