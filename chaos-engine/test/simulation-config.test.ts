import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SimulationConfigError,
  validateSimulationConfig,
  type SimulationConfig,
} from "../src/index.js";

const validConfig: SimulationConfig = {
  scenarioId: "phase-2-test",
  seed: "config-seed",
  startTimeMs: 1_000,
};

describe("simulation configuration", () => {
  it("applies deterministic defaults", () => {
    const config = validateSimulationConfig(validConfig);

    assert.equal(config.maxDurationMs, 7 * 24 * 60 * 60 * 1_000);
    assert.equal(config.maxEventCount, 100_000);
    assert.equal(config.maxIncidentCount, 10_000);
    assert.deepEqual(config.initialIncidents, []);
    assert.ok(Object.isFrozen(config));
  });

  it("rejects malformed required values and unsafe limits", () => {
    const invalidConfigurations: unknown[] = [
      null,
      { ...validConfig, scenarioId: "" },
      { ...validConfig, seed: "" },
      { ...validConfig, startTimeMs: 0.5 },
      { ...validConfig, maxDurationMs: 0 },
      { ...validConfig, maxEventCount: 1_000_001 },
      { ...validConfig, maxIncidentCount: 100_001 },
      { ...validConfig, startTimeMs: Number.MAX_SAFE_INTEGER, maxDurationMs: 1 },
    ];

    for (const config of invalidConfigurations) {
      assert.throws(() => validateSimulationConfig(config), SimulationConfigError);
    }
  });

  it("rejects invalid coordinates and severity", () => {
    assert.throws(
      () =>
        validateSimulationConfig({
          ...validConfig,
          initialIncidents: [
            {
              incidentType: "FIRE",
              location: { latitude: 91, longitude: 0 },
              severity: 5,
            },
          ],
        }),
      SimulationConfigError,
    );
    assert.throws(
      () =>
        validateSimulationConfig({
          ...validConfig,
          initialIncidents: [
            {
              incidentType: "FIRE",
              location: { latitude: 40, longitude: -75 },
              severity: 11,
            },
          ],
        }),
      SimulationConfigError,
    );
  });

  it("rejects duplicate or malformed explicit incident IDs", () => {
    const incident = {
      id: "inc_custom_station_fire",
      incidentType: "FIRE",
      location: { latitude: 40, longitude: -75 },
      severity: 4,
    } as const;

    assert.throws(
      () => validateSimulationConfig({ ...validConfig, initialIncidents: [incident, incident] }),
      /Duplicate initial incident ID/,
    );
    assert.throws(
      () =>
        validateSimulationConfig({
          ...validConfig,
          initialIncidents: [{ ...incident, id: "event-shaped-id" }],
        }),
      SimulationConfigError,
    );
  });
});

