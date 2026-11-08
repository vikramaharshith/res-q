/**
 * Adapter-owned types for the public `resq.simulation.v1` contract.
 * Phase 0 keeps these documents in memory. It does not persist them.
 */

export const SCHEMA_VERSION = "resq.simulation.v1" as const;
export const ENGINE_VERSION = "0.1.0" as const;
export const SCHEMA_ID = "https://resq.invalid/schemas/simulation-v1.json" as const;
export const MAX_IMPORT_BYTES = 32 * 1024 * 1024;
export const MAX_NESTING_DEPTH = 16;
export const MAX_ISSUES = 20;

export const FORBIDDEN_SIMULATION_KEYS = [
  "internalIncidentId",
  "relatedIncidentId",
  "responderId",
  "relatedResponderId",
  "relatedTaskId",
  "taskId",
  "messageId",
  "severity",
  "environment",
  "infrastructure",
  "causeEventId",
  "ruleId",
  "cascadeDepth",
  "duplicateFamilyId",
  "duplicateOfReportId",
  "contradictionOfReportId",
  "sourceQuality",
  "reliabilityScore",
  "groundTruthLocation",
  "futureEvents",
  "failureReason",
  "attemptCount",
  "actualState",
  "privateEvaluation",
] as const;

export const REPORT_CATEGORIES = [
  "FLOODED_STRUCTURE",
  "STRANDED_VEHICLE",
  "WATER_RESCUE",
  "EVACUATION_REQUEST",
  "MEDICAL_ASSISTANCE",
  "STRUCTURE_FIRE",
  "BUILDING_COLLAPSE",
  "ROAD_OBSTRUCTION",
  "ELECTRICAL_HAZARD",
  "COMMUNICATION_OUTAGE",
  "POWER_OUTAGE",
  "SHELTER_SHORTAGE",
  "SUPPLY_REQUEST",
  "INFRASTRUCTURE_FAILURE",
  "WELFARE_CHECK",
  "HAZARDOUS_CONDITIONS",
] as const;

export const REPORT_SOURCE_TYPES = [
  "CIVILIAN_CALLER",
  "EMERGENCY_RESPONDER",
  "AUTOMATED_SENSOR",
  "EMERGENCY_HOTLINE",
  "COMMUNITY_ORGANIZATION",
  "FIELD_OBSERVER",
] as const;

export const OBSERVATION_STAGES = ["NEWLY_OBSERVED", "ONGOING", "IMPROVING"] as const;
export const CONFIDENCE_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export const DETAIL_STATUSES = ["OBSERVED", "UNKNOWN"] as const;
export const URGENCY_LEVELS = ["LOW", "MODERATE", "HIGH", "CRITICAL"] as const;
export const SOURCE_CHANNELS = [
  "VOICE",
  "RADIO",
  "SENSOR_NETWORK",
  "HOTLINE",
  "COMMUNITY_NETWORK",
  "FIELD_NOTE",
] as const;
export const OPERATIONAL_MESSAGE_TYPES = [
  "RESPONDER_REGISTERED",
  "ASSIGNMENT_ACKNOWLEDGED",
  "UNIT_DEPARTED",
  "POSITION_UPDATED",
  "ROUTE_UPDATED",
  "ARRIVAL_REPORTED",
  "TASK_STARTED",
  "TASK_COMPLETED",
  "TASK_FAILED",
  "TASK_CANCELLED",
  "UNIT_UNAVAILABLE",
  "COMMUNICATION_LOST",
  "COMMUNICATION_RESTORED",
  "RECOVERY_STARTED",
  "RECOVERY_COMPLETED",
  "EQUIPMENT_STATUS_CHANGED",
  "REPLENISHMENT_COMPLETED",
] as const;
export const OBSERVATION_SOURCES = ["RESPONDER_UNIT", "SIMULATION_SYSTEM"] as const;
export const AVAILABILITY_STATES = [
  "AVAILABLE",
  "RESERVED",
  "EN_ROUTE",
  "ON_SCENE",
  "BUSY",
  "RECOVERING",
  "OFFLINE",
] as const;
export const TASK_STATUSES = [
  "PENDING",
  "ASSIGNED",
  "EN_ROUTE",
  "IN_PROGRESS",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export const TRAVEL_STATUSES = ["EN_ROUTE", "ARRIVED", "BLOCKED", "INTERRUPTED", "CANCELLED"] as const;
export const COMMUNICATION_STATES = [
  "CONNECTED",
  "DEGRADED",
  "INTERMITTENT",
  "OFFLINE",
  "RECOVERING",
] as const;
export const EQUIPMENT_CONDITIONS = ["OPERATIONAL", "DEGRADED", "UNAVAILABLE", "UNDER_REPAIR"] as const;
export const LOCATION_PRECISIONS = ["EXACT", "APPROXIMATE"] as const;
export const SIMULATION_STATUSES = ["READY", "RUNNING", "PAUSED", "COMPLETED", "FAILED"] as const;
export const EXPORT_DIFFICULTIES = ["CALM", "BUSY", "CHAOS", "EXTREME"] as const;
export const REPLAY_SCENARIOS = ["flood", "earthquake", "storm", "fire"] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];
export type ReportSourceType = (typeof REPORT_SOURCE_TYPES)[number];
export type ObservationStage = (typeof OBSERVATION_STAGES)[number];
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];
export type DetailStatus = (typeof DETAIL_STATUSES)[number];
export type UrgencyLevel = (typeof URGENCY_LEVELS)[number];
export type SourceChannel = (typeof SOURCE_CHANNELS)[number];
export type OperationalMessageType = (typeof OPERATIONAL_MESSAGE_TYPES)[number];
export type ObservationSource = (typeof OBSERVATION_SOURCES)[number];
export type AvailabilityState = (typeof AVAILABILITY_STATES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TravelStatus = (typeof TRAVEL_STATUSES)[number];
export type CommunicationState = (typeof COMMUNICATION_STATES)[number];
export type EquipmentCondition = (typeof EQUIPMENT_CONDITIONS)[number];
export type LocationPrecision = (typeof LOCATION_PRECISIONS)[number];
export type SimulationStatus = (typeof SIMULATION_STATUSES)[number];
export type ExportDifficulty = (typeof EXPORT_DIFFICULTIES)[number];
export type ReplayScenario = (typeof REPLAY_SCENARIOS)[number];

export interface PublicLocation {
  readonly fictional: true;
  readonly coordinateSystem: "SIMULATED_LOCAL_GRID";
  readonly x: number;
  readonly y: number;
  readonly district: string | null;
  readonly primaryReference: string | null;
  readonly secondaryReference: string | null;
  readonly description: string;
  readonly precision: LocationPrecision | null;
}

export interface PublicClaim {
  readonly code: string;
  readonly statement: string;
  readonly stage: ObservationStage;
  readonly assistanceRequested: boolean;
  readonly value: string | null;
  readonly confidence: ConfidenceLevel | null;
  readonly detailStatus: DetailStatus | null;
}

export interface PublicSourceMetadata {
  readonly channel: SourceChannel;
  readonly organizationLabel: string | null;
  readonly sensorKind: string | null;
}

export interface PublicEmergencyObservation {
  readonly reportId: string;
  readonly category: ReportCategory;
  readonly sourceType: ReportSourceType;
  readonly observedAt: string;
  readonly submittedAt: string;
  readonly receivedAt: string;
  readonly location: PublicLocation;
  readonly narrative: string;
  readonly claims: readonly PublicClaim[];
  readonly status: "RECEIVED";
  readonly urgency: UrgencyLevel | null;
  readonly sourceMetadata: PublicSourceMetadata | null;
}

export interface PublicOperationalContent {
  readonly availabilityState: AvailabilityState | null;
  readonly taskStatus: TaskStatus | null;
  readonly travelStatus: TravelStatus | null;
  readonly communicationState: CommunicationState | null;
  readonly location: PublicLocation | null;
  readonly routeVersion: number | null;
  readonly fatigue: number | null;
  readonly equipmentItem: string | null;
  readonly equipmentCondition: EquipmentCondition | null;
  readonly inventory: Readonly<Record<string, number>> | null;
}

export interface PublicOperationalObservation {
  readonly observationId: string;
  readonly unitId: string;
  readonly assignmentId: string | null;
  readonly messageType: OperationalMessageType;
  readonly observedAt: string;
  readonly submittedAt: string;
  readonly receivedAt: string;
  readonly source: ObservationSource;
  readonly deliveryStatus: "DELIVERED";
  readonly content: PublicOperationalContent;
}

export interface PublicUnit {
  readonly unitId: string;
  readonly callsign: string;
  readonly latestObservedAt: string;
  readonly latestReceivedAt: string;
  readonly availabilityState: AvailabilityState | null;
  readonly assignmentId: string | null;
  readonly taskStatus: TaskStatus | null;
  readonly travelStatus: TravelStatus | null;
  readonly communicationState: CommunicationState | null;
  readonly location: PublicLocation | null;
}

export interface PublicAssignment {
  readonly assignmentId: string;
  readonly unitId: string;
  readonly firstReceivedAt: string;
}

export interface PublicReplayManifest {
  readonly presetVersion: "phase7b.v1";
  readonly engineVersion: typeof ENGINE_VERSION;
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly scenario: ReplayScenario;
  readonly difficulty: ExportDifficulty;
  readonly seed: string;
  readonly reportCount: number;
  readonly responderCount: number;
  readonly durationMs: number;
}

export interface PublicSimulationDocument {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly engineVersion: typeof ENGINE_VERSION;
  readonly runId: string;
  readonly scenario: {
    readonly scenarioId: string;
    readonly seed: string;
    readonly fictional: true;
    readonly label: string;
    readonly difficulty: ExportDifficulty | null;
  };
  readonly simulationTime: {
    readonly startTime: string;
    readonly exportTime: string;
    readonly status: SimulationStatus;
  };
  readonly emergencyObservations: readonly PublicEmergencyObservation[];
  readonly operationalObservations: readonly PublicOperationalObservation[];
  readonly units: readonly PublicUnit[];
  readonly assignments: readonly PublicAssignment[];
  readonly replayManifest: PublicReplayManifest | null;
  readonly summary: {
    readonly emergencyObservationCount: number;
    readonly operationalObservationCount: number;
    readonly unitCount: number;
    readonly assignmentCount: number;
    readonly firstReceivedAt: string | null;
    readonly lastReceivedAt: string | null;
  };
}

export interface SimulationImport {
  readonly source: {
    readonly digestAlgorithm: "SHA-256";
    readonly digestHex: string;
    readonly byteLength: number;
    readonly idempotencyKey: string;
  };
  readonly document: PublicSimulationDocument;
}

export type ImportStage =
  | "read"
  | "parse"
  | "version"
  | "schema"
  | "cross-reference"
  | "duplicate"
  | "staging"
  | "commit";

export interface ImportIssue {
  readonly path: string;
  readonly message: string;
}

export interface ImportFailure {
  readonly ok: false;
  readonly stage: ImportStage;
  readonly issues: readonly ImportIssue[];
}

export interface ImportSuccess {
  readonly ok: true;
  readonly simulation: SimulationImport;
}

export type ImportResult = ImportSuccess | ImportFailure;

export interface ImportLedger {
  findByKey(idempotencyKey: string): SimulationImport | undefined;
  findByRun(schemaVersion: string, runId: string): SimulationImport | undefined;
  commit(record: SimulationImport): void;
}

export interface ImportTextOptions {
  readonly maxBytes?: number;
}
