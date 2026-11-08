import { performance } from "node:perf_hooks";
import {
  CLI_DIFFICULTIES,
  createPublicSimulationExport,
  runCliSimulation,
  serializePublicSimulationExport,
  validatePublicSimulationExport,
  type PublicExportDifficulty,
} from "../src/index.js";

for (const difficulty of Object.keys(CLI_DIFFICULTIES) as PublicExportDifficulty[]) {
  const preset = CLI_DIFFICULTIES[difficulty];
  const before = process.memoryUsage();
  const result = runCliSimulation({
    scenario: "flood",
    difficulty,
    seed: "phase7c-benchmark",
    reportCount: preset.reports,
    responderCount: preset.responders,
    durationMs: 3 * 24 * 60 * 60 * 1_000,
  });

  const exportStart = performance.now();
  const document = createPublicSimulationExport(result.engine, {
    difficulty,
    scenarioLabel: result.document.scenario.label,
    ...(result.document.replayManifest === null
      ? {}
      : { replayManifest: result.document.replayManifest }),
  });
  const exportDurationMs = performance.now() - exportStart;

  const validationStart = performance.now();
  const validation = validatePublicSimulationExport(document);
  const validationDurationMs = performance.now() - validationStart;

  const serializationStart = performance.now();
  const json = serializePublicSimulationExport(document);
  const serializationDurationMs = performance.now() - serializationStart;

  if (!validation.valid) {
    throw new Error(`${difficulty} export validation failed.`);
  }

  const after = process.memoryUsage();
  console.log(
    JSON.stringify({
      difficulty,
      executionDurationMs: result.executionDurationMs,
      baseReportCount: result.baseReports,
      finalReportCount: result.metrics.reports,
      duplicateReportCount: result.duplicateReports,
      responderCount: result.metrics.responders,
      taskCount: result.metrics.tasks,
      assignedTaskCount: result.metrics.assigned,
      completedTaskCount: result.metrics.completed,
      failedTaskCount: result.metrics.failed,
      pendingTaskCount: result.metrics.pending,
      resourceShortageCount: result.metrics.shortages,
      cascadeCount: result.metrics.cascades,
      processedEventCount: result.metrics.processedEvents,
      peakQueueSize: result.metrics.peakQueue,
      rssBeforeBytes: before.rss,
      rssAfterBytes: after.rss,
      heapUsedBeforeBytes: before.heapUsed,
      heapUsedAfterBytes: after.heapUsed,
      processMaxRssKiB: process.resourceUsage().maxRSS,
      exportDurationMs: round(exportDurationMs),
      validationDurationMs: round(validationDurationMs),
      serializationDurationMs: round(serializationDurationMs),
      jsonBytes: Buffer.byteLength(json),
    }),
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
