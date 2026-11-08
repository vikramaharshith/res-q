import { performance } from "node:perf_hooks";

import { SimulationEngine, createPublicSimulationExport, serializePublicSimulationExport, validatePublicSimulationExport } from "../src/index.js";

for (const reportCount of [100, 1_000, 5_000, 10_000]) {
  const engine = new SimulationEngine({ scenarioId: `phase-7a-benchmark-${reportCount}`, seed: `export-${reportCount}`, startTimeMs: 0, maxEventCount: reportCount + 1, initialIncidents: [{ incidentType: "FICTIONAL_BENCHMARK", location: { latitude: 0, longitude: 0 }, severity: 1 }] });
  engine.start(); engine.runUntilEmpty(); engine.scheduleReports({ reportCount, frequencyMs: 0 }); engine.start(); engine.runUntilEmpty();
  const exportStart = performance.now(); const document = createPublicSimulationExport(engine); const exportDurationMs = performance.now() - exportStart;
  const validationStart = performance.now(); const validation = validatePublicSimulationExport(document); const validationDurationMs = performance.now() - validationStart;
  const serializationStart = performance.now(); const json = serializePublicSimulationExport(document); const serializationDurationMs = performance.now() - serializationStart;
  if (!validation.valid) throw new Error(`Validation failed for ${reportCount} reports.`);
  console.log(JSON.stringify({ reportCount, exportDurationMs: round(exportDurationMs), validationDurationMs: round(validationDurationMs), serializationDurationMs: round(serializationDurationMs), utf8Bytes: Buffer.byteLength(json, "utf8") }));
}

function round(value: number): number { return Math.round(value * 100) / 100; }
