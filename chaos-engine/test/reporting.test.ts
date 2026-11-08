import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  REPORT_CATEGORIES,
  REPORT_SOURCE_TYPES,
  SimulationConfigError,
  SimulationEngine,
  SimulationEventError,
  SimulationLimitError,
  type ReportCategory,
  type ReportSourceType,
  type SimulationConfig,
} from "../src/index.js";

function reportingConfig(seed = "report-seed", overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return {
    scenarioId: "phase-3-reporting",
    seed,
    startTimeMs: 0,
    maxDurationMs: 1_000_000,
    maxEventCount: 20_000,
    maxIncidentCount: 20,
    initialIncidents: [
      {
        incidentType: "STRUCTURE_FIRE",
        location: { latitude: 10, longitude: 10 },
        severity: 4,
      },
      {
        incidentType: "FLOOD",
        location: { latitude: 11, longitude: 11 },
        severity: 6,
      },
      {
        incidentType: "ROAD_OBSTRUCTION",
        location: { latitude: 12, longitude: 12 },
        severity: 3,
      },
    ],
    ...overrides,
  };
}

function generateReports(
  count: number,
  seed = "report-seed",
  overrides: Parameters<SimulationEngine["scheduleReports"]>[0] = { reportCount: count },
): SimulationEngine {
  const engine = new SimulationEngine(reportingConfig(seed));
  engine.scheduleReports({ ...overrides, frequencyMs: overrides.frequencyMs ?? 0 });
  engine.start();
  engine.runUntilEmpty();
  return engine;
}

function onlySource(source: ReportSourceType): Record<ReportSourceType, number> {
  return Object.fromEntries(
    REPORT_SOURCE_TYPES.map((candidate) => [candidate, candidate === source ? 1 : 0]),
  ) as Record<ReportSourceType, number>;
}

describe("emergency report generation", () => {
  it("generates a report for an existing incident through a simulation event", () => {
    const engine = new SimulationEngine(reportingConfig());
    const incidentId = engine.getState().incidents[0]?.id;
    assert.ok(incidentId);

    const events = engine.scheduleReports({
      reportCount: 1,
      incidentIds: [incidentId],
      frequencyMs: 0,
    });
    assert.equal(events[0]?.type, "REPORT_CREATE");
    assert.equal(events[0]?.relatedIncidentId, incidentId);
    assert.equal(engine.getReports().length, 0);

    engine.start();
    engine.runUntilEmpty();
    assert.equal(engine.getReports().length, 1);
    assert.equal(engine.getReports()[0]?.internalIncidentId, incidentId);
  });

  it("creates unique deterministic report IDs", () => {
    const reports = generateReports(200).getReports();
    assert.equal(new Set(reports.map((report) => report.id)).size, 200);
    assert.ok(reports.every((report) => report.id.startsWith("rpt_")));
  });

  it("generates multiple reports per incident and across incidents", () => {
    const engine = generateReports(30);
    const incidentIds = new Set(engine.getState().incidents.map((incident) => incident.id));
    const reports = engine.getReports();

    assert.equal(reports.length, 30);
    assert.ok(reports.every((report) => incidentIds.has(report.internalIncidentId)));
    assert.ok(
      engine.getState().incidents.every(
        (incident) => engine.getReportsForIncident(incident.id).length === 10,
      ),
    );
  });

  it("supports every required report category", () => {
    const engine = generateReports(REPORT_CATEGORIES.length, "categories", {
      reportCount: REPORT_CATEGORIES.length,
      frequencyMs: 0,
      categories: REPORT_CATEGORIES,
    });
    assert.deepEqual(
      new Set(engine.getReports().map((report) => report.category)),
      new Set(REPORT_CATEGORIES),
    );
  });

  it("supports every required source type", () => {
    const engine = new SimulationEngine(reportingConfig("sources"));
    for (const source of REPORT_SOURCE_TYPES) {
      engine.scheduleReports({
        reportCount: 1,
        frequencyMs: 0,
        sourceWeights: onlySource(source),
      });
    }
    engine.start();
    engine.runUntilEmpty();
    assert.deepEqual(
      new Set(engine.getReports().map((report) => report.sourceType)),
      new Set(REPORT_SOURCE_TYPES),
    );
  });

  it("uses category-specific claims that appear in each narrative", () => {
    const engine = generateReports(REPORT_CATEGORIES.length, "claim-content", {
      reportCount: REPORT_CATEGORIES.length,
      frequencyMs: 0,
      categories: REPORT_CATEGORIES,
    });
    for (const report of engine.getReports()) {
      assert.ok(report.claims.length >= 1 && report.claims.length <= 2);
      for (const claim of report.claims) {
        assert.ok(report.narrative.toLowerCase().includes(claim.statement.toLowerCase()));
      }
    }
  });

  it("produces meaningful deterministic narrative diversity", () => {
    const narratives = generateReports(100, "diversity").getReports().map((report) => report.narrative);
    assert.ok(new Set(narratives).size >= 30);
  });

  it("replays identical reports for the same seed and inputs", () => {
    const first = generateReports(50, "repeatable").getPublicObservations();
    const second = generateReports(50, "repeatable").getPublicObservations();
    assert.equal(JSON.stringify(first), JSON.stringify(second));
  });

  it("varies report observations for different seeds", () => {
    const first = generateReports(20, "seed-a").getPublicObservations();
    const second = generateReports(20, "seed-b").getPublicObservations();
    assert.notEqual(JSON.stringify(first), JSON.stringify(second));
    assert.notEqual(first[0]?.narrative, second[0]?.narrative);
  });
});

describe("fictional geography and virtual timestamps", () => {
  it("creates explicitly fictional simulated locations", () => {
    const location = generateReports(1).getReports()[0]?.location;
    assert.ok(location);
    assert.equal(location.fictional, true);
    assert.equal(location.coordinateSystem, "SIMULATED_LOCAL_GRID");
    assert.ok(Number.isSafeInteger(location.x));
    assert.ok(Number.isSafeInteger(location.y));
    assert.match(location.district, /fictional|simulated/i);
    assert.match(location.description, /fictional|simulated/i);
  });

  it("keeps reports for one incident in a coherent geographic cluster", () => {
    const engine = new SimulationEngine(reportingConfig("cluster"));
    const incidentId = engine.getState().incidents[0]?.id;
    assert.ok(incidentId);
    engine.scheduleReports({ reportCount: 100, incidentIds: [incidentId], frequencyMs: 0 });
    engine.start();
    engine.runUntilEmpty();

    const reports = engine.getReportsForIncident(incidentId);
    const first = reports[0]?.location;
    assert.ok(first);
    assert.ok(reports.every((report) => report.location.district === first.district));
    assert.ok(reports.every((report) => report.location.primaryReference === first.primaryReference));
    assert.ok(reports.every((report) => Math.abs(report.location.x - first.x) <= 80));
    assert.ok(reports.every((report) => Math.abs(report.location.y - first.y) <= 80));
  });

  it("accepts explicitly fictional custom geography", () => {
    const engine = new SimulationEngine(reportingConfig("custom-geo"));
    engine.scheduleReports({
      reportCount: 1,
      frequencyMs: 0,
      geography: {
        districts: ["Fictional Test District"],
        roads: ["Simulated Test Road"],
        landmarks: ["Fictional Test Landmark"],
        buildings: ["Fictional Test Building"],
        originX: 100,
        originY: 200,
        clusterRadius: 0,
      },
    });
    engine.start();
    engine.runUntilEmpty();
    const location = engine.getReports()[0]?.location;
    assert.equal(location?.district, "Fictional Test District");
    assert.equal(location?.primaryReference, "Simulated Test Road");
    assert.equal(location?.secondaryReference, "Fictional Test Landmark");
    assert.ok(location !== undefined && location.x >= -4_900 && location.x <= 5_100);
    assert.ok(location !== undefined && location.y >= -4_800 && location.y <= 5_200);
  });

  it("enforces observed, submitted, and received timestamp ordering", () => {
    for (const report of generateReports(200, "timing").getReports()) {
      assert.ok(report.observedAtMs <= report.submittedAtMs);
      assert.ok(report.submittedAtMs <= report.receivedAtMs);
    }
  });

  it("does not expose a report before its received virtual timestamp", () => {
    const engine = new SimulationEngine(reportingConfig("clock-integration"));
    const event = engine.scheduleReports({ reportCount: 1, frequencyMs: 0 })[0];
    assert.ok(event?.type === "REPORT_CREATE");
    engine.start();
    engine.advanceUntil(event.scheduledTimeMs - 1);
    assert.equal(engine.getReports().length, 0);
    engine.advanceUntil(event.scheduledTimeMs);
    assert.equal(engine.getReports().length, 1);
    assert.equal(engine.getState().currentTimeMs, event.scheduledTimeMs);
  });

  it("schedules reports at receivedAt through normal event history", () => {
    const engine = new SimulationEngine(reportingConfig("event-history"));
    const event = engine.scheduleReports({ reportCount: 1, frequencyMs: 0 })[0];
    assert.ok(event?.type === "REPORT_CREATE");
    assert.equal(event.scheduledTimeMs, event.payload.receivedAtMs);
    engine.start();
    engine.runUntilEmpty();
    const record = engine.getState().eventHistory.find((entry) => entry.event.id === event.id);
    assert.equal(record?.processedAtMs, event.payload.receivedAtMs);
    assert.deepEqual(record?.change, {
      kind: "REPORT_CREATED",
      reportId: event.payload.id,
      internalIncidentId: event.relatedIncidentId,
    });
  });
});

describe("public observation boundary", () => {
  it("excludes internal incident IDs and hidden truth", () => {
    const engine = generateReports(5, "projection");
    const internal = engine.getReports()[0];
    const publicObservation = engine.getPublicObservations()[0];
    assert.ok(internal?.internalIncidentId);
    assert.ok(publicObservation);
    assert.ok(!("internalIncidentId" in publicObservation));
    assert.ok(!("severity" in publicObservation));
    assert.ok(!("causeEventId" in publicObservation));
    assert.ok(!JSON.stringify(publicObservation).includes(internal.internalIncidentId));
  });

  it("contains no forbidden keys through nested public structures", () => {
    const publicObservations = generateReports(50, "nested-projection").getPublicObservations();
    const forbidden = new Set([
      "internalIncidentId",
      "incidentId",
      "severity",
      "actualSeverity",
      "causeEventId",
      "reliability",
      "hiddenState",
    ]);

    const inspect = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(inspect);
      } else if (typeof value === "object" && value !== null) {
        for (const [key, nested] of Object.entries(value)) {
          assert.ok(!forbidden.has(key), `forbidden public key: ${key}`);
          inspect(nested);
        }
      }
    };
    inspect(publicObservations);
  });

  it("returns immutable internal reports and public observations", () => {
    const engine = generateReports(1, "immutable-report");
    const report = engine.getReports()[0];
    const observation = engine.getPublicObservations()[0];
    assert.ok(report && observation);
    assert.ok(Object.isFrozen(report));
    assert.ok(Object.isFrozen(report.location));
    assert.ok(Object.isFrozen(report.claims));
    assert.ok(Object.isFrozen(report.claims[0]));
    assert.ok(Object.isFrozen(observation));
    assert.ok(Object.isFrozen(observation.location));
    assert.ok(Object.isFrozen(observation.claims));
    assert.throws(() => {
      (report.claims as unknown as unknown[]).push({});
    }, TypeError);
  });

  it("does not generate personal contact information", () => {
    const narratives = generateReports(1_000, "privacy").getReports().map((report) => report.narrative);
    for (const narrative of narratives) {
      assert.doesNotMatch(narrative, /\b\d{3}[- .]\d{3}[- .]\d{4}\b/);
      assert.doesNotMatch(narrative, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      assert.doesNotMatch(narrative, /\b\d{1,5}\s+[A-Z][a-z]+\s+(Street|Road|Avenue|Lane)\b/);
    }
  });
});

describe("report generation validation and safety", () => {
  it("rejects invalid report volume, frequency, categories, and geography", () => {
    const engine = new SimulationEngine(reportingConfig("invalid-report-config"));
    for (const reportCount of [0, -1, 10_001, 1.5]) {
      assert.throws(() => engine.scheduleReports({ reportCount }), SimulationConfigError);
    }
    assert.throws(
      () => engine.scheduleReports({ reportCount: 1, frequencyMs: -1 }),
      SimulationConfigError,
    );
    assert.throws(
      () =>
        engine.scheduleReports({
          reportCount: 1,
          categories: ["NOT_A_CATEGORY" as ReportCategory],
        }),
      SimulationConfigError,
    );
    assert.throws(
      () =>
        engine.scheduleReports({
          reportCount: 1,
          geography: { districts: ["Unlabeled District"] },
        }),
      SimulationConfigError,
    );
  });

  it("rejects nonexistent incident selection without corrupting state", () => {
    const engine = new SimulationEngine(reportingConfig("missing-incident"));
    const before = engine.getState();
    assert.throws(
      () => engine.scheduleReports({ reportCount: 1, incidentIds: ["inc_missing"] }),
      SimulationEventError,
    );
    assert.deepEqual(engine.getState(), before);
  });

  it("does not consume report or event IDs after rejected configuration", () => {
    const first = new SimulationEngine(reportingConfig("rejection-integrity"));
    const second = new SimulationEngine(reportingConfig("rejection-integrity"));

    assert.throws(
      () => first.scheduleReports({ reportCount: 1, frequencyMs: -1 }),
      SimulationConfigError,
    );
    const firstEvent = first.scheduleReports({ reportCount: 1, frequencyMs: 0 })[0];
    const secondEvent = second.scheduleReports({ reportCount: 1, frequencyMs: 0 })[0];
    assert.equal(firstEvent?.id, secondEvent?.id);
    assert.ok(firstEvent?.type === "REPORT_CREATE" && secondEvent?.type === "REPORT_CREATE");
    assert.equal(firstEvent.payload.id, secondEvent.payload.id);
  });

  it("respects remaining event capacity before report generation", () => {
    const engine = new SimulationEngine(
      reportingConfig("event-limit", {
        maxEventCount: 4,
        initialIncidents: [
          {
            incidentType: "FIRE",
            location: { latitude: 0, longitude: 0 },
            severity: 2,
          },
        ],
      }),
    );
    const before = engine.getState();
    assert.throws(
      () => engine.scheduleReports({ reportCount: 4, frequencyMs: 0 }),
      SimulationLimitError,
    );
    assert.deepEqual(engine.getState(), before);
    engine.scheduleReports({ reportCount: 3, frequencyMs: 0 });
  });

  it("does not consume incident capacity when generating reports", () => {
    const engine = new SimulationEngine(
      reportingConfig("incident-limit", {
        maxIncidentCount: 1,
        initialIncidents: [
          {
            incidentType: "FIRE",
            location: { latitude: 0, longitude: 0 },
            severity: 2,
          },
        ],
      }),
    );
    engine.scheduleReports({ reportCount: 100, frequencyMs: 0 });
    engine.start();
    engine.runUntilEmpty();
    assert.equal(engine.getState().incidents.length, 1);
    assert.equal(engine.getReports().length, 100);
    assert.throws(
      () =>
        engine.scheduleEvent({
          type: "INCIDENT_CREATE",
          scheduledTimeMs: engine.getState().currentTimeMs,
          payload: {
            incidentType: "FLOOD",
            location: { latitude: 1, longitude: 1 },
            severity: 2,
          },
        }),
      SimulationLimitError,
    );
  });
});

