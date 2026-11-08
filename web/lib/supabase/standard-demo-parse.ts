import {
  ASSIGNMENT_ORIGINS,
  INCIDENT_CATEGORIES,
  INCIDENT_PRIORITIES,
  INCIDENT_STATUSES,
  RESPONDER_AVAILABILITIES,
  SAMPLE_KEYS,
  type Assignment,
  type AssignmentOrigin,
  type AssignmentStatus,
  type Incident,
  type IncidentCategory,
  type IncidentPriority,
  type IncidentStatus,
  type Report,
  type Responder,
  type ResponderAvailability,
  type SampleKey,
  type Scenario,
} from "@/lib/demo/types";

/**
 * Reads the imported Standard Demo (`scn_demo_flood`) with the server secret.
 * `disasterType` and `fictionalLocation` are not columns on `scenarios`;
 * they belong to this known demo. The map center is the mean of the
 * incident coordinates, which is how the generator places the map.
 */

export const STANDARD_DEMO_ID = "scn_demo_flood";

const EXPECTED_COUNTS = {
  incidents: 67,
  reports: 100,
  responders: 12,
  baselineAssignments: 9,
} as const;

const ASSIGNMENT_STATUSES = ["ASSIGNED", "IN_PROGRESS", "COMPLETED"] as const;
export const STANDARD_DEMO_READ_LIMIT = 500;

export const SCENARIO_COLUMNS = "id, name, description, seed, is_active";
export const INCIDENT_COLUMNS =
  "id, scenario_id, title, description, category, district, latitude, longitude, priority, priority_basis, status, low_detail, sample_key, report_ids, created_at, updated_at";
export const REPORT_COLUMNS =
  "id, scenario_id, incident_id, source, raw_text, reported_lat, reported_lon, received_at, analysis_status";
export const RESPONDER_COLUMNS =
  "id, scenario_id, callsign, capabilities, availability, latitude, longitude, updated_at";
export const ASSIGNMENT_COLUMNS =
  "id, incident_id, responder_id, status, assigned_at, origin, note";

export class ScenarioDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioDataError";
  }
}

export interface StandardDemoRows {
  scenario: unknown;
  incidents: unknown;
  reports: unknown;
  responders: unknown;
  assignments: unknown;
}

function fail(message: string): never {
  throw new ScenarioDataError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function requireRows(value: unknown, table: string): unknown[] {
  if (!Array.isArray(value)) fail(`${table} response was not a list`);
  if (value.length >= STANDARD_DEMO_READ_LIMIT) fail(`${table} read was truncated`);
  return value;
}

function requireId(value: unknown, label: string, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    fail(`${label} has an unexpected id`);
  }
  return value;
}

function requireText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    fail(`${label} is missing`);
  }
  return value;
}

function requireNumber(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(number) || number < min || number > max) {
    fail(`${label} is out of range`);
  }
  return number;
}

function requireTimestamp(value: unknown, label: string): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) fail(`${label} is not a timestamp`);
    return value.toISOString();
  }
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    fail(`${label} is not a timestamp`);
  }
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail(`${label} is not a boolean`);
  return value;
}

function requireEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  fail(`${label} is not an allowed value`);
}

function requireStringList(value: unknown, label: string, min: number): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > 50) {
    fail(`${label} is not a usable list`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0 || item.length > 200) {
      fail(`${label} entry ${index + 1} is invalid`);
    }
    return item;
  });
}

function requireSeed(value: unknown): number {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isInteger(number)) fail("scenario seed is not an integer");
  return number;
}

function roundCoord(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

function parseScenario(value: unknown): {
  id: string;
  name: string;
  description: string;
  seed: number;
} {
  const rows = requireRows(value, "scenarios");
  if (rows.length !== 1) fail("Standard demo scenario was not found");
  const row = rows[0];
  if (!isRecord(row)) fail("Standard demo scenario row is missing");
  if (row.is_active !== true) fail("Standard demo scenario is not active");
  const id = requireId(row.id, "scenario", /^scn_demo_flood$/);
  return {
    id,
    name: requireText(row.name, "scenario name", 200),
    description: requireText(row.description, "scenario description", 2_000),
    seed: requireSeed(row.seed),
  };
}

function parseIncident(value: unknown, scenarioId: string): Incident {
  if (!isRecord(value)) fail("incident row is incomplete");
  const id = requireId(value.id, "incident", /^inc_[0-9]{4,8}$/);
  if (value.scenario_id !== scenarioId) fail(`${id} belongs to another scenario`);
  const summary = requireText(
    typeof value.description === "string" && value.description.trim()
      ? value.description
      : value.title,
    `${id} summary`,
    2_000,
  );
  const sampleKey =
    value.sample_key === null || value.sample_key === undefined
      ? undefined
      : requireEnum<SampleKey>(value.sample_key, SAMPLE_KEYS, `${id} sample`);
  return {
    id,
    scenarioId,
    summary,
    category: requireEnum<IncidentCategory>(
      value.category,
      INCIDENT_CATEGORIES,
      `${id} category`,
    ),
    district: requireText(value.district, `${id} district`, 200),
    lat: requireNumber(value.latitude, `${id} latitude`, -90, 90),
    lon: requireNumber(value.longitude, `${id} longitude`, -180, 180),
    priority: requireEnum<IncidentPriority>(
      value.priority,
      INCIDENT_PRIORITIES,
      `${id} priority`,
    ),
    priorityBasis: requireText(value.priority_basis, `${id} priority basis`, 2_000),
    status: requireEnum<IncidentStatus>(value.status, INCIDENT_STATUSES, `${id} status`),
    lowDetail: requireBoolean(value.low_detail, `${id} low detail`),
    ...(sampleKey ? { sampleKey } : {}),
    reportIds: requireStringList(value.report_ids, `${id} reports`, 1),
    createdAt: requireTimestamp(value.created_at, `${id} created_at`),
    updatedAt: requireTimestamp(value.updated_at, `${id} updated_at`),
  };
}

function parseReport(value: unknown, scenarioId: string): Report {
  if (!isRecord(value)) fail("report row is incomplete");
  const id = requireId(value.id, "report", /^rpt_[0-9]{4,8}$/);
  if (value.scenario_id !== scenarioId) fail(`${id} belongs to another scenario`);
  if (value.source !== "seed") fail(`${id} is not a seeded report`);
  if (value.analysis_status !== "NOT_AI_REVIEWED") {
    fail(`${id} analysis status is not the seeded value`);
  }
  return {
    id,
    scenarioId,
    incidentId: requireId(value.incident_id, `${id} incident`, /^inc_[0-9]{4,8}$/),
    source: "seed",
    rawText: requireText(value.raw_text, `${id} text`, 20_000),
    reportedLat: requireNumber(value.reported_lat, `${id} latitude`, -90, 90),
    reportedLon: requireNumber(value.reported_lon, `${id} longitude`, -180, 180),
    receivedAt: requireTimestamp(value.received_at, `${id} received_at`),
    analysisStatus: "NOT_AI_REVIEWED",
  };
}

function parseResponder(value: unknown, scenarioId: string): Responder {
  if (!isRecord(value)) fail("responder row is incomplete");
  const id = requireId(value.id, "responder", /^unit_[0-9]{2,8}$/);
  if (value.scenario_id !== scenarioId) fail(`${id} belongs to another scenario`);
  return {
    id,
    scenarioId,
    callsign: requireText(value.callsign, `${id} callsign`, 80),
    capabilities: requireStringList(value.capabilities, `${id} capabilities`, 1),
    availability: requireEnum<ResponderAvailability>(
      value.availability,
      RESPONDER_AVAILABILITIES,
      `${id} availability`,
    ),
    lat: requireNumber(value.latitude, `${id} latitude`, -90, 90),
    lon: requireNumber(value.longitude, `${id} longitude`, -180, 180),
    updatedAt: requireTimestamp(value.updated_at, `${id} updated_at`),
  };
}

function assignmentIdPattern(origin: AssignmentOrigin): RegExp {
  if (origin === "scenario_baseline") return /^asn_[0-9]{4,8}$/;
  return /^asn_h_[0-9a-f]{32}$/;
}

function parseAssignment(value: unknown): Assignment {
  if (!isRecord(value)) fail("assignment row is incomplete");
  const origin = requireEnum<AssignmentOrigin>(
    value.origin,
    ASSIGNMENT_ORIGINS,
    "assignment origin",
  );
  const id = requireId(value.id, "assignment", assignmentIdPattern(origin));
  return {
    id,
    incidentId: requireId(value.incident_id, `${id} incident`, /^inc_[0-9]{4,8}$/),
    responderId: requireId(value.responder_id, `${id} responder`, /^unit_[0-9]{2,8}$/),
    status: requireEnum<AssignmentStatus>(
      value.status,
      ASSIGNMENT_STATUSES,
      `${id} status`,
    ),
    assignedAt: requireTimestamp(value.assigned_at, `${id} assigned_at`),
    origin,
    note: requireText(value.note, `${id} note`, 2_000),
  };
}

function uniqueById<T extends { id: string }>(rows: T[], label: string): T[] {
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) fail(`${label} id ${row.id} is duplicated`);
    seen.add(row.id);
  }
  return [...rows].sort((left, right) => left.id.localeCompare(right.id));
}

function mapCenter(incidents: Incident[]): { lat: number; lon: number } {
  const lat =
    incidents.reduce((sum, incident) => sum + incident.lat, 0) / incidents.length;
  const lon =
    incidents.reduce((sum, incident) => sum + incident.lon, 0) / incidents.length;
  return { lat: roundCoord(lat), lon: roundCoord(lon) };
}

export function assembleStandardDemo(rows: StandardDemoRows): Scenario {
  const scenarioRow = parseScenario(rows.scenario);
  const incidents = uniqueById(
    requireRows(rows.incidents, "incidents").map((row) =>
      parseIncident(row, scenarioRow.id),
    ),
    "incidents",
  );
  const reports = uniqueById(
    requireRows(rows.reports, "reports").map((row) => parseReport(row, scenarioRow.id)),
    "reports",
  );
  const responders = uniqueById(
    requireRows(rows.responders, "responders").map((row) =>
      parseResponder(row, scenarioRow.id),
    ),
    "responders",
  );
  const assignments = uniqueById(
    requireRows(rows.assignments, "assignments").map((row) => parseAssignment(row)),
    "assignments",
  );

  if (incidents.length !== EXPECTED_COUNTS.incidents) {
    fail(`expected ${EXPECTED_COUNTS.incidents} incidents, found ${incidents.length}`);
  }
  if (reports.length !== EXPECTED_COUNTS.reports) {
    fail(`expected ${EXPECTED_COUNTS.reports} reports, found ${reports.length}`);
  }
  if (responders.length !== EXPECTED_COUNTS.responders) {
    fail(`expected ${EXPECTED_COUNTS.responders} responders, found ${responders.length}`);
  }
  const baselineAssignments = assignments.filter(
    (assignment) => assignment.origin === "scenario_baseline",
  );
  if (baselineAssignments.length !== EXPECTED_COUNTS.baselineAssignments) {
    fail(
      `expected ${EXPECTED_COUNTS.baselineAssignments} baseline assignments, found ${baselineAssignments.length}`,
    );
  }

  const incidentIds = new Set(incidents.map((incident) => incident.id));
  const reportIds = new Set(reports.map((report) => report.id));
  const responderIds = new Set(responders.map((responder) => responder.id));
  const reportsByIncident = new Map<string, Report[]>();

  for (const report of reports) {
    if (!incidentIds.has(report.incidentId)) {
      fail(`${report.id} references a missing incident`);
    }
    const linked = reportsByIncident.get(report.incidentId) ?? [];
    linked.push(report);
    reportsByIncident.set(report.incidentId, linked);
  }

  const samples = new Set<SampleKey>();
  for (const incident of incidents) {
    if (incident.sampleKey) samples.add(incident.sampleKey);
    const linked = reportsByIncident.get(incident.id) ?? [];
    if (new Set(incident.reportIds).size !== incident.reportIds.length) {
      fail(`${incident.id} repeats a report id`);
    }
    if (linked.length !== incident.reportIds.length) {
      fail(`${incident.id} report link count does not match its reports`);
    }
    const linkedIds = new Set(linked.map((report) => report.id));
    for (const reportId of incident.reportIds) {
      if (!reportIds.has(reportId) || !linkedIds.has(reportId)) {
        fail(`${incident.id} references a missing report`);
      }
    }
  }

  for (const sampleKey of SAMPLE_KEYS) {
    if (!samples.has(sampleKey)) fail(`missing sample ${sampleKey}`);
  }

  const assignedIncidents = new Set<string>();
  const openResponders = new Set<string>();
  for (const assignment of assignments) {
    if (!incidentIds.has(assignment.incidentId)) {
      fail(`${assignment.id} references a missing incident`);
    }
    if (!responderIds.has(assignment.responderId)) {
      fail(`${assignment.id} references a missing responder`);
    }
    if (assignedIncidents.has(assignment.incidentId)) {
      fail(`${assignment.incidentId} has more than one assignment`);
    }
    assignedIncidents.add(assignment.incidentId);
    if (assignment.status !== "COMPLETED") {
      if (openResponders.has(assignment.responderId)) {
        fail(`${assignment.responderId} has more than one open assignment`);
      }
      openResponders.add(assignment.responderId);
    }
  }

  return {
    id: scenarioRow.id,
    name: scenarioRow.name,
    disasterType: "urban_flood",
    description: scenarioRow.description,
    seed: scenarioRow.seed,
    fictionalLocation: "Demo City",
    mapCenter: mapCenter(incidents),
    incidents,
    reports,
    responders,
    assignments,
  };
}

export function idsFrom(rows: unknown): string[] {
  if (!Array.isArray(rows)) return [];
  const ids: string[] = [];
  for (const row of rows) {
    if (!isRecord(row) || typeof row.id !== "string") continue;
    ids.push(row.id);
  }
  return ids;
}
