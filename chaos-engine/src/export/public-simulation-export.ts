import { constants as fsConstants } from "node:fs";
import { copyFile, lstat, rename, unlink, writeFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";

import { REPORT_CATEGORIES, REPORT_SOURCE_TYPES, type PublicEmergencyObservation } from "../reporting/types.js";
import { COMMUNICATION_STATES, OPERATIONAL_MESSAGE_TYPES, type OperationalMessageContent, type PublicOperationalObservation } from "../simulation/communication.js";
import { RESPONDER_AVAILABILITY_STATES } from "../simulation/responder.js";
import type { SimulationEngine, SimulationStatus } from "../simulation/simulation-engine.js";
import { TASK_STATUSES } from "../simulation/task.js";
import { TRAVEL_STATUSES, type FictionalTravelLocation } from "../simulation/travel.js";

export const PUBLIC_SIMULATION_SCHEMA_VERSION = "resq.simulation.v1" as const;
export const CHAOS_ENGINE_VERSION = "0.1.0" as const;
export const PUBLIC_EXPORT_DIFFICULTIES = ["CALM", "BUSY", "CHAOS", "EXTREME"] as const;

export type PublicExportDifficulty = (typeof PUBLIC_EXPORT_DIFFICULTIES)[number];

export interface PublicSimulationExportOptions {
  readonly exportTimeMs?: number;
  readonly difficulty?: PublicExportDifficulty;
  readonly scenarioLabel?: string;
  readonly replayManifest?: PublicReplayManifest;
}

export interface PublicReplayManifest {
  readonly presetVersion: "phase7b.v1";
  readonly engineVersion: typeof CHAOS_ENGINE_VERSION;
  readonly schemaVersion: typeof PUBLIC_SIMULATION_SCHEMA_VERSION;
  readonly scenario: "flood" | "earthquake" | "storm" | "fire";
  readonly difficulty: PublicExportDifficulty;
  readonly seed: string;
  readonly reportCount: number;
  readonly responderCount: number;
  readonly durationMs: number;
}

export interface PublicExportLocation {
  readonly fictional: true;
  readonly coordinateSystem: "SIMULATED_LOCAL_GRID";
  readonly x: number;
  readonly y: number;
  readonly district: string | null;
  readonly primaryReference: string | null;
  readonly secondaryReference: string | null;
  readonly description: string;
  readonly precision: "EXACT" | "APPROXIMATE" | null;
}

export interface PublicExportClaim {
  readonly code: string;
  readonly statement: string;
  readonly stage: "NEWLY_OBSERVED" | "ONGOING" | "IMPROVING";
  readonly assistanceRequested: boolean;
  readonly value: string | null;
  readonly confidence: "LOW" | "MEDIUM" | "HIGH" | null;
  readonly detailStatus: "OBSERVED" | "UNKNOWN" | null;
}

export interface PublicExportEmergencyObservation {
  readonly reportId: string;
  readonly category: (typeof REPORT_CATEGORIES)[number];
  readonly sourceType: (typeof REPORT_SOURCE_TYPES)[number];
  readonly observedAt: string;
  readonly submittedAt: string;
  readonly receivedAt: string;
  readonly location: PublicExportLocation;
  readonly narrative: string;
  readonly claims: readonly PublicExportClaim[];
  readonly status: "RECEIVED";
  readonly urgency: "LOW" | "MODERATE" | "HIGH" | "CRITICAL" | null;
  readonly sourceMetadata: Readonly<{
    channel: "VOICE" | "RADIO" | "SENSOR_NETWORK" | "HOTLINE" | "COMMUNITY_NETWORK" | "FIELD_NOTE";
    organizationLabel: string | null;
    sensorKind: string | null;
  }> | null;
}

export interface PublicExportOperationalContent {
  readonly availabilityState: (typeof RESPONDER_AVAILABILITY_STATES)[number] | null;
  readonly taskStatus: (typeof TASK_STATUSES)[number] | null;
  readonly travelStatus: (typeof TRAVEL_STATUSES)[number] | null;
  readonly communicationState: (typeof COMMUNICATION_STATES)[number] | null;
  readonly location: PublicExportLocation | null;
  readonly routeVersion: number | null;
  readonly fatigue: number | null;
  readonly equipmentItem: string | null;
  readonly equipmentCondition: "OPERATIONAL" | "DEGRADED" | "UNAVAILABLE" | "UNDER_REPAIR" | null;
  readonly inventory: Readonly<Record<string, number>> | null;
}

export interface PublicExportOperationalObservation {
  readonly observationId: string;
  readonly unitId: string;
  readonly assignmentId: string | null;
  readonly messageType: (typeof OPERATIONAL_MESSAGE_TYPES)[number];
  readonly observedAt: string;
  readonly submittedAt: string;
  readonly receivedAt: string;
  readonly source: "RESPONDER_UNIT" | "SIMULATION_SYSTEM";
  readonly deliveryStatus: "DELIVERED";
  readonly content: PublicExportOperationalContent;
}

export interface PublicExportUnit {
  readonly unitId: string;
  readonly callsign: string;
  readonly latestObservedAt: string;
  readonly latestReceivedAt: string;
  readonly availabilityState: (typeof RESPONDER_AVAILABILITY_STATES)[number] | null;
  readonly assignmentId: string | null;
  readonly taskStatus: (typeof TASK_STATUSES)[number] | null;
  readonly travelStatus: (typeof TRAVEL_STATUSES)[number] | null;
  readonly communicationState: (typeof COMMUNICATION_STATES)[number] | null;
  readonly location: PublicExportLocation | null;
}

export interface PublicExportAssignment {
  readonly assignmentId: string;
  readonly unitId: string;
  readonly firstReceivedAt: string;
}

export interface PublicSimulationExport {
  readonly schemaVersion: typeof PUBLIC_SIMULATION_SCHEMA_VERSION;
  readonly engineVersion: typeof CHAOS_ENGINE_VERSION;
  readonly runId: string;
  readonly scenario: Readonly<{
    scenarioId: string;
    seed: string;
    fictional: true;
    label: string;
    difficulty: PublicExportDifficulty | null;
  }>;
  readonly simulationTime: Readonly<{
    startTime: string;
    exportTime: string;
    status: SimulationStatus;
  }>;
  readonly emergencyObservations: readonly PublicExportEmergencyObservation[];
  readonly operationalObservations: readonly PublicExportOperationalObservation[];
  readonly units: readonly PublicExportUnit[];
  readonly assignments: readonly PublicExportAssignment[];
  readonly replayManifest: PublicReplayManifest | null;
  readonly summary: Readonly<{
    emergencyObservationCount: number;
    operationalObservationCount: number;
    unitCount: number;
    assignmentCount: number;
    firstReceivedAt: string | null;
    lastReceivedAt: string | null;
  }>;
}

export interface PublicExportValidationError {
  readonly path: string;
  readonly message: string;
}

export interface PublicExportValidationResult {
  readonly valid: boolean;
  readonly errors: readonly PublicExportValidationError[];
}

export interface WritePublicSimulationExportOptions {
  readonly destinationDirectory: string;
  readonly filename?: string;
  readonly overwrite?: boolean;
}

export class PublicSimulationExportError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PublicSimulationExportError";
  }
}

/**
 * Exports only the current command-center-visible state. Historical timestamps
 * are rejected because the engine does not maintain a historical knowledge index.
 */
export function createPublicSimulationExport(
  engine: SimulationEngine,
  options: PublicSimulationExportOptions = {},
): PublicSimulationExport {
  const state = engine.getState();
  const exportTimeMs = options.exportTimeMs ?? state.currentTimeMs;
  if (!Number.isSafeInteger(exportTimeMs)) throw new PublicSimulationExportError("exportTimeMs must be a safe integer.");
  if (exportTimeMs !== state.currentTimeMs) {
    throw new PublicSimulationExportError(exportTimeMs < state.currentTimeMs
      ? "Historical exports are unsupported; export the engine at the requested virtual time."
      : "Export time cannot be later than the engine's current virtual time.");
  }
  if (options.difficulty !== undefined && !PUBLIC_EXPORT_DIFFICULTIES.includes(options.difficulty)) throw new PublicSimulationExportError("Unsupported export difficulty.");
  const label = options.scenarioLabel ?? `Fictional simulation: ${state.scenarioId}`;
  if (label.trim().length === 0 || label.length > 256) throw new PublicSimulationExportError("scenarioLabel must contain 1 to 256 characters.");

  const emergency = [...engine.getPublicObservations()]
    .filter((item) => item.receivedAtMs <= exportTimeMs)
    .sort((left, right) => left.receivedAtMs - right.receivedAtMs || compareText(left.reportId, right.reportId));
  const operational = [...engine.getPublicOperationalObservations()]
    .filter((item) => item.receivedAtMs <= exportTimeMs)
    .sort((left, right) => left.receivedAtMs - right.receivedAtMs || compareText(left.messageId, right.messageId));

  const responderIds = [...new Set(operational.map((item) => item.responderId))]
    .sort((left, right) => compareText(engine.getResponder(left)?.callsign ?? left, engine.getResponder(right)?.callsign ?? right));
  const unitIds = new Map(responderIds.map((id, index) => [id, `unit_${String(index + 1).padStart(6, "0")}`]));
  const taskIds = [...new Set(operational.flatMap((item) => item.relatedTaskId === undefined ? [] : [item.relatedTaskId]))]
    .sort(compareText);
  const assignmentIds = new Map(taskIds.map((id, index) => [id, `assignment_${String(index + 1).padStart(6, "0")}`]));

  const emergencyObservations = Object.freeze(emergency.map(projectEmergencyObservation));
  const operationalObservations = Object.freeze(operational.map((item, index) => projectOperationalObservation(item, index, unitIds, assignmentIds)));
  const units = buildPublicUnits(engine, operational, unitIds, assignmentIds);
  const assignments = buildPublicAssignments(operational, unitIds, assignmentIds);
  const receiptTimes = [
    ...emergencyObservations.map((item) => item.receivedAt),
    ...operationalObservations.map((item) => item.receivedAt),
  ].sort(compareText);

  const document: PublicSimulationExport = deepFreeze({
    schemaVersion: PUBLIC_SIMULATION_SCHEMA_VERSION,
    engineVersion: CHAOS_ENGINE_VERSION,
    runId: state.runId,
    scenario: {
      scenarioId: state.scenarioId,
      seed: engine.config.seed,
      fictional: true,
      label,
      difficulty: options.difficulty ?? null,
    },
    simulationTime: {
      startTime: formatTimestamp(state.startTimeMs),
      exportTime: formatTimestamp(exportTimeMs),
      status: state.status,
    },
    emergencyObservations,
    operationalObservations,
    units,
    assignments,
    replayManifest: options.replayManifest ?? null,
    summary: {
      emergencyObservationCount: emergencyObservations.length,
      operationalObservationCount: operationalObservations.length,
      unitCount: units.length,
      assignmentCount: assignments.length,
      firstReceivedAt: receiptTimes[0] ?? null,
      lastReceivedAt: receiptTimes.at(-1) ?? null,
    },
  });
  assertValid(document);
  return document;
}

export function validatePublicSimulationExport(value: unknown): PublicExportValidationResult {
  const errors: PublicExportValidationError[] = [];
  const error = (path: string, message: string): void => { errors.push(Object.freeze({ path, message })); };
  if (!isRecord(value)) return Object.freeze({ valid: false, errors: Object.freeze([{ path: "$", message: "Document must be an object." }]) });
  onlyKeys(value, ["schemaVersion", "engineVersion", "runId", "scenario", "simulationTime", "emergencyObservations", "operationalObservations", "units", "assignments", "replayManifest", "summary"], "$", error);
  if (value.schemaVersion !== PUBLIC_SIMULATION_SCHEMA_VERSION) error("$.schemaVersion", "Unsupported schema version.");
  if (value.engineVersion !== CHAOS_ENGINE_VERSION) error("$.engineVersion", "Unsupported engine version.");
  requireIdentifier(value.runId, "$.runId", error);

  const scenario = recordAt(value.scenario, "$.scenario", error);
  if (scenario !== undefined) {
    onlyKeys(scenario, ["scenarioId", "seed", "fictional", "label", "difficulty"], "$.scenario", error);
    requireBoundedString(scenario.scenarioId, 128, "$.scenario.scenarioId", error);
    requireBoundedString(scenario.seed, 256, "$.scenario.seed", error);
    if (scenario.fictional !== true) error("$.scenario.fictional", "Scenario must be explicitly fictional.");
    requireBoundedString(scenario.label, 256, "$.scenario.label", error);
    if (scenario.difficulty !== null && !PUBLIC_EXPORT_DIFFICULTIES.includes(scenario.difficulty as PublicExportDifficulty)) error("$.scenario.difficulty", "Invalid difficulty.");
  }

  const simulation = recordAt(value.simulationTime, "$.simulationTime", error);
  let exportTime: string | undefined;
  if (simulation !== undefined) {
    onlyKeys(simulation, ["startTime", "exportTime", "status"], "$.simulationTime", error);
    const start = requireTimestamp(simulation.startTime, "$.simulationTime.startTime", error);
    exportTime = requireTimestamp(simulation.exportTime, "$.simulationTime.exportTime", error);
    if (start !== undefined && exportTime !== undefined && start > exportTime) error("$.simulationTime", "Start time must not follow export time.");
    if (!["READY", "RUNNING", "PAUSED", "COMPLETED", "FAILED"].includes(String(simulation.status))) error("$.simulationTime.status", "Invalid simulation status.");
  }

  const units = arrayAt(value.units, "$.units", error);
  const unitIds = new Set<string>();
  if (units !== undefined) units.forEach((item, index) => validateUnit(item, index, unitIds, exportTime, error));
  const assignments = arrayAt(value.assignments, "$.assignments", error);
  const assignmentIds = new Set<string>();
  if (assignments !== undefined) assignments.forEach((item, index) => validateAssignment(item, index, unitIds, assignmentIds, exportTime, error));
  if (units !== undefined) units.forEach((item, index) => {
    if (isRecord(item) && item.assignmentId !== null) reference(item.assignmentId, assignmentIds, `$.units[${index}].assignmentId`, error);
  });
  if (value.replayManifest !== null) validateReplayManifest(value.replayManifest, "$.replayManifest", error);
  const reports = arrayAt(value.emergencyObservations, "$.emergencyObservations", error);
  const reportIds = new Set<string>();
  if (reports !== undefined) reports.forEach((item, index) => validateEmergencyObservation(item, index, reportIds, exportTime, error));
  const operations = arrayAt(value.operationalObservations, "$.operationalObservations", error);
  const operationIds = new Set<string>();
  if (operations !== undefined) operations.forEach((item, index) => validateOperationalObservation(item, index, operationIds, unitIds, assignmentIds, exportTime, error));
  validateSorted(reports, "$.emergencyObservations", "reportId", error);
  validateSorted(operations, "$.operationalObservations", "observationId", error);

  const summary = recordAt(value.summary, "$.summary", error);
  if (summary !== undefined) {
    onlyKeys(summary, ["emergencyObservationCount", "operationalObservationCount", "unitCount", "assignmentCount", "firstReceivedAt", "lastReceivedAt"], "$.summary", error);
    validateCount(summary.emergencyObservationCount, reports?.length, "$.summary.emergencyObservationCount", error);
    validateCount(summary.operationalObservationCount, operations?.length, "$.summary.operationalObservationCount", error);
    validateCount(summary.unitCount, units?.length, "$.summary.unitCount", error);
    validateCount(summary.assignmentCount, assignments?.length, "$.summary.assignmentCount", error);
    const receipts = [
      ...(reports ?? []).map((item) => isRecord(item) ? item.receivedAt : undefined),
      ...(operations ?? []).map((item) => isRecord(item) ? item.receivedAt : undefined),
    ].filter((item): item is string => typeof item === "string").sort(compareText);
    if (summary.firstReceivedAt !== (receipts[0] ?? null)) error("$.summary.firstReceivedAt", "Summary first receipt is inconsistent.");
    if (summary.lastReceivedAt !== (receipts.at(-1) ?? null)) error("$.summary.lastReceivedAt", "Summary last receipt is inconsistent.");
  }
  auditForbiddenKeys(value, "$", error);
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function serializePublicSimulationExport(document: unknown): string {
  assertValid(document);
  return `${JSON.stringify(canonicalize(document))}\n`;
}

export function createSafeExportFilename(document: Pick<PublicSimulationExport, "scenario" | "runId">): string {
  const scenario = document.scenario.scenarioId.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "simulation";
  const run = document.runId.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return `${scenario}-${run}.json`;
}

export async function writePublicSimulationExport(document: unknown, options: WritePublicSimulationExportOptions): Promise<string> {
  if (!isRecord(options) || typeof options.destinationDirectory !== "string" || options.destinationDirectory.length === 0) throw new PublicSimulationExportError("An explicit destinationDirectory is required.");
  assertValid(document);
  const typed = document as PublicSimulationExport;
  const filename = options.filename ?? createSafeExportFilename(typed);
  validateFilename(filename);
  const directory = resolve(options.destinationDirectory);
  let stats;
  try { stats = await lstat(directory); } catch (cause) { throw new PublicSimulationExportError(`Destination directory is not accessible: ${messageOf(cause)}`); }
  if (!stats.isDirectory()) throw new PublicSimulationExportError("Destination path must be an existing directory.");
  const destination = resolve(directory, filename);
  if (destination !== join(directory, filename) || !destination.startsWith(`${directory}${sep}`)) throw new PublicSimulationExportError("Export filename escapes the selected destination directory.");
  const temporary = join(directory, `.${filename}.${process.pid}.${temporaryToken(typed)}.tmp`);
  const serialized = serializePublicSimulationExport(typed);
  try {
    await writeFile(temporary, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
    if (options.overwrite === true) {
      try { await rename(temporary, destination); }
      catch (cause) {
        if (!isReplaceError(cause)) throw cause;
        // Sandboxed Windows may prohibit rename replacement. The validated
        // temporary file is copied over the explicit target, then removed.
        await copyFile(temporary, destination);
        await unlink(temporary);
      }
    } else {
      // COPYFILE_EXCL provides race-safe no-overwrite behavior on platforms
      // where an atomic hard-link is unavailable (notably sandboxed Windows).
      await copyFile(temporary, destination, fsConstants.COPYFILE_EXCL);
      await unlink(temporary);
    }
    return destination;
  } catch (cause) {
    try { await unlink(temporary); } catch { /* best-effort cleanup */ }
    if (isExistsError(cause)) throw new PublicSimulationExportError(`Export file already exists: ${filename}`);
    throw new PublicSimulationExportError(`Unable to write export: ${messageOf(cause)}`);
  }
}

function projectEmergencyObservation(item: PublicEmergencyObservation): PublicExportEmergencyObservation {
  return deepFreeze({
    reportId: item.reportId,
    category: item.category,
    sourceType: item.sourceType,
    observedAt: formatTimestamp(item.observedAtMs),
    submittedAt: formatTimestamp(item.submittedAtMs),
    receivedAt: formatTimestamp(item.receivedAtMs),
    location: projectReportLocation(item.location),
    narrative: item.narrative,
    claims: item.claims.map((claim) => ({ code: claim.code, statement: claim.statement, stage: claim.stage, assistanceRequested: claim.assistanceRequested, value: claim.value ?? null, confidence: claim.confidence ?? null, detailStatus: claim.detailStatus ?? null })),
    status: item.status,
    urgency: item.urgency ?? null,
    sourceMetadata: item.sourceMetadata === undefined ? null : { channel: item.sourceMetadata.channel, organizationLabel: item.sourceMetadata.organizationLabel ?? null, sensorKind: item.sourceMetadata.sensorKind ?? null },
  });
}

function projectOperationalObservation(item: PublicOperationalObservation, index: number, units: ReadonlyMap<string, string>, assignments: ReadonlyMap<string, string>): PublicExportOperationalObservation {
  return deepFreeze({
    observationId: `operation_${String(index + 1).padStart(8, "0")}`,
    unitId: units.get(item.responderId)!,
    assignmentId: item.relatedTaskId === undefined ? null : assignments.get(item.relatedTaskId) ?? null,
    messageType: item.messageType,
    observedAt: formatTimestamp(item.observedAtMs),
    submittedAt: formatTimestamp(item.submittedAtMs),
    receivedAt: formatTimestamp(item.receivedAtMs),
    source: item.source,
    deliveryStatus: "DELIVERED",
    content: projectOperationalContent(item.content),
  });
}

function projectOperationalContent(content: OperationalMessageContent): PublicExportOperationalContent {
  return deepFreeze({
    availabilityState: content.availabilityState ?? null,
    taskStatus: content.taskStatus ?? null,
    travelStatus: content.travelStatus ?? null,
    communicationState: content.communicationState ?? null,
    location: content.location === undefined ? null : projectTravelLocation(content.location),
    routeVersion: content.routeVersion ?? null,
    fatigue: content.fatigue ?? null,
    equipmentItem: content.equipmentItem ?? null,
    equipmentCondition: content.equipmentCondition ?? null,
    inventory: content.inventory === undefined ? null : Object.fromEntries(Object.entries(content.inventory).sort(([left], [right]) => compareText(left, right))),
  });
}

function buildPublicUnits(engine: SimulationEngine, observations: readonly PublicOperationalObservation[], unitIds: ReadonlyMap<string, string>, assignmentIds: ReadonlyMap<string, string>): readonly PublicExportUnit[] {
  const latest = new Map<string, { observedAtMs: number; receivedAtMs: number; messageId: string; content: OperationalMessageContent; taskId?: string }>();
  for (const item of observations) {
    const current = latest.get(item.responderId);
    if (current === undefined || item.observedAtMs > current.observedAtMs || (item.observedAtMs === current.observedAtMs && (item.receivedAtMs > current.receivedAtMs || (item.receivedAtMs === current.receivedAtMs && compareText(item.messageId, current.messageId) > 0)))) {
      const taskId = item.relatedTaskId ?? current?.taskId;
      latest.set(item.responderId, { observedAtMs: item.observedAtMs, receivedAtMs: item.receivedAtMs, messageId: item.messageId, content: { ...current?.content, ...item.content }, ...(taskId === undefined ? {} : { taskId }) });
    }
  }
  return Object.freeze([...unitIds.entries()].map(([responderId, unitId]) => {
    const known = latest.get(responderId)!;
    const responder = engine.getResponder(responderId);
    if (responder === undefined) throw new PublicSimulationExportError("Delivered observation references an unknown responder.");
    return deepFreeze({
      unitId,
      callsign: responder.callsign,
      latestObservedAt: formatTimestamp(known.observedAtMs),
      latestReceivedAt: formatTimestamp(known.receivedAtMs),
      availabilityState: known.content.availabilityState ?? null,
      assignmentId: known.taskId === undefined ? null : assignmentIds.get(known.taskId) ?? null,
      taskStatus: known.content.taskStatus ?? null,
      travelStatus: known.content.travelStatus ?? null,
      communicationState: known.content.communicationState ?? null,
      location: known.content.location === undefined ? null : projectTravelLocation(known.content.location),
    });
  }));
}

function buildPublicAssignments(observations: readonly PublicOperationalObservation[], unitIds: ReadonlyMap<string, string>, assignmentIds: ReadonlyMap<string, string>): readonly PublicExportAssignment[] {
  const first = new Map<string, PublicOperationalObservation>();
  for (const item of observations) if (item.relatedTaskId !== undefined && !first.has(item.relatedTaskId)) first.set(item.relatedTaskId, item);
  return Object.freeze([...assignmentIds.entries()].map(([taskId, assignmentId]) => {
    const item = first.get(taskId)!;
    return Object.freeze({ assignmentId, unitId: unitIds.get(item.responderId)!, firstReceivedAt: formatTimestamp(item.receivedAtMs) });
  }));
}

function projectReportLocation(location: PublicEmergencyObservation["location"]): PublicExportLocation {
  return deepFreeze({ fictional: true, coordinateSystem: "SIMULATED_LOCAL_GRID", x: location.x, y: location.y, district: location.district, primaryReference: location.primaryReference, secondaryReference: location.secondaryReference ?? null, description: location.description, precision: location.precision ?? null });
}

function projectTravelLocation(location: FictionalTravelLocation): PublicExportLocation {
  const label = location.label ?? "Fictional reported location";
  return deepFreeze({ fictional: true, coordinateSystem: "SIMULATED_LOCAL_GRID", x: location.x, y: location.y, district: null, primaryReference: label, secondaryReference: null, description: label, precision: "EXACT" });
}

function validateEmergencyObservation(value: unknown, index: number, ids: Set<string>, exportTime: string | undefined, error: ErrorWriter): void {
  const path = `$.emergencyObservations[${index}]`; const item = recordAt(value, path, error); if (item === undefined) return;
  onlyKeys(item, ["reportId", "category", "sourceType", "observedAt", "submittedAt", "receivedAt", "location", "narrative", "claims", "status", "urgency", "sourceMetadata"], path, error);
  uniqueIdentifier(item.reportId, `${path}.reportId`, ids, error);
  if (!REPORT_CATEGORIES.includes(item.category as never)) error(`${path}.category`, "Invalid report category.");
  if (!REPORT_SOURCE_TYPES.includes(item.sourceType as never)) error(`${path}.sourceType`, "Invalid report source.");
  const observed = requireTimestamp(item.observedAt, `${path}.observedAt`, error); const submitted = requireTimestamp(item.submittedAt, `${path}.submittedAt`, error); const received = requireTimestamp(item.receivedAt, `${path}.receivedAt`, error);
  validateTimeOrder(observed, submitted, received, exportTime, path, error); validateLocation(item.location, `${path}.location`, error);
  requireString(item.narrative, `${path}.narrative`, error); if (item.status !== "RECEIVED") error(`${path}.status`, "Invalid report status.");
  if (item.urgency !== null && !["LOW", "MODERATE", "HIGH", "CRITICAL"].includes(String(item.urgency))) error(`${path}.urgency`, "Invalid urgency.");
  const claims = arrayAt(item.claims, `${path}.claims`, error); if (claims !== undefined) claims.forEach((claim, claimIndex) => validateClaim(claim, `${path}.claims[${claimIndex}]`, error));
  if (item.sourceMetadata !== null) validateSourceMetadata(item.sourceMetadata, `${path}.sourceMetadata`, error);
}

function validateOperationalObservation(value: unknown, index: number, ids: Set<string>, units: Set<string>, assignments: Set<string>, exportTime: string | undefined, error: ErrorWriter): void {
  const path = `$.operationalObservations[${index}]`; const item = recordAt(value, path, error); if (item === undefined) return;
  onlyKeys(item, ["observationId", "unitId", "assignmentId", "messageType", "observedAt", "submittedAt", "receivedAt", "source", "deliveryStatus", "content"], path, error);
  uniqueIdentifier(item.observationId, `${path}.observationId`, ids, error); reference(item.unitId, units, `${path}.unitId`, error); if (item.assignmentId !== null) reference(item.assignmentId, assignments, `${path}.assignmentId`, error);
  if (!OPERATIONAL_MESSAGE_TYPES.includes(item.messageType as never)) error(`${path}.messageType`, "Invalid operational message type.");
  if (!["RESPONDER_UNIT", "SIMULATION_SYSTEM"].includes(String(item.source))) error(`${path}.source`, "Invalid source."); if (item.deliveryStatus !== "DELIVERED") error(`${path}.deliveryStatus`, "Only delivered observations are exportable.");
  const observed = requireTimestamp(item.observedAt, `${path}.observedAt`, error); const submitted = requireTimestamp(item.submittedAt, `${path}.submittedAt`, error); const received = requireTimestamp(item.receivedAt, `${path}.receivedAt`, error); validateTimeOrder(observed, submitted, received, exportTime, path, error);
  validateOperationalContent(item.content, `${path}.content`, error);
}

function validateUnit(value: unknown, index: number, ids: Set<string>, exportTime: string | undefined, error: ErrorWriter): void {
  const path = `$.units[${index}]`; const item = recordAt(value, path, error); if (item === undefined) return;
  onlyKeys(item, ["unitId", "callsign", "latestObservedAt", "latestReceivedAt", "availabilityState", "assignmentId", "taskStatus", "travelStatus", "communicationState", "location"], path, error);
  uniqueIdentifier(item.unitId, `${path}.unitId`, ids, error); requireString(item.callsign, `${path}.callsign`, error);
  const observed = requireTimestamp(item.latestObservedAt, `${path}.latestObservedAt`, error); const received = requireTimestamp(item.latestReceivedAt, `${path}.latestReceivedAt`, error); if (observed !== undefined && received !== undefined && observed > received) error(path, "Unit observation time follows receipt time."); if (received !== undefined && exportTime !== undefined && received > exportTime) error(path, "Unit knowledge is from the future.");
  nullableEnum(item.availabilityState, RESPONDER_AVAILABILITY_STATES, `${path}.availabilityState`, error); nullableEnum(item.taskStatus, TASK_STATUSES, `${path}.taskStatus`, error); nullableEnum(item.travelStatus, TRAVEL_STATUSES, `${path}.travelStatus`, error); nullableEnum(item.communicationState, COMMUNICATION_STATES, `${path}.communicationState`, error); if (item.assignmentId !== null) requireIdentifier(item.assignmentId, `${path}.assignmentId`, error); if (item.location !== null) validateLocation(item.location, `${path}.location`, error);
}

function validateAssignment(value: unknown, index: number, units: Set<string>, ids: Set<string>, exportTime: string | undefined, error: ErrorWriter): void {
  const path = `$.assignments[${index}]`; const item = recordAt(value, path, error); if (item === undefined) return; onlyKeys(item, ["assignmentId", "unitId", "firstReceivedAt"], path, error); uniqueIdentifier(item.assignmentId, `${path}.assignmentId`, ids, error); reference(item.unitId, units, `${path}.unitId`, error); const received = requireTimestamp(item.firstReceivedAt, `${path}.firstReceivedAt`, error); if (received !== undefined && exportTime !== undefined && received > exportTime) error(path, "Assignment is from the future.");
}

function validateReplayManifest(value: unknown, path: string, error: ErrorWriter): void { const item = recordAt(value, path, error); if (item === undefined) return; onlyKeys(item, ["presetVersion", "engineVersion", "schemaVersion", "scenario", "difficulty", "seed", "reportCount", "responderCount", "durationMs"], path, error); if (item.presetVersion !== "phase7b.v1") error(`${path}.presetVersion`, "Unsupported preset version."); if (item.engineVersion !== CHAOS_ENGINE_VERSION) error(`${path}.engineVersion`, "Engine version is incompatible."); if (item.schemaVersion !== PUBLIC_SIMULATION_SCHEMA_VERSION) error(`${path}.schemaVersion`, "Schema version is incompatible."); if (!["flood", "earthquake", "storm", "fire"].includes(String(item.scenario))) error(`${path}.scenario`, "Invalid scenario."); if (!PUBLIC_EXPORT_DIFFICULTIES.includes(item.difficulty as PublicExportDifficulty)) error(`${path}.difficulty`, "Invalid difficulty."); requireBoundedString(item.seed, 256, `${path}.seed`, error); boundedInteger(item.reportCount, 1, 10_000, `${path}.reportCount`, error); boundedInteger(item.responderCount, 1, 1_000, `${path}.responderCount`, error); boundedInteger(item.durationMs, 600_000, 7 * 24 * 60 * 60 * 1_000, `${path}.durationMs`, error); }

function validateOperationalContent(value: unknown, path: string, error: ErrorWriter): void {
  const item = recordAt(value, path, error); if (item === undefined) return; onlyKeys(item, ["availabilityState", "taskStatus", "travelStatus", "communicationState", "location", "routeVersion", "fatigue", "equipmentItem", "equipmentCondition", "inventory"], path, error);
  nullableEnum(item.availabilityState, RESPONDER_AVAILABILITY_STATES, `${path}.availabilityState`, error); nullableEnum(item.taskStatus, TASK_STATUSES, `${path}.taskStatus`, error); nullableEnum(item.travelStatus, TRAVEL_STATUSES, `${path}.travelStatus`, error); nullableEnum(item.communicationState, COMMUNICATION_STATES, `${path}.communicationState`, error);
  if (item.location !== null) validateLocation(item.location, `${path}.location`, error); nullableBoundedInteger(item.routeVersion, 0, 1_000_000, `${path}.routeVersion`, error); nullableBoundedNumber(item.fatigue, 0, 100, `${path}.fatigue`, error); if (item.equipmentItem !== null) requireString(item.equipmentItem, `${path}.equipmentItem`, error); if (item.equipmentCondition !== null && !["OPERATIONAL", "DEGRADED", "UNAVAILABLE", "UNDER_REPAIR"].includes(String(item.equipmentCondition))) error(`${path}.equipmentCondition`, "Invalid equipment condition.");
  if (item.inventory !== null) { const inventory = recordAt(item.inventory, `${path}.inventory`, error); if (inventory !== undefined) for (const [key, quantity] of Object.entries(inventory)) { requireString(key, `${path}.inventory key`, error); boundedInteger(quantity, 0, 10_000, `${path}.inventory.${key}`, error); } }
}

function validateLocation(value: unknown, path: string, error: ErrorWriter): void { const item = recordAt(value, path, error); if (item === undefined) return; onlyKeys(item, ["fictional", "coordinateSystem", "x", "y", "district", "primaryReference", "secondaryReference", "description", "precision"], path, error); if (item.fictional !== true || item.coordinateSystem !== "SIMULATED_LOCAL_GRID") error(path, "Location must be explicitly fictional local-grid data."); boundedNumber(item.x, -1_000_000, 1_000_000, `${path}.x`, error); boundedNumber(item.y, -1_000_000, 1_000_000, `${path}.y`, error); for (const key of ["district", "primaryReference", "secondaryReference"] as const) if (item[key] !== null) requireString(item[key], `${path}.${key}`, error); requireString(item.description, `${path}.description`, error); if (item.precision !== null && !["EXACT", "APPROXIMATE"].includes(String(item.precision))) error(`${path}.precision`, "Invalid location precision."); }
function validateClaim(value: unknown, path: string, error: ErrorWriter): void { const item = recordAt(value, path, error); if (item === undefined) return; onlyKeys(item, ["code", "statement", "stage", "assistanceRequested", "value", "confidence", "detailStatus"], path, error); requireString(item.code, `${path}.code`, error); requireString(item.statement, `${path}.statement`, error); if (!["NEWLY_OBSERVED", "ONGOING", "IMPROVING"].includes(String(item.stage))) error(`${path}.stage`, "Invalid observation stage."); if (typeof item.assistanceRequested !== "boolean") error(`${path}.assistanceRequested`, "Must be boolean."); if (item.value !== null) requireString(item.value, `${path}.value`, error); if (item.confidence !== null && !["LOW", "MEDIUM", "HIGH"].includes(String(item.confidence))) error(`${path}.confidence`, "Invalid confidence."); if (item.detailStatus !== null && !["OBSERVED", "UNKNOWN"].includes(String(item.detailStatus))) error(`${path}.detailStatus`, "Invalid detail status."); }
function validateSourceMetadata(value: unknown, path: string, error: ErrorWriter): void { const item = recordAt(value, path, error); if (item === undefined) return; onlyKeys(item, ["channel", "organizationLabel", "sensorKind"], path, error); if (!["VOICE", "RADIO", "SENSOR_NETWORK", "HOTLINE", "COMMUNITY_NETWORK", "FIELD_NOTE"].includes(String(item.channel))) error(`${path}.channel`, "Invalid channel."); if (item.organizationLabel !== null) requireString(item.organizationLabel, `${path}.organizationLabel`, error); if (item.sensorKind !== null) requireString(item.sensorKind, `${path}.sensorKind`, error); }

const FORBIDDEN_KEYS = new Set(["internalIncidentId", "relatedIncidentId", "responderId", "relatedResponderId", "relatedTaskId", "taskId", "messageId", "severity", "environment", "infrastructure", "causeEventId", "ruleId", "cascadeDepth", "duplicateFamilyId", "duplicateOfReportId", "contradictionOfReportId", "sourceQuality", "reliabilityScore", "groundTruthLocation", "futureEvents", "failureReason", "attemptCount", "actualState", "privateEvaluation"]);
function auditForbiddenKeys(value: unknown, path: string, error: ErrorWriter): void { if (Array.isArray(value)) { value.forEach((item, index) => auditForbiddenKeys(item, `${path}[${index}]`, error)); return; } if (!isRecord(value)) return; for (const [key, item] of Object.entries(value)) { if (FORBIDDEN_KEYS.has(key)) error(`${path}.${key}`, "Forbidden private field."); auditForbiddenKeys(item, `${path}.${key}`, error); } }

type ErrorWriter = (path: string, message: string) => void;
function assertValid(value: unknown): asserts value is PublicSimulationExport { const result = validatePublicSimulationExport(value); if (!result.valid) throw new PublicSimulationExportError(`Public export validation failed: ${result.errors.map((item) => `${item.path} ${item.message}`).join("; ")}`); }
function formatTimestamp(value: number): string { const date = new Date(value); if (!Number.isSafeInteger(value) || Number.isNaN(date.getTime())) throw new PublicSimulationExportError("Virtual timestamp cannot be represented as ISO-8601."); return date.toISOString(); }
function requireTimestamp(value: unknown, path: string, error: ErrorWriter): string | undefined { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) { error(path, "Invalid canonical UTC timestamp."); return undefined; } return value; }
function validateTimeOrder(observed: string | undefined, submitted: string | undefined, received: string | undefined, exportTime: string | undefined, path: string, error: ErrorWriter): void { if (observed !== undefined && submitted !== undefined && observed > submitted) error(path, "Observation follows submission."); if (submitted !== undefined && received !== undefined && submitted > received) error(path, "Submission follows receipt."); if (received !== undefined && exportTime !== undefined && received > exportTime) error(path, "Observation was received after export time."); }
function validateSorted(values: unknown[] | undefined, path: string, idKey: string, error: ErrorWriter): void { if (values === undefined) return; for (let index = 1; index < values.length; index += 1) { const left = values[index - 1]; const right = values[index]; if (isRecord(left) && isRecord(right) && typeof left.receivedAt === "string" && typeof right.receivedAt === "string" && (left.receivedAt > right.receivedAt || (left.receivedAt === right.receivedAt && String(left[idKey]) > String(right[idKey])))) error(`${path}[${index}]`, "Observations are not in canonical receipt order."); } }
function validateCount(value: unknown, expected: number | undefined, path: string, error: ErrorWriter): void { boundedInteger(value, 0, 1_000_000, path, error); if (expected !== undefined && value !== expected) error(path, "Summary count is inconsistent."); }
function uniqueIdentifier(value: unknown, path: string, ids: Set<string>, error: ErrorWriter): void { if (!requireIdentifier(value, path, error)) return; if (ids.has(value)) error(path, "Identifier must be unique."); ids.add(value); }
function reference(value: unknown, ids: Set<string>, path: string, error: ErrorWriter): void { if (typeof value !== "string" || !ids.has(value)) error(path, "Reference does not resolve."); }
function nullableEnum(value: unknown, allowed: readonly string[], path: string, error: ErrorWriter): void { if (value !== null && (typeof value !== "string" || !allowed.includes(value))) error(path, "Invalid enumeration value."); }
function nullableBoundedInteger(value: unknown, min: number, max: number, path: string, error: ErrorWriter): void { if (value !== null) boundedInteger(value, min, max, path, error); }
function nullableBoundedNumber(value: unknown, min: number, max: number, path: string, error: ErrorWriter): void { if (value !== null) boundedNumber(value, min, max, path, error); }
function boundedInteger(value: unknown, min: number, max: number, path: string, error: ErrorWriter): void { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) error(path, `Must be an integer from ${min} to ${max}.`); }
function boundedNumber(value: unknown, min: number, max: number, path: string, error: ErrorWriter): void { if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) error(path, `Must be a finite number from ${min} to ${max}.`); }
function requireIdentifier(value: unknown, path: string, error: ErrorWriter): value is string { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) { error(path, "Invalid identifier."); return false; } return true; }
function requireString(value: unknown, path: string, error: ErrorWriter): value is string { if (typeof value !== "string" || value.length === 0 || value.length > 2_000) { error(path, "Must be a non-empty bounded string."); return false; } return true; }
function requireBoundedString(value: unknown, maximumLength: number, path: string, error: ErrorWriter): value is string { if (typeof value !== "string" || value.length === 0 || value.length > maximumLength) { error(path, `Must be a non-empty string no longer than ${maximumLength} characters.`); return false; } return true; }
function recordAt(value: unknown, path: string, error: ErrorWriter): Record<string, unknown> | undefined { if (!isRecord(value)) { error(path, "Must be an object."); return undefined; } return value; }
function arrayAt(value: unknown, path: string, error: ErrorWriter): unknown[] | undefined { if (!Array.isArray(value) || value.length > 100_000) { error(path, "Must be a bounded array."); return undefined; } return value; }
function onlyKeys(value: Record<string, unknown>, keys: readonly string[], path: string, error: ErrorWriter): void { const allowed = new Set(keys); for (const key of Object.keys(value)) if (!allowed.has(key)) error(`${path}.${key}`, "Unexpected property."); for (const key of keys) if (!(key in value)) error(`${path}.${key}`, "Required property is missing."); }
function canonicalize(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonicalize); if (!isRecord(value)) { if (typeof value === "number" && !Number.isFinite(value)) throw new PublicSimulationExportError("JSON contains a non-finite number."); if (value === undefined) throw new PublicSimulationExportError("JSON contains undefined."); return value; } return Object.fromEntries(Object.keys(value).sort(compareText).map((key) => [key, canonicalize(value[key])])); }
function deepFreeze<T>(value: T): T { if (Array.isArray(value)) { value.forEach(deepFreeze); return Object.freeze(value) as T; } if (isRecord(value)) { Object.values(value).forEach(deepFreeze); return Object.freeze(value) as T; } return value; }
function validateFilename(filename: string): void { if (filename !== basename(filename) || filename.includes("..") || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.json$/.test(filename)) throw new PublicSimulationExportError("Export filename must be a safe local .json filename without traversal segments."); }
function temporaryToken(document: PublicSimulationExport): string { let hash = 2166136261; for (const char of `${document.runId}\0${document.simulationTime.exportTime}`) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(36); }
function isExistsError(value: unknown): boolean { return isNodeError(value) && value.code === "EEXIST"; }
function isReplaceError(value: unknown): boolean { return isNodeError(value) && (value.code === "EEXIST" || value.code === "EPERM"); }
function isNodeError(value: unknown): value is NodeJS.ErrnoException { return value instanceof Error && "code" in value; }
function messageOf(value: unknown): string { return value instanceof Error ? value.message : String(value); }
function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
