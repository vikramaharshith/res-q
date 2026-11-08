import {
  AVAILABILITY_STATES,
  COMMUNICATION_STATES,
  CONFIDENCE_LEVELS,
  DETAIL_STATUSES,
  ENGINE_VERSION,
  EQUIPMENT_CONDITIONS,
  EXPORT_DIFFICULTIES,
  FORBIDDEN_SIMULATION_KEYS,
  LOCATION_PRECISIONS,
  OBSERVATION_SOURCES,
  OBSERVATION_STAGES,
  OPERATIONAL_MESSAGE_TYPES,
  REPORT_CATEGORIES,
  REPORT_SOURCE_TYPES,
  SCHEMA_VERSION,
  SIMULATION_STATUSES,
  SOURCE_CHANNELS,
  TASK_STATUSES,
  TRAVEL_STATUSES,
  URGENCY_LEVELS,
} from "@/lib/simulation-import/types";

/**
 * Read model for the confirmed two-report Chaos sample.
 * Grid values stay x/y. This module does not open a database connection.
 */

export const CHAOS_SAMPLE_IMPORT_RUN_ID = "cimp_run_dd07bf2c2799731bd1ef2054766b605d";
export const CHAOS_SAMPLE_RUN_ID = "run_19kluv9nadmt1";
export const CHAOS_SAMPLE_DIGEST_HEX =
  "dd07bf2c2799731bd1ef2054766b605ddc020c3a00f165fdbce003b5825f862f";
export const CHAOS_SAMPLE_SOURCE_SCENARIO_ID = "cli-flood-v1";
export const CHAOS_SAMPLE_COUNTS = {
  emergency: 2,
  operational: 7,
  units: 1,
  assignments: 1,
} as const;

const GRID_MIN = -1_000_000;
const GRID_MAX = 1_000_000;
const GRID_PAD = 12;
const TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
const PUBLIC_ID = /^[A-Za-z0-9_-]{1,200}$/;

const FORBIDDEN_KEYS = new Set<string>(FORBIDDEN_SIMULATION_KEYS);
const GEO_KEYS = new Set(["latitude", "longitude", "lat", "lon", "latlng", "lng"]);

export class ChaosReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChaosReadError";
  }
}

export interface ChaosGridPoint {
  readonly fictional: true;
  readonly coordinateSystem: "SIMULATED_LOCAL_GRID";
  readonly x: number;
  readonly y: number;
  readonly xText: string;
  readonly yText: string;
  readonly district: string | null;
  readonly primaryReference: string | null;
  readonly secondaryReference: string | null;
  readonly description: string;
  readonly precision: string | null;
}

export interface ChaosClaimView {
  readonly code: string;
  readonly statement: string;
  readonly stage: string;
  readonly assistanceRequested: boolean;
  readonly value: string | null;
  readonly confidence: string | null;
  readonly detailStatus: string | null;
}

export interface ChaosSourceView {
  readonly channel: string;
  readonly organizationLabel: string | null;
  readonly sensorKind: string | null;
}

export interface ChaosEmergencyView {
  readonly reportId: string;
  readonly category: string;
  readonly sourceType: string;
  readonly observedAt: string;
  readonly submittedAt: string;
  readonly receivedAt: string;
  readonly narrative: string;
  readonly claims: readonly ChaosClaimView[];
  readonly status: "RECEIVED";
  readonly urgency: string | null;
  readonly sourceMetadata: ChaosSourceView | null;
  readonly location: ChaosGridPoint;
}

export interface ChaosInventoryItem {
  readonly name: string;
  readonly quantity: number;
}

export interface ChaosOperationalView {
  readonly observationId: string;
  readonly unitId: string;
  readonly assignmentId: string | null;
  readonly messageType: string;
  readonly observedAt: string;
  readonly submittedAt: string;
  readonly receivedAt: string;
  readonly source: string;
  readonly deliveryStatus: "DELIVERED";
  readonly availabilityState: string | null;
  readonly taskStatus: string | null;
  readonly travelStatus: string | null;
  readonly communicationState: string | null;
  readonly location: ChaosGridPoint | null;
  readonly routeVersion: number | null;
  readonly fatigueText: string | null;
  readonly equipmentItem: string | null;
  readonly equipmentCondition: string | null;
  readonly inventory: readonly ChaosInventoryItem[] | null;
}

export interface ChaosUnitView {
  readonly unitId: string;
  readonly callsign: string;
  readonly latestObservedAt: string;
  readonly latestReceivedAt: string;
  readonly availabilityState: string | null;
  readonly assignmentId: string | null;
  readonly taskStatus: string | null;
  readonly travelStatus: string | null;
  readonly communicationState: string | null;
  readonly location: ChaosGridPoint | null;
}

export interface ChaosPublicAssignmentView {
  readonly assignmentId: string;
  readonly unitId: string;
  readonly firstReceivedAt: string;
}

export interface ChaosSimulationBoard {
  readonly kind: "chaos-simulation";
  readonly fictional: true;
  readonly importRunId: string;
  readonly runId: string;
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly engineVersion: typeof ENGINE_VERSION;
  readonly sourceScenarioId: string;
  readonly sourceLabel: string;
  readonly difficulty: string | null;
  readonly simulationStart: string;
  readonly simulationExport: string;
  readonly simulationStatus: string;
  readonly emergencyObservations: readonly ChaosEmergencyView[];
  readonly operationalObservations: readonly ChaosOperationalView[];
  readonly units: readonly ChaosUnitView[];
  readonly publicAssignments: readonly ChaosPublicAssignmentView[];
}

export type ChaosDashboardLoad =
  | { readonly ok: true; readonly board: ChaosSimulationBoard }
  | { readonly ok: false; readonly message: string };

export interface ChaosSampleRows {
  readonly run: unknown;
  readonly emergencyObservations: unknown;
  readonly operationalObservations: unknown;
  readonly units: unknown;
  readonly publicAssignments: unknown;
}

export interface GridPlotInput {
  readonly id: string;
  readonly kind: "emergency" | "operational" | "unit";
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly xText: string;
  readonly yText: string;
}

export interface PlottedPoint extends GridPlotInput {
  readonly left: number;
  readonly top: number;
}

export interface LocalGridPlot {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
  readonly points: readonly PlottedPoint[];
}

export interface LocalGridFrame {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly plot: LocalGridPlot;
}

function fail(message: string): never {
  throw new ChaosReadError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isUnsafeKey(key: string): boolean {
  if (FORBIDDEN_KEYS.has(key)) return true;
  if (GEO_KEYS.has(key.toLowerCase())) return true;
  return key === "capabilities" || key === "incident_id" || key === "incidentId";
}

function scanUnsafe(value: unknown, depth = 0): void {
  if (depth > 8) fail("The staged Chaos sample is too nested to show");
  if (Array.isArray(value)) {
    for (const item of value) scanUnsafe(item, depth + 1);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (isUnsafeKey(key)) fail("The staged Chaos sample includes a field this view cannot show");
    scanUnsafe(item, depth + 1);
  }
}

function asJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    fail("A public JSON field could not be read");
  }
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(record);
  return present.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(record, key));
}

function requireText(value: unknown, min: number, max: number): string {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    fail("A public text field could not be read");
  }
  return value;
}

function optionalText(value: unknown, max: number): string | null {
  if (value == null) return null;
  return requireText(value, 1, max);
}

function requireId(value: unknown): string {
  if (typeof value !== "string" || !PUBLIC_ID.test(value)) fail("A public identifier could not be read");
  return value;
}

function requireTimestamp(value: unknown): string {
  if (typeof value !== "string" || !TIMESTAMP.test(value)) fail("A virtual timestamp could not be read");
  return value;
}

function oneOf(value: unknown, allowed: readonly string[]): string {
  if (typeof value !== "string" || !allowed.includes(value)) {
    fail("A public field is outside the staged sample");
  }
  return value;
}

function oneOfOrNull(value: unknown, allowed: readonly string[]): string | null {
  if (value == null) return null;
  return oneOf(value, allowed);
}

function readInteger(value: unknown, min: number, max: number): number {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^-?(?:0|[1-9][0-9]*)$/.test(text)) fail("A public count could not be read");
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    fail("A public count could not be read");
  }
  return number;
}

function readDecimal(value: unknown, min: number, max: number): { text: string; number: number } {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < min || value > max) fail("A fictional grid value could not be read");
    const text = Object.is(value, -0) ? "0" : value.toString();
    if (/e/i.test(text)) fail("A fictional grid value could not be read");
    return { text, number: value };
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(text)) fail("A fictional grid value could not be read");
    const number = Number(text);
    if (!Number.isFinite(number) || number < min || number > max) fail("A fictional grid value could not be read");
    return { text, number };
  }
  fail("A fictional grid value could not be read");
}

function readGrid(row: Record<string, unknown>, required: boolean): ChaosGridPoint | null {
  const empty =
    row.fictional == null &&
    row.coordinate_system == null &&
    row.grid_x == null &&
    row.grid_y == null &&
    row.description == null &&
    row.district == null &&
    row.primary_reference == null &&
    row.secondary_reference == null &&
    row.precision == null;
  if (empty) {
    if (required) fail("A fictional grid location is missing");
    return null;
  }
  if (row.fictional !== true || row.coordinate_system !== "SIMULATED_LOCAL_GRID") {
    fail("A location is not on the simulated local grid");
  }
  const x = readDecimal(row.grid_x, GRID_MIN, GRID_MAX);
  const y = readDecimal(row.grid_y, GRID_MIN, GRID_MAX);
  return {
    fictional: true,
    coordinateSystem: "SIMULATED_LOCAL_GRID",
    x: x.number,
    y: y.number,
    xText: x.text,
    yText: y.text,
    district: optionalText(row.district, 2000),
    primaryReference: optionalText(row.primary_reference, 2000),
    secondaryReference: optionalText(row.secondary_reference, 2000),
    description: requireText(row.description, 1, 4000),
    precision: oneOfOrNull(row.precision, LOCATION_PRECISIONS),
  };
}

function readClaims(value: unknown): ChaosClaimView[] {
  const parsed = asJson(value);
  if (!Array.isArray(parsed)) fail("Emergency claims are missing");
  return parsed.map((item) => {
    if (!isRecord(item) || !exactKeys(item, ["assistanceRequested", "code", "confidence", "detailStatus", "stage", "statement", "value"])) {
      fail("An emergency claim does not match the public fields");
    }
    if (typeof item.assistanceRequested !== "boolean") fail("An emergency claim does not match the public fields");
    return {
      code: requireText(item.code, 1, 200),
      statement: requireText(item.statement, 1, 4000),
      stage: oneOf(item.stage, OBSERVATION_STAGES),
      assistanceRequested: item.assistanceRequested,
      value: item.value === null ? null : requireText(item.value, 1, 2000),
      confidence: oneOfOrNull(item.confidence, CONFIDENCE_LEVELS),
      detailStatus: oneOfOrNull(item.detailStatus, DETAIL_STATUSES),
    };
  });
}

function readMetadata(value: unknown): ChaosSourceView | null {
  const parsed = asJson(value);
  if (parsed == null) return null;
  if (!isRecord(parsed) || !exactKeys(parsed, ["channel", "organizationLabel", "sensorKind"])) {
    fail("Source metadata does not match the public fields");
  }
  return {
    channel: oneOf(parsed.channel, SOURCE_CHANNELS),
    organizationLabel: optionalText(parsed.organizationLabel, 2000),
    sensorKind: optionalText(parsed.sensorKind, 2000),
  };
}

function readInventory(value: unknown): ChaosInventoryItem[] | null {
  const parsed = asJson(value);
  if (parsed == null) return null;
  if (!isRecord(parsed)) fail("Inventory does not match the public fields");
  return Object.entries(parsed).map(([name, quantity]) => {
    if (isUnsafeKey(name) || name.length < 1 || name.length > 2000) {
      fail("Inventory does not match the public fields");
    }
    return { name, quantity: readInteger(quantity, 0, 10_000) };
  });
}

function requireRows(value: unknown, expected: number): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length !== expected) {
    fail("The staged Chaos sample does not match the confirmed import");
  }
  return value.map((item) => {
    if (!isRecord(item)) fail("The staged Chaos sample does not match the confirmed import");
    scanUnsafe(item);
    return item;
  });
}

function ordered<T extends { ordinal: number }>(rows: readonly T[]): T[] {
  const sorted = [...rows].sort((left, right) => left.ordinal - right.ordinal);
  sorted.forEach((row, index) => {
    if (row.ordinal !== index) fail("The staged Chaos sample does not match the confirmed import");
  });
  return sorted;
}

function readEmergency(row: Record<string, unknown>, importRunId: string): ChaosEmergencyView & { ordinal: number } {
  if (row.import_run_id !== importRunId || row.status !== "RECEIVED") {
    fail("The staged Chaos sample does not match the confirmed import");
  }
  const location = readGrid(row, true);
  if (!location) fail("A fictional grid location is missing");
  return {
    ordinal: readInteger(row.ordinal, 0, 9),
    reportId: requireId(row.report_id),
    category: oneOf(row.category, REPORT_CATEGORIES),
    sourceType: oneOf(row.source_type, REPORT_SOURCE_TYPES),
    observedAt: requireTimestamp(row.observed_at),
    submittedAt: requireTimestamp(row.submitted_at),
    receivedAt: requireTimestamp(row.received_at),
    narrative: requireText(row.narrative, 1, 20_000),
    claims: readClaims(row.claims),
    status: "RECEIVED",
    urgency: oneOfOrNull(row.urgency, URGENCY_LEVELS),
    sourceMetadata: readMetadata(row.source_metadata),
    location,
  };
}

function readOperational(row: Record<string, unknown>, importRunId: string): ChaosOperationalView & { ordinal: number } {
  if (row.import_run_id !== importRunId || row.delivery_status !== "DELIVERED") {
    fail("The staged Chaos sample does not match the confirmed import");
  }
  const fatigue = row.fatigue == null ? null : readDecimal(row.fatigue, 0, 100);
  return {
    ordinal: readInteger(row.ordinal, 0, 9),
    observationId: requireId(row.observation_id),
    unitId: requireId(row.unit_id),
    assignmentId: row.assignment_id == null ? null : requireId(row.assignment_id),
    messageType: oneOf(row.message_type, OPERATIONAL_MESSAGE_TYPES),
    observedAt: requireTimestamp(row.observed_at),
    submittedAt: requireTimestamp(row.submitted_at),
    receivedAt: requireTimestamp(row.received_at),
    source: oneOf(row.source, OBSERVATION_SOURCES),
    deliveryStatus: "DELIVERED",
    availabilityState: oneOfOrNull(row.availability_state, AVAILABILITY_STATES),
    taskStatus: oneOfOrNull(row.task_status, TASK_STATUSES),
    travelStatus: oneOfOrNull(row.travel_status, TRAVEL_STATUSES),
    communicationState: oneOfOrNull(row.communication_state, COMMUNICATION_STATES),
    location: readGrid(row, false),
    routeVersion: row.route_version == null ? null : readInteger(row.route_version, 0, 1_000_000),
    fatigueText: fatigue?.text ?? null,
    equipmentItem: optionalText(row.equipment_item, 2000),
    equipmentCondition: oneOfOrNull(row.equipment_condition, EQUIPMENT_CONDITIONS),
    inventory: readInventory(row.inventory),
  };
}

function readUnit(row: Record<string, unknown>, importRunId: string): ChaosUnitView {
  if (row.import_run_id !== importRunId) fail("The staged Chaos sample does not match the confirmed import");
  return {
    unitId: requireId(row.unit_id),
    callsign: requireText(row.callsign, 1, 200),
    latestObservedAt: requireTimestamp(row.latest_observed_at),
    latestReceivedAt: requireTimestamp(row.latest_received_at),
    availabilityState: oneOfOrNull(row.availability_state, AVAILABILITY_STATES),
    assignmentId: row.assignment_id == null ? null : requireId(row.assignment_id),
    taskStatus: oneOfOrNull(row.task_status, TASK_STATUSES),
    travelStatus: oneOfOrNull(row.travel_status, TRAVEL_STATUSES),
    communicationState: oneOfOrNull(row.communication_state, COMMUNICATION_STATES),
    location: readGrid(row, false),
  };
}

function readAssignment(row: Record<string, unknown>, importRunId: string): ChaosPublicAssignmentView & { ordinal: number } {
  if (row.import_run_id !== importRunId) fail("The staged Chaos sample does not match the confirmed import");
  return {
    ordinal: readInteger(row.ordinal, 0, 9),
    assignmentId: requireId(row.assignment_id),
    unitId: requireId(row.unit_id),
    firstReceivedAt: requireTimestamp(row.first_received_at),
  };
}

function withoutOrdinal<T extends { ordinal: number }>(row: T): Omit<T, "ordinal"> {
  const { ordinal, ...rest } = row;
  void ordinal;
  return rest;
}

/**
 * Turns one staged sample read into the dashboard board.
 * Extra stored columns are ignored. Geographic and private fields are refused.
 */
export function assembleChaosSimulation(rows: ChaosSampleRows): ChaosSimulationBoard {
  if (!isRecord(rows.run)) fail("The staged Chaos sample does not match the confirmed import");
  scanUnsafe(rows.run);
  const run = rows.run;
  if (
    run.id !== CHAOS_SAMPLE_IMPORT_RUN_ID ||
    run.run_id !== CHAOS_SAMPLE_RUN_ID ||
    run.digest_hex !== CHAOS_SAMPLE_DIGEST_HEX ||
    run.schema_version !== SCHEMA_VERSION ||
    run.engine_version !== ENGINE_VERSION ||
    run.source_scenario_id !== CHAOS_SAMPLE_SOURCE_SCENARIO_ID ||
    run.fictional !== true
  ) {
    fail("The staged Chaos sample does not match the confirmed import");
  }
  const emergencyRows = ordered(requireRows(rows.emergencyObservations, CHAOS_SAMPLE_COUNTS.emergency).map((row) => readEmergency(row, CHAOS_SAMPLE_IMPORT_RUN_ID)));
  const operationalRows = ordered(requireRows(rows.operationalObservations, CHAOS_SAMPLE_COUNTS.operational).map((row) => readOperational(row, CHAOS_SAMPLE_IMPORT_RUN_ID)));
  const unitRows = requireRows(rows.units, CHAOS_SAMPLE_COUNTS.units).map((row) => readUnit(row, CHAOS_SAMPLE_IMPORT_RUN_ID));
  const assignmentRows = ordered(requireRows(rows.publicAssignments, CHAOS_SAMPLE_COUNTS.assignments).map((row) => readAssignment(row, CHAOS_SAMPLE_IMPORT_RUN_ID)));
  if (
    readInteger(run.emergency_count, 0, 10_000) !== emergencyRows.length ||
    readInteger(run.operational_count, 0, 10_000) !== operationalRows.length ||
    readInteger(run.unit_count, 0, 10_000) !== unitRows.length ||
    readInteger(run.assignment_count, 0, 10_000) !== assignmentRows.length
  ) {
    fail("The staged Chaos sample does not match the confirmed import");
  }
  const reportIds = new Set(emergencyRows.map((row) => row.reportId));
  const observationIds = new Set(operationalRows.map((row) => row.observationId));
  const unitIds = new Set(unitRows.map((row) => row.unitId));
  if (reportIds.size !== emergencyRows.length || observationIds.size !== operationalRows.length || unitIds.size !== unitRows.length) {
    fail("The staged Chaos sample does not match the confirmed import");
  }
  for (const row of operationalRows) {
    if (!unitIds.has(row.unitId)) fail("The staged Chaos sample does not match the confirmed import");
    if (row.assignmentId !== null && !assignmentRows.some((item) => item.assignmentId === row.assignmentId)) {
      fail("The staged Chaos sample does not match the confirmed import");
    }
  }
  for (const row of assignmentRows) {
    if (!unitIds.has(row.unitId)) fail("The staged Chaos sample does not match the confirmed import");
  }
  for (const row of unitRows) {
    if (row.assignmentId !== null && !assignmentRows.some((item) => item.assignmentId === row.assignmentId)) {
      fail("The staged Chaos sample does not match the confirmed import");
    }
  }
  return {
    kind: "chaos-simulation",
    fictional: true,
    importRunId: CHAOS_SAMPLE_IMPORT_RUN_ID,
    runId: CHAOS_SAMPLE_RUN_ID,
    schemaVersion: SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    sourceScenarioId: CHAOS_SAMPLE_SOURCE_SCENARIO_ID,
    sourceLabel: requireText(run.source_label, 1, 2000),
    difficulty: oneOfOrNull(run.difficulty, EXPORT_DIFFICULTIES),
    simulationStart: requireTimestamp(run.simulation_start),
    simulationExport: requireTimestamp(run.simulation_export),
    simulationStatus: oneOf(run.simulation_status, SIMULATION_STATUSES),
    emergencyObservations: emergencyRows.map(withoutOrdinal),
    operationalObservations: operationalRows.map(withoutOrdinal),
    units: unitRows,
    publicAssignments: assignmentRows.map(withoutOrdinal),
  };
}

export function formatGridNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  const text = value.toString();
  return /e/i.test(text) ? value.toFixed(6) : text;
}

/** Places fictional x/y on a linear frame. SVG y grows downward, so grid y is flipped. */
export function plotLocalGrid(points: readonly GridPlotInput[]): LocalGridPlot {
  if (points.length === 0) {
    return { xMin: 0, xMax: 1, yMin: 0, yMax: 1, points: [] };
  }
  const xMin = Math.min(...points.map((point) => point.x));
  const xMax = Math.max(...points.map((point) => point.x));
  const yMin = Math.min(...points.map((point) => point.y));
  const yMax = Math.max(...points.map((point) => point.y));
  const xSpan = xMax - xMin;
  const ySpan = yMax - yMin;
  const inner = 100 - GRID_PAD * 2;
  return {
    xMin,
    xMax,
    yMin,
    yMax,
    points: points.map((point) => ({
      ...point,
      left: xSpan === 0 ? 50 : GRID_PAD + ((point.x - xMin) / xSpan) * inner,
      top: ySpan === 0 ? 50 : GRID_PAD + ((yMax - point.y) / ySpan) * inner,
    })),
  };
}

export function gridPlotInputs(board: ChaosSimulationBoard): GridPlotInput[] {
  const points: GridPlotInput[] = [];
  for (const item of board.emergencyObservations) {
    points.push({
      id: `emergency:${item.reportId}`,
      kind: "emergency",
      label: item.reportId,
      x: item.location.x,
      y: item.location.y,
      xText: item.location.xText,
      yText: item.location.yText,
    });
  }
  for (const item of board.operationalObservations) {
    if (!item.location) continue;
    points.push({
      id: `operational:${item.observationId}`,
      kind: "operational",
      label: item.observationId,
      x: item.location.x,
      y: item.location.y,
      xText: item.location.xText,
      yText: item.location.yText,
    });
  }
  for (const item of board.units) {
    if (!item.location) continue;
    points.push({
      id: `unit:${item.unitId}`,
      kind: "unit",
      label: item.callsign,
      x: item.location.x,
      y: item.location.y,
      xText: item.location.xText,
      yText: item.location.yText,
    });
  }
  return points;
}

function clusterDistance(left: GridPlotInput, right: GridPlotInput): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

/**
 * Overview plus tighter frames for points that sit close together on the full grid.
 * Every frame uses the same x/y values.
 */
export function localGridFrames(points: readonly GridPlotInput[]): LocalGridFrame[] {
  const overview: LocalGridFrame = {
    id: "overview",
    title: "Full fictional grid",
    detail: "Linear simulated local grid. Higher y is higher on the frame.",
    plot: plotLocalGrid(points),
  };
  if (points.length < 3) return [overview];
  const span = Math.hypot(overview.plot.xMax - overview.plot.xMin, overview.plot.yMax - overview.plot.yMin);
  const threshold = Math.max(span * 0.02, 1);
  const unused = new Set(points.map((point) => point.id));
  const clusters: GridPlotInput[][] = [];
  for (const start of points) {
    if (!unused.has(start.id)) continue;
    const group = [start];
    unused.delete(start.id);
    let grew = true;
    while (grew) {
      grew = false;
      for (const candidate of points) {
        if (!unused.has(candidate.id)) continue;
        if (group.some((member) => clusterDistance(member, candidate) <= threshold)) {
          group.push(candidate);
          unused.delete(candidate.id);
          grew = true;
        }
      }
    }
    if (group.length >= 2 && group.length < points.length) clusters.push(group);
  }
  const insets = clusters.map((group) => {
    const plot = plotLocalGrid(group);
    return {
      id: `inset-${plot.xMin}-${plot.yMin}`,
      title: `x ${formatGridNumber(plot.xMin)} to ${formatGridNumber(plot.xMax)}, y ${formatGridNumber(plot.yMin)} to ${formatGridNumber(plot.yMax)}`,
      detail: "Same fictional x and y, drawn on a tighter linear frame.",
      plot,
    };
  });
  return [overview, ...insets];
}
