import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assembleChaosSimulation,
  CHAOS_SAMPLE_COUNTS,
  CHAOS_SAMPLE_DIGEST_HEX,
  CHAOS_SAMPLE_IMPORT_RUN_ID,
  CHAOS_SAMPLE_RUN_ID,
  CHAOS_SAMPLE_SOURCE_SCENARIO_ID,
  ChaosReadError,
  formatGridNumber,
  gridPlotInputs,
  localGridFrames,
  type ChaosSampleRows,
} from "@/lib/chaos/read-model";
import {
  SAMPLE_CHAOS_DIGEST_HEX,
  SAMPLE_CHAOS_RUN_ID,
  SAMPLE_CHAOS_SOURCE_SCENARIO_ID,
} from "@/lib/simulation-import/chaos-import";
import { MemoryImportLedger } from "@/lib/simulation-import/ledger";
import { MemoryStagingStore, stageValidatedChaosText } from "@/lib/simulation-import/stage-plan";

const sampleText = readFileSync(new URL("../../../resq-handoff/sample-simulation.json", import.meta.url), "utf8");
const sampleDocument = JSON.parse(sampleText) as {
  emergencyObservations: { narrative: string; reportId: string }[];
};

function sampleRows(): ChaosSampleRows {
  const staged = stageValidatedChaosText(
    sampleText,
    "scn_chaos_sample",
    new MemoryStagingStore(),
    new MemoryImportLedger(),
  );
  assert.equal(staged.ok, true);
  if (!staged.ok) throw new Error("sample did not stage");
  return {
    run: staged.plan.run,
    emergencyObservations: staged.plan.emergencyObservations,
    operationalObservations: staged.plan.operationalObservations,
    units: staged.plan.units,
    publicAssignments: staged.plan.chaosPublicAssignments,
  };
}

function stringifyNumbers(value: unknown): unknown {
  if (typeof value === "number") return value.toString();
  if (Array.isArray(value)) return value.map(stringifyNumbers);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stringifyNumbers(item)]));
  }
  return value;
}

test("the dashboard sample identity matches the staged two-report import", () => {
  assert.equal(CHAOS_SAMPLE_IMPORT_RUN_ID, `cimp_run_${SAMPLE_CHAOS_DIGEST_HEX.slice(0, 32)}`);
  assert.equal(CHAOS_SAMPLE_IMPORT_RUN_ID, "cimp_run_dd07bf2c2799731bd1ef2054766b605d");
  assert.equal(CHAOS_SAMPLE_RUN_ID, SAMPLE_CHAOS_RUN_ID);
  assert.equal(CHAOS_SAMPLE_DIGEST_HEX, SAMPLE_CHAOS_DIGEST_HEX);
  assert.equal(CHAOS_SAMPLE_SOURCE_SCENARIO_ID, SAMPLE_CHAOS_SOURCE_SCENARIO_ID);
  assert.deepEqual(CHAOS_SAMPLE_COUNTS, { emergency: 2, operational: 7, units: 1, assignments: 1 });
});

test("the sample board keeps both reports, the unit, and the public assignment separate", () => {
  const board = assembleChaosSimulation(sampleRows());
  assert.equal(board.kind, "chaos-simulation");
  assert.equal(board.fictional, true);
  assert.equal(board.importRunId, CHAOS_SAMPLE_IMPORT_RUN_ID);
  assert.equal(board.sourceLabel, "Fictional Urban Flood exercise");
  assert.equal(board.emergencyObservations.length, 2);
  assert.equal(board.operationalObservations.length, 7);
  assert.equal(board.units.length, 1);
  assert.equal(board.publicAssignments.length, 1);
  assert.equal(board.emergencyObservations[0]?.reportId, sampleDocument.emergencyObservations[0]?.reportId);
  assert.equal(board.emergencyObservations[1]?.reportId, sampleDocument.emergencyObservations[1]?.reportId);
  assert.notEqual(board.emergencyObservations[0]?.reportId, board.emergencyObservations[1]?.reportId);
  assert.equal(board.emergencyObservations[0]?.narrative, sampleDocument.emergencyObservations[0]?.narrative);
  assert.equal(board.emergencyObservations[1]?.narrative, sampleDocument.emergencyObservations[1]?.narrative);
  assert.equal(board.emergencyObservations[0]?.location.x, 47588);
  assert.equal(board.emergencyObservations[0]?.location.y, 46344);
  assert.equal(board.emergencyObservations[0]?.location.xText, "47588");
  assert.equal(board.emergencyObservations[0]?.location.yText, "46344");
  assert.equal(board.emergencyObservations[1]?.location.x, 47596);
  assert.equal(board.emergencyObservations[1]?.location.y, 46368);
  assert.equal(board.emergencyObservations[0]?.location.coordinateSystem, "SIMULATED_LOCAL_GRID");
  assert.equal(board.emergencyObservations[0]?.status, "RECEIVED");
  assert.equal(board.units[0]?.callsign, "CLI-0001");
  assert.equal(board.units[0]?.unitId, "unit_000001");
  assert.equal(board.units[0]?.location?.x, 80);
  assert.equal(board.units[0]?.location?.y, 0);
  assert.equal("capabilities" in (board.units[0] ?? {}), false);
  assert.deepEqual(Object.keys(board.publicAssignments[0] ?? {}).sort(), ["assignmentId", "firstReceivedAt", "unitId"]);
  assert.equal(board.publicAssignments[0]?.assignmentId, "assignment_000001");
  assert.equal(board.publicAssignments[0]?.unitId, "unit_000001");
  assert.equal("incidentId" in (board.publicAssignments[0] ?? {}), false);
  assert.equal("incidents" in board, false);
  assert.deepEqual(
    board.operationalObservations.map((item) => item.fatigueText),
    ["5", null, null, "5.084356", "5.584439", "5.584439", "4.251106"],
  );
  assert.equal(board.operationalObservations[1]?.location, null);
  assert.deepEqual(board.operationalObservations[0]?.inventory, [
    { name: "radio", quantity: 1 },
    { name: "rescue_rope", quantity: 3 },
  ]);
  const serialized = JSON.stringify(board);
  assert.equal(serialized.includes("resq-handoff-sample"), false);
  assert.equal(serialized.includes("latitude"), false);
  assert.equal(serialized.includes("longitude"), false);
  assert.equal(serialized.includes("capabilities"), false);
  assert.equal(serialized.includes("incidentId"), false);
  assert.equal(serialized.includes("nemotron"), false);
});

test("numeric database strings keep the same grid text", () => {
  const rows = sampleRows();
  const board = assembleChaosSimulation({
    run: stringifyNumbers(rows.run),
    emergencyObservations: stringifyNumbers(rows.emergencyObservations),
    operationalObservations: stringifyNumbers(rows.operationalObservations),
    units: stringifyNumbers(rows.units),
    publicAssignments: stringifyNumbers(rows.publicAssignments),
  });
  assert.equal(board.emergencyObservations[0]?.location.xText, "47588");
  assert.equal(board.emergencyObservations[0]?.location.yText, "46344");
  assert.equal(board.operationalObservations[3]?.fatigueText, "5.084356");
  assert.equal(board.units[0]?.location?.description, "Fictional destination: Fictional Urban Flood district");
});

test("a geographic field, the demo scenario, or a changed digest is refused", () => {
  const rows = sampleRows();
  const emergency = rows.emergencyObservations;
  assert.ok(Array.isArray(emergency));
  const withLatitude = emergency.map((row, index) => (index === 0 ? { ...(row as object), latitude: 41.8 } : row));
  assert.throws(() => assembleChaosSimulation({ ...rows, emergencyObservations: withLatitude }), ChaosReadError);

  const run = { ...(rows.run as object), source_scenario_id: "scn_demo_flood" };
  assert.throws(() => assembleChaosSimulation({ ...rows, run }), ChaosReadError);

  const digest = { ...(rows.run as object), digest_hex: "ab".repeat(32) };
  assert.throws(() => assembleChaosSimulation({ ...rows, run: digest }), ChaosReadError);
});

test("the fictional grid uses x and y, with tighter frames for nearby points", () => {
  const board = assembleChaosSimulation(sampleRows());
  const points = gridPlotInputs(board);
  assert.equal(points.length, 5);
  const frames = localGridFrames(points);
  assert.equal(frames.length, 3);
  const overview = frames[0];
  assert.ok(overview);
  const emergency = overview.plot.points.find((point) => point.kind === "emergency");
  const origin = overview.plot.points.find((point) => point.x === 0 && point.y === 0);
  assert.ok(emergency && origin);
  assert.ok(emergency.top < origin.top);
  assert.ok(emergency.left > origin.left);
  assert.equal(formatGridNumber(overview.plot.xMin), "0");
  assert.equal(formatGridNumber(overview.plot.yMax), "46368");

  const reportFrame = frames.find((frame) => frame.plot.points.length === 2 && frame.plot.points.every((point) => point.kind === "emergency"));
  assert.ok(reportFrame);
  const [first, second] = reportFrame.plot.points;
  assert.ok(first && second);
  assert.ok(Math.abs(first.left - second.left) > 5);
  assert.ok(Math.abs(first.top - second.top) > 5);

  const baseFrame = frames.find(
    (frame) => frame.id !== "overview" && frame.plot.points.some((point) => point.kind === "unit"),
  );
  assert.ok(baseFrame);
  const baseOrigin = baseFrame.plot.points.find((point) => point.x === 0);
  const baseDestination = baseFrame.plot.points.find((point) => point.x === 80);
  assert.ok(baseOrigin && baseDestination);
  assert.ok(Math.abs(baseOrigin.left - baseDestination.left) > 5);
});

test("the Chaos dashboard reads staged rows and leaves the flood command center in place", () => {
  const loader = readFileSync(new URL("./load-chaos-simulation.ts", import.meta.url), "utf8");
  const dashboard = readFileSync(new URL("../dashboard/load-dashboard.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../../app/page.tsx", import.meta.url), "utf8");
  const commandCenter = readFileSync(new URL("../../components/dashboard/CommandCenter.tsx", import.meta.url), "utf8");
  const header = readFileSync(new URL("../../components/dashboard/CommandHeader.tsx", import.meta.url), "utf8");
  const chaosUi = [
    readFileSync(new URL("../../components/chaos/ChaosCommandCenter.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../../components/chaos/ChaosInvestigation.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../../components/chaos/LocalGridMap.tsx", import.meta.url), "utf8"),
  ].join("\n");
  const intro = readFileSync(new URL("../../components/intro/StartupIntro.tsx", import.meta.url), "utf8");

  assert.match(loader, /\.from\("chaos_import_runs"\)/);
  assert.match(loader, /\.from\("chaos_emergency_observations"\)/);
  assert.match(loader, /\.from\("chaos_operational_observations"\)/);
  assert.match(loader, /\.from\("chaos_units"\)/);
  assert.match(loader, /\.from\("chaos_public_assignments"\)/);
  assert.match(loader, /\.select\(/);
  assert.doesNotMatch(loader, /\.(insert|update|delete|upsert|rpc)\s*\(/);
  assert.equal(loader.includes("stage_chaos_import"), false);
  assert.equal(loader.includes("source_seed"), false);
  assert.equal(loader.includes("apply_human_decision"), false);

  const chaosBranch = dashboard.indexOf('selection === "chaos"');
  const floodLoad = dashboard.lastIndexOf("loadCommandScenario()");
  assert.ok(chaosBranch >= 0 && floodLoad > chaosBranch);
  assert.equal(dashboard.includes("loadStoredHistory"), true);
  assert.equal(dashboard.includes(".insert("), false);

  assert.equal(page.includes("loadDashboard"), true);
  assert.equal(page.includes("ChaosCommandCenter"), true);
  assert.equal(page.includes("approvalsOptIn={process.env.RESQ_LOCAL_APPROVALS === \"1\"}"), true);
  assert.equal(page.includes("stage_chaos_import"), false);

  assert.equal(commandCenter.includes("OpenStreetMap"), true);
  assert.equal(commandCenter.includes("IncidentMap"), true);
  assert.equal(commandCenter.includes("loadChaosSimulation"), false);
  assert.equal(commandCenter.includes("data-local-grid"), false);
  assert.equal(header.includes('active="flood"'), true);

  assert.equal(chaosUi.includes("Fictional simulation"), true);
  assert.equal(chaosUi.includes("data-local-grid"), true);
  assert.equal(chaosUi.includes("StartupIntro"), true);
  assert.equal(chaosUi.includes("leaflet"), false);
  assert.equal(chaosUi.includes("OpenStreetMap"), false);
  assert.equal(chaosUi.includes("/api/chaos-investigation"), true);
  assert.equal(chaosUi.includes("/api/agent-runs"), false);
  assert.equal(chaosUi.includes("/api/approvals"), false);
  assert.equal(chaosUi.includes("/api/command-state"), false);
  assert.equal(chaosUi.includes("ApprovalControls"), false);
  assert.equal(chaosUi.includes("apply_human_decision"), false);

  assert.equal(intro.includes("leaflet-container"), true);
  assert.equal(intro.includes("data-local-grid"), true);
});
