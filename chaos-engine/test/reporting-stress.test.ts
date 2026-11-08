import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SimulationEngine, type SimulationConfig } from "../src/index.js";

function stressRun(reportCount: number): void {
  const initialIncidents = Array.from({ length: 10 }, (_, index) => ({
    incidentType: index % 2 === 0 ? "FLOOD" : "STRUCTURE_FIRE",
    location: { latitude: 20 + index / 10, longitude: 30 + index / 10 },
    severity: (index % 10) + 1,
  }));
  const config: SimulationConfig = {
    scenarioId: `stress-${reportCount}`,
    seed: `stress-seed-${reportCount}`,
    startTimeMs: 0,
    maxDurationMs: 500_000,
    maxEventCount: reportCount + initialIncidents.length,
    maxIncidentCount: initialIncidents.length,
    initialIncidents,
  };
  const engine = new SimulationEngine(config);
  const events = engine.scheduleReports({ reportCount, frequencyMs: 0 });
  assert.equal(events.length, reportCount);
  engine.start();
  const state = engine.runUntilEmpty();
  assert.equal(state.reports.length, reportCount);
  assert.equal(engine.getPublicObservations().length, reportCount);
  assert.equal(state.pendingEventCount, 0);
  assert.equal(state.processedEventCount, reportCount + initialIncidents.length);
  assert.equal(new Set(state.reports.map((report) => report.id)).size, reportCount);
}

describe("report generation volume", () => {
  it("processes 100 reports", () => stressRun(100));
  it("processes 1,000 reports", () => stressRun(1_000));
  it("processes 5,000 reports", () => stressRun(5_000));
  it("processes 10,000 reports", () => stressRun(10_000));
});

