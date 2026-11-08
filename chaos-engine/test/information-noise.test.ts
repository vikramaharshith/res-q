import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  REPORT_SOURCE_TYPES,
  SimulationConfigError,
  SimulationEngine,
  SimulationLimitError,
  type InformationNoiseConfig,
  type ReportSourceType,
  type SimulationConfig,
} from "../src/index.js";

function baseConfig(seed = "noise-seed", overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return {
    scenarioId: "phase-4-noise",
    seed,
    startTimeMs: 0,
    maxDurationMs: 1_000_000,
    maxEventCount: 50_000,
    maxIncidentCount: 10,
    initialIncidents: [
      {
        incidentType: "ROAD_OBSTRUCTION",
        location: { latitude: 1, longitude: 1 },
        severity: 5,
      },
    ],
    ...overrides,
  };
}

const ZERO_NOISE: InformationNoiseConfig = {
  duplicateProbability: 0,
  contradictionProbability: 0,
  missingDetailProbability: 0,
  delayProbability: 0,
  staleProbability: 0,
  locationErrorProbability: 0,
  maxDuplicatesPerOriginal: 0,
  minAdditionalDelayMs: 0,
  maxAdditionalDelayMs: 0,
  maxLocationOffset: 0,
  maxFinalReportCount: 10_000,
};

function disabledExcept(
  enabled: Partial<InformationNoiseConfig>,
): InformationNoiseConfig {
  return { ...ZERO_NOISE, ...enabled };
}

function onlySource(source: ReportSourceType): Record<ReportSourceType, number> {
  return Object.fromEntries(
    REPORT_SOURCE_TYPES.map((candidate) => [candidate, candidate === source ? 1 : 0]),
  ) as Record<ReportSourceType, number>;
}

function completedEngine(
  seed: string,
  reportCount: number,
  noise: InformationNoiseConfig,
  extra: Partial<Parameters<SimulationEngine["scheduleReports"]>[0]> = {},
): SimulationEngine {
  const engine = new SimulationEngine(baseConfig(seed));
  engine.scheduleReports({ reportCount, frequencyMs: 0, noise, ...extra });
  engine.start();
  engine.runUntilEmpty();
  return engine;
}

describe("information noise determinism and compatibility", () => {
  it("replays identical public observations and private annotations", () => {
    const run = (): [string, string] => {
      const engine = completedEngine("noise-replay", 100, {});
      return [
        JSON.stringify(engine.getPublicObservations()),
        JSON.stringify(engine.getPrivateReportEvaluations()),
      ];
    };
    assert.deepEqual(run(), run());
  });

  it("produces meaningful noise differences for different seeds", () => {
    const first = completedEngine("noise-a", 50, {}).getPrivateReportEvaluations();
    const second = completedEngine("noise-b", 50, {}).getPrivateReportEvaluations();
    assert.notEqual(JSON.stringify(first), JSON.stringify(second));
  });

  it("keeps explicit zero-noise output byte-identical to Phase 3 output", () => {
    const phase3 = new SimulationEngine(baseConfig("zero-compatible"));
    const zero = new SimulationEngine(baseConfig("zero-compatible"));
    phase3.scheduleReports({ reportCount: 25, frequencyMs: 0 });
    zero.scheduleReports({ reportCount: 25, frequencyMs: 0, noise: ZERO_NOISE });
    phase3.start();
    zero.start();
    phase3.runUntilEmpty();
    zero.runUntilEmpty();
    assert.equal(
      JSON.stringify(phase3.getPublicObservations()),
      JSON.stringify(zero.getPublicObservations()),
    );
  });
});

describe("duplicates and contradictions", () => {
  it("creates bounded unique duplicates linked only to an original", () => {
    const engine = completedEngine(
      "duplicates",
      20,
      disabledExcept({
        duplicateProbability: 1,
        maxDuplicatesPerOriginal: 2,
        minAdditionalDelayMs: 1,
        maxAdditionalDelayMs: 10,
        maxFinalReportCount: 60,
        probabilityOverrides: { duplicate: true },
      }),
    );
    const reports = engine.getReports();
    const evaluations = engine.getPrivateReportEvaluations();
    const duplicates = evaluations.filter((evaluation) => evaluation.duplicateOfReportId !== undefined);

    assert.ok(reports.length > 20 && reports.length <= 60);
    assert.equal(new Set(reports.map((report) => report.id)).size, reports.length);
    assert.ok(duplicates.length >= 20);
    for (const duplicate of duplicates) {
      const original = engine.getPrivateReportEvaluation(duplicate.duplicateOfReportId ?? "");
      assert.ok(original);
      assert.equal(original.internalIncidentId, duplicate.internalIncidentId);
      assert.equal(original.duplicateFamilyId, duplicate.duplicateFamilyId);
      assert.equal(original.duplicateOfReportId, undefined);
      assert.notEqual(
        engine.getReports().find((report) => report.id === duplicate.reportId)?.narrative,
        engine.getReports().find((report) => report.id === original.reportId)?.narrative,
      );
    }
  });

  it("creates category-appropriate structured contradictions without overwriting originals", () => {
    const engine = completedEngine(
      "contradictions",
      8,
      disabledExcept({
        contradictionProbability: 1,
        probabilityOverrides: { contradiction: true },
      }),
      { categories: ["ROAD_OBSTRUCTION"] },
    );
    const contradictory = engine
      .getPrivateReportEvaluations()
      .find((evaluation) => evaluation.contradictionOfReportId !== undefined);
    assert.ok(contradictory);
    const report = engine.getReports().find((candidate) => candidate.id === contradictory.reportId);
    const original = engine
      .getReports()
      .find((candidate) => candidate.id === contradictory.contradictionOfReportId);
    assert.ok(report && original);
    assert.equal(report.internalIncidentId, original.internalIncidentId);
    assert.equal(report.category, "ROAD_OBSTRUCTION");
    assert.equal(original.category, "ROAD_OBSTRUCTION");
    assert.notEqual(report.claims[0]?.value, original.claims[0]?.value);
    assert.equal(report.claims[0]?.value, "ROAD_PASSABLE");
    assert.notEqual(report.narrative, original.narrative);
  });
});

describe("missing and uncertain information", () => {
  it("keeps omissions, explicit unknowns, and low confidence distinguishable and consistent", () => {
    const engine = completedEngine(
      "missing-modes",
      100,
      disabledExcept({
        missingDetailProbability: 1,
        probabilityOverrides: { missingDetail: true },
      }),
    );
    const evaluations = engine.getPrivateReportEvaluations();
    const omitted = evaluations.filter((evaluation) => evaluation.omittedDetailCodes.length > 0);
    const unknown = evaluations.filter((evaluation) => evaluation.explicitUnknownDetailCodes.length > 0);
    const low = evaluations.filter((evaluation) => evaluation.lowConfidenceClaimCodes.length > 0);
    assert.ok(omitted.length > 0 && unknown.length > 0 && low.length > 0);

    for (const report of engine.getReports()) {
      for (const claim of report.claims) {
        assert.ok(report.narrative.toLowerCase().includes(claim.statement.toLowerCase()));
      }
    }
    for (const evaluation of omitted) {
      const report = engine.getReports().find((candidate) => candidate.id === evaluation.reportId);
      assert.equal(report?.claims.length, 1);
    }
    for (const evaluation of unknown) {
      const report = engine.getReports().find((candidate) => candidate.id === evaluation.reportId);
      assert.ok(report?.claims.some((claim) => claim.detailStatus === "UNKNOWN"));
    }
    for (const evaluation of low) {
      const report = engine.getReports().find((candidate) => candidate.id === evaluation.reportId);
      assert.ok(report?.claims.some((claim) => claim.confidence === "LOW"));
    }
  });
});

describe("delivery order and staleness", () => {
  it("preserves timestamp ordering while allowing older observations to arrive later", () => {
    const engine = completedEngine(
      "out-of-order",
      80,
      disabledExcept({
        delayProbability: 1,
        minAdditionalDelayMs: 0,
        maxAdditionalDelayMs: 200_000,
        probabilityOverrides: { delay: true },
      }),
      { frequencyMs: 1_000 },
    );
    const receivedOrder = engine.getReports();
    assert.ok(
      receivedOrder.some(
        (report, index) =>
          index > 0 && report.observedAtMs < (receivedOrder[index - 1]?.observedAtMs ?? 0),
      ),
    );
    for (const report of receivedOrder) {
      assert.ok(report.observedAtMs <= report.submittedAtMs);
      assert.ok(report.submittedAtMs <= report.receivedAtMs);
    }
  });

  it("keeps future reports invisible at early, exact, and late virtual times", () => {
    const engine = new SimulationEngine(baseConfig("visibility"));
    const events = engine.scheduleReports({
      reportCount: 20,
      frequencyMs: 100,
      noise: disabledExcept({
        delayProbability: 1,
        minAdditionalDelayMs: 10_000,
        maxAdditionalDelayMs: 50_000,
        probabilityOverrides: { delay: true },
      }),
    });
    const times = events.map((event) => event.scheduledTimeMs).sort((a, b) => a - b);
    const first = times[0];
    const middle = times[Math.floor(times.length / 2)];
    assert.ok(first !== undefined && middle !== undefined);
    engine.start();
    engine.advanceUntil(first - 1);
    assert.equal(engine.getPublicObservations().length, 0);
    engine.advanceUntil(first);
    assert.equal(
      engine.getPublicObservations().length,
      times.filter((time) => time <= first).length,
    );
    engine.advanceUntil(middle);
    assert.equal(
      engine.getPublicObservations().length,
      times.filter((time) => time <= middle).length,
    );
    assert.ok(engine.getPublicObservations().length < events.length);
  });

  it("classifies an honest earlier observation as stale only after actual state change", () => {
    const engine = new SimulationEngine(baseConfig("stale-actual"));
    const incidentId = engine.getState().incidents[0]?.id;
    assert.ok(incidentId);
    engine.scheduleReports({
      reportCount: 1,
      incidentIds: [incidentId],
      frequencyMs: 0,
      noise: disabledExcept({
        staleProbability: 1,
        minAdditionalDelayMs: 50_000,
        maxAdditionalDelayMs: 50_000,
        probabilityOverrides: { stale: true },
      }),
    });
    engine.scheduleEvent({
      type: "INCIDENT_ACTIVATE",
      scheduledTimeMs: 1,
      relatedIncidentId: incidentId,
    });
    engine.start();
    engine.runUntilEmpty();
    const evaluation = engine.getPrivateReportEvaluations()[0];
    assert.equal(evaluation?.staleCandidate, true);
    assert.equal(evaluation?.isStale, true);
    assert.equal(evaluation?.observedIncidentState.status, "DETECTED");
    assert.equal(evaluation?.deliveryIncidentState?.status, "ACTIVE");
    assert.equal(evaluation?.truthfulness, "OBSERVATION_AT_TIME");
  });
});

describe("location and source quality", () => {
  it("keeps misleading location offsets bounded and ground truth private", () => {
    const engine = completedEngine(
      "location-noise",
      100,
      disabledExcept({
        locationErrorProbability: 1,
        maxLocationOffset: 75,
        probabilityOverrides: { locationError: true },
      }),
    );
    for (const evaluation of engine.getPrivateReportEvaluations()) {
      const report = engine.getReports().find((candidate) => candidate.id === evaluation.reportId);
      assert.ok(report);
      const { x, y } = evaluation.appliedLocationOffset;
      assert.ok(Math.hypot(x, y) <= 75);
      assert.equal(report.location.x, evaluation.groundTruthLocation.x + x);
      assert.equal(report.location.y, evaluation.groundTruthLocation.y + y);
      assert.equal(report.location.coordinateSystem, "SIMULATED_LOCAL_GRID");
      assert.equal(report.location.precision, "APPROXIMATE");
    }
  });

  it("applies source-specific quality adjustments deterministically", () => {
    const noise = disabledExcept({
      missingDetailProbability: 0.4,
      sourceQualityAdjustments: {
        CIVILIAN_CALLER: { missingDetailMultiplier: 4 },
        EMERGENCY_RESPONDER: { missingDetailMultiplier: 0 },
      },
    });
    const civilian = completedEngine("quality-civilian", 40, noise, {
      sourceWeights: onlySource("CIVILIAN_CALLER"),
    });
    const responder = completedEngine("quality-responder", 40, noise, {
      sourceWeights: onlySource("EMERGENCY_RESPONDER"),
    });
    assert.ok(
      civilian
        .getPrivateReportEvaluations()
        .every((evaluation) =>
          evaluation.transformations.some((item) =>
            ["OMITTED_DETAIL", "EXPLICIT_UNKNOWN", "LOW_CONFIDENCE"].includes(item),
          ),
        ),
    );
    assert.ok(
      responder
        .getPrivateReportEvaluations()
        .every((evaluation) =>
          !evaluation.transformations.some((item) =>
            ["OMITTED_DETAIL", "EXPLICIT_UNKNOWN", "LOW_CONFIDENCE"].includes(item),
          ),
        ),
    );
  });
});

describe("private evaluation boundary and safety", () => {
  it("excludes all private evaluation metadata from nested public observations", () => {
    const engine = completedEngine("private-boundary", 100, {
      probabilityOverrides: {
        duplicate: true,
        contradiction: true,
        missingDetail: true,
        delay: true,
        stale: true,
        locationError: true,
      },
      maxDuplicatesPerOriginal: 1,
      maxFinalReportCount: 200,
    });
    const forbidden = new Set([
      "internalIncidentId",
      "duplicateFamilyId",
      "duplicateOfReportId",
      "contradictionOfReportId",
      "groundTruthLocation",
      "sourceQuality",
      "reliabilityScore",
      "transformations",
      "observedIncidentState",
      "deliveryIncidentState",
    ]);
    const inspect = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(inspect);
      else if (typeof value === "object" && value !== null) {
        for (const [key, nested] of Object.entries(value)) {
          assert.ok(!forbidden.has(key), `private key leaked: ${key}`);
          inspect(nested);
        }
      }
    };
    inspect(engine.getPublicObservations());
    assert.ok(Object.isFrozen(engine.getPublicObservations()));
    assert.ok(Object.isFrozen(engine.getPublicObservations()[0]));
    assert.ok(Object.isFrozen(engine.getPrivateReportEvaluations()[0]));
  });

  it("validates noise probabilities, bounds, and source adjustments", () => {
    const invalid: InformationNoiseConfig[] = [
      { duplicateProbability: -0.1 },
      { contradictionProbability: 1.1 },
      { missingDetailProbability: Number.NaN },
      { minAdditionalDelayMs: 10, maxAdditionalDelayMs: 5 },
      { maxAdditionalDelayMs: 86_400_001 },
      { maxLocationOffset: 10_001 },
      { maxDuplicatesPerOriginal: 6 },
      { maxFinalReportCount: 100_001 },
      { sourceQualityAdjustments: { CIVILIAN_CALLER: { delayMultiplier: 5 } } },
    ];
    for (const noise of invalid) {
      const engine = new SimulationEngine(baseConfig("invalid-noise"));
      assert.throws(
        () => engine.scheduleReports({ reportCount: 1, noise }),
        SimulationConfigError,
      );
    }
  });

  it("enforces worst-case event and final-report limits without state mutation", () => {
    const engine = new SimulationEngine(
      baseConfig("noise-limits", { maxEventCount: 15 }),
    );
    const before = engine.getState();
    assert.throws(
      () =>
        engine.scheduleReports({
          reportCount: 10,
          noise: {
            duplicateProbability: 1,
            maxDuplicatesPerOriginal: 1,
            maxFinalReportCount: 20,
          },
        }),
      SimulationLimitError,
    );
    assert.deepEqual(engine.getState(), before);
    assert.equal(engine.getPrivateReportEvaluations().length, 0);
  });

  it("does not consume deterministic IDs after rejected noisy generation", () => {
    const first = new SimulationEngine(baseConfig("noise-rejection"));
    const second = new SimulationEngine(baseConfig("noise-rejection"));
    assert.throws(
      () =>
        first.scheduleReports({
          reportCount: 1,
          noise: { duplicateProbability: 2 },
        }),
      SimulationConfigError,
    );
    const firstEvent = first.scheduleReports({ reportCount: 1, noise: ZERO_NOISE })[0];
    const secondEvent = second.scheduleReports({ reportCount: 1, noise: ZERO_NOISE })[0];
    assert.equal(firstEvent?.id, secondEvent?.id);
    assert.ok(firstEvent?.type === "REPORT_CREATE" && secondEvent?.type === "REPORT_CREATE");
    assert.equal(firstEvent.payload.id, secondEvent.payload.id);
  });
});

