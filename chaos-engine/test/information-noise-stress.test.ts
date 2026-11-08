import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SimulationEngine, type SimulationConfig } from "../src/index.js";

function noisyStress(baseReportCount: number): void {
  const incidents = Array.from({ length: 10 }, (_, index) => ({
    incidentType: index % 2 === 0 ? "FLOOD" : "POWER_OUTAGE",
    location: { latitude: 30 + index / 10, longitude: 40 + index / 10 },
    severity: (index % 10) + 1,
  }));
  const config: SimulationConfig = {
    scenarioId: `noisy-stress-${baseReportCount}`,
    seed: `noisy-stress-seed-${baseReportCount}`,
    startTimeMs: 0,
    maxDurationMs: 1_000_000,
    maxEventCount: baseReportCount * 2 + incidents.length,
    maxIncidentCount: incidents.length,
    initialIncidents: incidents,
  };
  const engine = new SimulationEngine(config);
  const events = engine.scheduleReports({
    reportCount: baseReportCount,
    frequencyMs: 0,
    noise: { maxFinalReportCount: baseReportCount * 2 },
  });
  assert.ok(events.length >= baseReportCount && events.length <= baseReportCount * 2);
  engine.start();
  engine.runUntilEmpty();
  assert.equal(engine.getReports().length, events.length);
  assert.equal(engine.getPublicObservations().length, events.length);
  assert.equal(engine.getPrivateReportEvaluations().length, events.length);
  assert.equal(new Set(engine.getReports().map((report) => report.id)).size, events.length);
}

describe("noisy report workload", () => {
  it("processes 100 base reports plus bounded duplicates", () => noisyStress(100));
  it("processes 1,000 base reports plus bounded duplicates", () => noisyStress(1_000));
  it("processes 5,000 base reports plus bounded duplicates", () => noisyStress(5_000));
  it("processes 10,000 base reports plus bounded duplicates", () => noisyStress(10_000));
});

