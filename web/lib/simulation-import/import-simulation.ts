import { createHash } from "node:crypto";

import { collectSchemaIssues, exceedsNestingDepth } from "@/lib/simulation-import/schema-validator";
import {
  AVAILABILITY_STATES,
  COMMUNICATION_STATES,
  CONFIDENCE_LEVELS,
  DETAIL_STATUSES,
  ENGINE_VERSION,
  EQUIPMENT_CONDITIONS,
  EXPORT_DIFFICULTIES,
  LOCATION_PRECISIONS,
  MAX_IMPORT_BYTES,
  MAX_ISSUES,
  OBSERVATION_SOURCES,
  OBSERVATION_STAGES,
  OPERATIONAL_MESSAGE_TYPES,
  REPORT_CATEGORIES,
  REPORT_SOURCE_TYPES,
  REPLAY_SCENARIOS,
  SCHEMA_VERSION,
  SIMULATION_STATUSES,
  SOURCE_CHANNELS,
  TASK_STATUSES,
  TRAVEL_STATUSES,
  URGENCY_LEVELS,
  FORBIDDEN_SIMULATION_KEYS,
  type ImportFailure,
  type ImportIssue,
  type ImportLedger,
  type ImportResult,
  type ImportTextOptions,
  type PublicAssignment,
  type PublicClaim,
  type PublicEmergencyObservation,
  type PublicLocation,
  type PublicOperationalContent,
  type PublicOperationalObservation,
  type PublicReplayManifest,
  type PublicSimulationDocument,
  type PublicSourceMetadata,
  type PublicUnit,
  type SimulationImport,
} from "@/lib/simulation-import/types";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
const FORBIDDEN = new Set<string>(FORBIDDEN_SIMULATION_KEYS);

class StagingError extends Error {
  constructor() {
    super("Import staging failed.");
    this.name = "StagingError";
  }
}

function failure(stage: ImportFailure["stage"], issues: readonly ImportIssue[]): ImportFailure {
  const safe = issues.slice(0, MAX_ISSUES).map((issue) => Object.freeze({ path: issue.path, message: issue.message }));
  if (safe.length === 0) safe.push(Object.freeze({ path: "$", message: "Import failed." }));
  return Object.freeze({ ok: false as const, stage, issues: Object.freeze(safe) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function versionIssues(value: unknown): ImportIssue[] {
  if (!isRecord(value)) return [];
  const issues: ImportIssue[] = [];
  if (value.schemaVersion !== SCHEMA_VERSION) issues.push(Object.freeze({ path: "$.schemaVersion", message: "Unsupported schema version." }));
  if (value.engineVersion !== ENGINE_VERSION) issues.push(Object.freeze({ path: "$.engineVersion", message: "Unsupported engine version." }));
  return issues;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function collectCrossRecordIssues(value: unknown): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const fail = (path: string, message: string): void => {
    if (issues.length < MAX_ISSUES) issues.push(Object.freeze({ path, message }));
  };
  if (!isRecord(value) || !isRecord(value.simulationTime) || !isRecord(value.summary)) {
    fail("$", "Document shape is inconsistent.");
    return issues;
  }
  const exportTime = value.simulationTime.exportTime;
  const startTime = value.simulationTime.startTime;
  if (typeof startTime !== "string" || typeof exportTime !== "string") {
    fail("$.simulationTime", "Document shape is inconsistent.");
    return issues;
  }
  if (startTime > exportTime) fail("$.simulationTime", "Start time must not follow export time.");

  const units = records(value.units, "$.units", fail);
  const assignments = records(value.assignments, "$.assignments", fail);
  const reports = records(value.emergencyObservations, "$.emergencyObservations", fail);
  const operations = records(value.operationalObservations, "$.operationalObservations", fail);
  const unitIds = uniqueIds(units, "unitId", "$.units", fail);
  const assignmentIds = uniqueIds(assignments, "assignmentId", "$.assignments", fail);
  uniqueIds(reports, "reportId", "$.emergencyObservations", fail);
  uniqueIds(operations, "observationId", "$.operationalObservations", fail);

  assignments.forEach((item, index) => {
    reference(item.unitId, unitIds, `$.assignments[${index}].unitId`, fail);
    if (typeof item.firstReceivedAt === "string" && item.firstReceivedAt > exportTime) fail(`$.assignments[${index}]`, "Assignment is from the future.");
  });
  units.forEach((item, index) => {
    const observed = item.latestObservedAt;
    const received = item.latestReceivedAt;
    if (typeof observed === "string" && typeof received === "string" && observed > received) fail(`$.units[${index}]`, "Unit observation time follows receipt time.");
    if (typeof received === "string" && received > exportTime) fail(`$.units[${index}]`, "Unit knowledge is from the future.");
    if (item.assignmentId !== null) reference(item.assignmentId, assignmentIds, `$.units[${index}].assignmentId`, fail);
  });
  reports.forEach((item, index) => timeOrder(item.observedAt, item.submittedAt, item.receivedAt, exportTime, `$.emergencyObservations[${index}]`, fail));
  operations.forEach((item, index) => {
    reference(item.unitId, unitIds, `$.operationalObservations[${index}].unitId`, fail);
    if (item.assignmentId !== null) reference(item.assignmentId, assignmentIds, `$.operationalObservations[${index}].assignmentId`, fail);
    timeOrder(item.observedAt, item.submittedAt, item.receivedAt, exportTime, `$.operationalObservations[${index}]`, fail);
  });
  assertSorted(reports, "$.emergencyObservations", "reportId", fail);
  assertSorted(operations, "$.operationalObservations", "observationId", fail);

  const summary = value.summary;
  if (summary.emergencyObservationCount !== reports.length) fail("$.summary.emergencyObservationCount", "Summary count is inconsistent.");
  if (summary.operationalObservationCount !== operations.length) fail("$.summary.operationalObservationCount", "Summary count is inconsistent.");
  if (summary.unitCount !== units.length) fail("$.summary.unitCount", "Summary count is inconsistent.");
  if (summary.assignmentCount !== assignments.length) fail("$.summary.assignmentCount", "Summary count is inconsistent.");
  const receipts = [...reports, ...operations]
    .map((item) => item.receivedAt)
    .filter((item): item is string => typeof item === "string")
    .sort(compareText);
  if (summary.firstReceivedAt !== (receipts[0] ?? null)) fail("$.summary.firstReceivedAt", "Summary first receipt is inconsistent.");
  if (summary.lastReceivedAt !== (receipts.at(-1) ?? null)) fail("$.summary.lastReceivedAt", "Summary last receipt is inconsistent.");
  return issues;
}

function records(value: unknown, path: string, fail: (path: string, message: string) => void): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    fail(path, "Document shape is inconsistent.");
    return [];
  }
  return value.map((item, index) => {
    if (!isRecord(item)) {
      fail(`${path}[${index}]`, "Document shape is inconsistent.");
      return {};
    }
    return item;
  });
}

function uniqueIds(items: readonly Record<string, unknown>[], key: string, path: string, fail: (path: string, message: string) => void): Set<string> {
  const ids = new Set<string>();
  items.forEach((item, index) => {
    const id = item[key];
    if (typeof id !== "string") {
      fail(`${path}[${index}].${key}`, "Document shape is inconsistent.");
      return;
    }
    if (ids.has(id)) fail(`${path}[${index}].${key}`, "Identifier must be unique.");
    ids.add(id);
  });
  return ids;
}

function reference(value: unknown, ids: ReadonlySet<string>, path: string, fail: (path: string, message: string) => void): void {
  if (typeof value !== "string" || !ids.has(value)) fail(path, "Reference does not resolve.");
}

function timeOrder(observed: unknown, submitted: unknown, received: unknown, exportTime: string, path: string, fail: (path: string, message: string) => void): void {
  if (typeof observed !== "string" || typeof submitted !== "string" || typeof received !== "string") {
    fail(path, "Document shape is inconsistent.");
    return;
  }
  if (observed > submitted) fail(path, "Observation follows submission.");
  if (submitted > received) fail(path, "Submission follows receipt.");
  if (received > exportTime) fail(path, "Observation was received after export time.");
}

function assertSorted(items: readonly Record<string, unknown>[], path: string, idKey: string, fail: (path: string, message: string) => void): void {
  for (let index = 1; index < items.length; index += 1) {
    const left = items[index - 1];
    const right = items[index];
    if (left === undefined || right === undefined) continue;
    if (typeof left.receivedAt !== "string" || typeof right.receivedAt !== "string" || typeof left[idKey] !== "string" || typeof right[idKey] !== "string") {
      fail(path, "Document shape is inconsistent.");
      return;
    }
    if (left.receivedAt > right.receivedAt || (left.receivedAt === right.receivedAt && String(left[idKey]) > String(right[idKey]))) {
      fail(`${path}[${index}]`, "Observations are not in canonical receipt order.");
      return;
    }
  }
}

export function validateSimulationValue(value: unknown): ImportFailure | { readonly ok: true } {
  if (exceedsNestingDepth(value)) return failure("schema", [{ path: "$", message: "Document exceeds the maximum nesting depth." }]);
  const versions = versionIssues(value);
  if (versions.length > 0) return failure("version", versions);
  const schemaIssues = collectSchemaIssues(value);
  if (schemaIssues.length > 0) return failure("schema", schemaIssues);
  const crossIssues = collectCrossRecordIssues(value);
  if (crossIssues.length > 0) return failure("cross-reference", crossIssues);
  return { ok: true };
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new StagingError();
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.some((item) => item === value)) throw new StagingError();
  return value as T;
}

function oneOfOrNull<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (value === null) return null;
  return oneOf(value, allowed);
}

function expectString(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length === 0 || [...value].length > maximum) throw new StagingError();
  return value;
}

function expectNullableString(value: unknown): string | null {
  if (value === null) return null;
  return expectString(value, 2000);
}

function expectIdentifier(value: unknown): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) throw new StagingError();
  return value;
}

function expectIdentifierOrNull(value: unknown): string | null {
  if (value === null) return null;
  return expectIdentifier(value);
}

function expectTimestamp(value: unknown): string {
  if (typeof value !== "string" || !TIMESTAMP.test(value)) throw new StagingError();
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== value) throw new StagingError();
  return value;
}

function expectTimestampOrNull(value: unknown): string | null {
  if (value === null) return null;
  return expectTimestamp(value);
}

function expectBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new StagingError();
  return value;
}

function expectFinite(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw new StagingError();
  return value;
}

function expectFiniteOrNull(value: unknown, minimum: number, maximum: number): number | null {
  if (value === null) return null;
  return expectFinite(value, minimum, maximum);
}

function expectInteger(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) throw new StagingError();
  return value;
}

function expectIntegerOrNull(value: unknown, minimum: number, maximum: number): number | null {
  if (value === null) return null;
  return expectInteger(value, minimum, maximum);
}

function expectConst<T extends string>(value: unknown, expected: T): T {
  if (value !== expected) throw new StagingError();
  return expected;
}

function expectArray(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 100_000) throw new StagingError();
  return value;
}

function projectLocation(value: unknown): PublicLocation {
  const item = record(value);
  if (item.fictional !== true) throw new StagingError();
  return Object.freeze({
    fictional: true,
    coordinateSystem: expectConst(item.coordinateSystem, "SIMULATED_LOCAL_GRID"),
    x: expectFinite(item.x, -1_000_000, 1_000_000),
    y: expectFinite(item.y, -1_000_000, 1_000_000),
    district: expectNullableString(item.district),
    primaryReference: expectNullableString(item.primaryReference),
    secondaryReference: expectNullableString(item.secondaryReference),
    description: expectString(item.description, 2000),
    precision: oneOfOrNull(item.precision, LOCATION_PRECISIONS),
  });
}

function projectLocationOrNull(value: unknown): PublicLocation | null {
  if (value === null) return null;
  return projectLocation(value);
}

function projectClaim(value: unknown): PublicClaim {
  const item = record(value);
  return Object.freeze({
    code: expectString(item.code, 2000),
    statement: expectString(item.statement, 2000),
    stage: oneOf(item.stage, OBSERVATION_STAGES),
    assistanceRequested: expectBoolean(item.assistanceRequested),
    value: expectNullableString(item.value),
    confidence: oneOfOrNull(item.confidence, CONFIDENCE_LEVELS),
    detailStatus: oneOfOrNull(item.detailStatus, DETAIL_STATUSES),
  });
}

function projectSourceMetadata(value: unknown): PublicSourceMetadata | null {
  if (value === null) return null;
  const item = record(value);
  return Object.freeze({
    channel: oneOf(item.channel, SOURCE_CHANNELS),
    organizationLabel: expectNullableString(item.organizationLabel),
    sensorKind: expectNullableString(item.sensorKind),
  });
}

function projectEmergency(value: unknown): PublicEmergencyObservation {
  const item = record(value);
  return Object.freeze({
    reportId: expectIdentifier(item.reportId),
    category: oneOf(item.category, REPORT_CATEGORIES),
    sourceType: oneOf(item.sourceType, REPORT_SOURCE_TYPES),
    observedAt: expectTimestamp(item.observedAt),
    submittedAt: expectTimestamp(item.submittedAt),
    receivedAt: expectTimestamp(item.receivedAt),
    location: projectLocation(item.location),
    narrative: expectString(item.narrative, 2000),
    claims: Object.freeze(expectArray(item.claims).map(projectClaim)),
    status: expectConst(item.status, "RECEIVED"),
    urgency: oneOfOrNull(item.urgency, URGENCY_LEVELS),
    sourceMetadata: projectSourceMetadata(item.sourceMetadata),
  });
}

function projectInventory(value: unknown): Readonly<Record<string, number>> | null {
  if (value === null) return null;
  const entries = Object.entries(record(value)).map(([key, quantity]) => {
    if ([...key].length < 1 || [...key].length > 2000) throw new StagingError();
    return [key, expectInteger(quantity, 0, 10_000)] as const;
  });
  return Object.freeze(Object.fromEntries(entries));
}

function projectContent(value: unknown): PublicOperationalContent {
  const item = record(value);
  return Object.freeze({
    availabilityState: oneOfOrNull(item.availabilityState, AVAILABILITY_STATES),
    taskStatus: oneOfOrNull(item.taskStatus, TASK_STATUSES),
    travelStatus: oneOfOrNull(item.travelStatus, TRAVEL_STATUSES),
    communicationState: oneOfOrNull(item.communicationState, COMMUNICATION_STATES),
    location: projectLocationOrNull(item.location),
    routeVersion: expectIntegerOrNull(item.routeVersion, 0, 1_000_000),
    fatigue: expectFiniteOrNull(item.fatigue, 0, 100),
    equipmentItem: expectNullableString(item.equipmentItem),
    equipmentCondition: oneOfOrNull(item.equipmentCondition, EQUIPMENT_CONDITIONS),
    inventory: projectInventory(item.inventory),
  });
}

function projectOperation(value: unknown): PublicOperationalObservation {
  const item = record(value);
  return Object.freeze({
    observationId: expectIdentifier(item.observationId),
    unitId: expectIdentifier(item.unitId),
    assignmentId: expectIdentifierOrNull(item.assignmentId),
    messageType: oneOf(item.messageType, OPERATIONAL_MESSAGE_TYPES),
    observedAt: expectTimestamp(item.observedAt),
    submittedAt: expectTimestamp(item.submittedAt),
    receivedAt: expectTimestamp(item.receivedAt),
    source: oneOf(item.source, OBSERVATION_SOURCES),
    deliveryStatus: expectConst(item.deliveryStatus, "DELIVERED"),
    content: projectContent(item.content),
  });
}

function projectUnit(value: unknown): PublicUnit {
  const item = record(value);
  return Object.freeze({
    unitId: expectIdentifier(item.unitId),
    callsign: expectString(item.callsign, 2000),
    latestObservedAt: expectTimestamp(item.latestObservedAt),
    latestReceivedAt: expectTimestamp(item.latestReceivedAt),
    availabilityState: oneOfOrNull(item.availabilityState, AVAILABILITY_STATES),
    assignmentId: expectIdentifierOrNull(item.assignmentId),
    taskStatus: oneOfOrNull(item.taskStatus, TASK_STATUSES),
    travelStatus: oneOfOrNull(item.travelStatus, TRAVEL_STATUSES),
    communicationState: oneOfOrNull(item.communicationState, COMMUNICATION_STATES),
    location: projectLocationOrNull(item.location),
  });
}

function projectAssignment(value: unknown): PublicAssignment {
  const item = record(value);
  return Object.freeze({
    assignmentId: expectIdentifier(item.assignmentId),
    unitId: expectIdentifier(item.unitId),
    firstReceivedAt: expectTimestamp(item.firstReceivedAt),
  });
}

function projectReplay(value: unknown): PublicReplayManifest | null {
  if (value === null) return null;
  const item = record(value);
  return Object.freeze({
    presetVersion: expectConst(item.presetVersion, "phase7b.v1"),
    engineVersion: expectConst(item.engineVersion, ENGINE_VERSION),
    schemaVersion: expectConst(item.schemaVersion, SCHEMA_VERSION),
    scenario: oneOf(item.scenario, REPLAY_SCENARIOS),
    difficulty: oneOf(item.difficulty, EXPORT_DIFFICULTIES),
    seed: expectString(item.seed, 256),
    reportCount: expectInteger(item.reportCount, 1, 10_000),
    responderCount: expectInteger(item.responderCount, 1, 1_000),
    durationMs: expectInteger(item.durationMs, 600_000, 604_800_000),
  });
}

function projectDocument(value: unknown): PublicSimulationDocument {
  const item = record(value);
  const scenario = record(item.scenario);
  const simulationTime = record(item.simulationTime);
  const summary = record(item.summary);
  if (scenario.fictional !== true) throw new StagingError();
  const document: PublicSimulationDocument = {
    schemaVersion: expectConst(item.schemaVersion, SCHEMA_VERSION),
    engineVersion: expectConst(item.engineVersion, ENGINE_VERSION),
    runId: expectIdentifier(item.runId),
    scenario: Object.freeze({
      scenarioId: expectString(scenario.scenarioId, 128),
      seed: expectString(scenario.seed, 256),
      fictional: true,
      label: expectString(scenario.label, 256),
      difficulty: oneOfOrNull(scenario.difficulty, EXPORT_DIFFICULTIES),
    }),
    simulationTime: Object.freeze({
      startTime: expectTimestamp(simulationTime.startTime),
      exportTime: expectTimestamp(simulationTime.exportTime),
      status: oneOf(simulationTime.status, SIMULATION_STATUSES),
    }),
    emergencyObservations: Object.freeze(expectArray(item.emergencyObservations).map(projectEmergency)),
    operationalObservations: Object.freeze(expectArray(item.operationalObservations).map(projectOperation)),
    units: Object.freeze(expectArray(item.units).map(projectUnit)),
    assignments: Object.freeze(expectArray(item.assignments).map(projectAssignment)),
    replayManifest: projectReplay(item.replayManifest),
    summary: Object.freeze({
      emergencyObservationCount: expectInteger(summary.emergencyObservationCount, 0, 1_000_000),
      operationalObservationCount: expectInteger(summary.operationalObservationCount, 0, 1_000_000),
      unitCount: expectInteger(summary.unitCount, 0, 1_000_000),
      assignmentCount: expectInteger(summary.assignmentCount, 0, 1_000_000),
      firstReceivedAt: expectTimestampOrNull(summary.firstReceivedAt),
      lastReceivedAt: expectTimestampOrNull(summary.lastReceivedAt),
    }),
  };
  assertApprovedFields(document);
  return document;
}

function assertApprovedFields(value: unknown): void {
  const pending = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    if (!isRecord(current)) continue;
    for (const [key, child] of Object.entries(current)) {
      if (FORBIDDEN.has(key)) throw new StagingError();
      pending.push(child);
    }
  }
}

function stageSimulation(value: unknown, text: string): SimulationImport {
  const document = projectDocument(value);
  const digestHex = createHash("sha256").update(text).digest("hex");
  return deepFreeze({
    source: {
      digestAlgorithm: "SHA-256" as const,
      digestHex,
      byteLength: Buffer.byteLength(text),
      idempotencyKey: `${document.schemaVersion}:${document.runId}:${digestHex}`,
    },
    document,
  });
}

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return Object.freeze(value) as T;
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    return Object.freeze(value) as T;
  }
  return value;
}

/**
 * Validate one public simulation export and commit it to an in-memory ledger.
 * Phase 0 does not write to a database, call a model, or render the dashboard.
 */
export function importSimulationText(text: string, ledger: ImportLedger, options: ImportTextOptions = {}): ImportResult {
  if (typeof text !== "string") return failure("read", [{ path: "$", message: "Import text must be a string." }]);
  const maxBytes = options.maxBytes ?? MAX_IMPORT_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) return failure("read", [{ path: "$", message: "Import size limit is invalid." }]);
  if (Buffer.byteLength(text) > maxBytes) return failure("read", [{ path: "$", message: "Import exceeds the size limit." }]);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return failure("parse", [{ path: "$", message: "Input is not valid JSON." }]);
  }

  const validated = validateSimulationValue(parsed);
  if (!validated.ok) return validated;

  let staged: SimulationImport;
  try {
    staged = stageSimulation(parsed, text);
  } catch (error) {
    if (error instanceof StagingError) return failure("staging", [{ path: "$", message: "Import staging failed." }]);
    throw error;
  }

  try {
    if (ledger.findByKey(staged.source.idempotencyKey) !== undefined) {
      return failure("duplicate", [{ path: "$", message: "This artifact was already imported." }]);
    }
    if (ledger.findByRun(staged.document.schemaVersion, staged.document.runId) !== undefined) {
      return failure("duplicate", [{ path: "$.runId", message: "A different artifact for this run was already imported and requires manual review." }]);
    }
    ledger.commit(staged);
  } catch {
    return failure("commit", [{ path: "$", message: "Import commit failed." }]);
  }
  return Object.freeze({ ok: true as const, simulation: staged });
}
