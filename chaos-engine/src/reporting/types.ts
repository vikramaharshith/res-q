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

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const REPORT_SOURCE_TYPES = [
  "CIVILIAN_CALLER",
  "EMERGENCY_RESPONDER",
  "AUTOMATED_SENSOR",
  "EMERGENCY_HOTLINE",
  "COMMUNITY_ORGANIZATION",
  "FIELD_OBSERVER",
] as const;

export type ReportSourceType = (typeof REPORT_SOURCE_TYPES)[number];
export type ReportStatus = "RECEIVED";
export type ObservableUrgency = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
export type ObservationStage = "NEWLY_OBSERVED" | "ONGOING" | "IMPROVING";
export type ClaimConfidence = "LOW" | "MEDIUM" | "HIGH";
export type ClaimDetailStatus = "OBSERVED" | "UNKNOWN";

export interface FictionalReportLocation {
  readonly fictional: true;
  readonly coordinateSystem: "SIMULATED_LOCAL_GRID";
  readonly x: number;
  readonly y: number;
  readonly district: string;
  readonly primaryReference: string;
  readonly secondaryReference?: string;
  readonly description: string;
  readonly precision?: "EXACT" | "APPROXIMATE";
}

export interface ObservableClaim {
  readonly code: string;
  readonly statement: string;
  readonly stage: ObservationStage;
  readonly assistanceRequested: boolean;
  readonly value?: string;
  readonly confidence?: ClaimConfidence;
  readonly detailStatus?: ClaimDetailStatus;
}

export interface PublicSourceMetadata {
  readonly channel:
    | "VOICE"
    | "RADIO"
    | "SENSOR_NETWORK"
    | "HOTLINE"
    | "COMMUNITY_NETWORK"
    | "FIELD_NOTE";
  readonly organizationLabel?: string;
  readonly sensorKind?: string;
}

/** Internal report record. internalIncidentId is deliberately privileged. */
export interface EmergencyReport {
  readonly id: string;
  readonly runId: string;
  readonly internalIncidentId: string;
  readonly category: ReportCategory;
  readonly sourceType: ReportSourceType;
  readonly location: FictionalReportLocation;
  readonly observedAtMs: number;
  readonly submittedAtMs: number;
  readonly receivedAtMs: number;
  readonly narrative: string;
  readonly claims: readonly ObservableClaim[];
  readonly status: ReportStatus;
  readonly urgency?: ObservableUrgency;
  readonly sourceMetadata?: PublicSourceMetadata;
}

/** Allowlisted AI-facing observation with no internal incident association. */
export interface PublicEmergencyObservation {
  readonly reportId: string;
  readonly runId: string;
  readonly category: ReportCategory;
  readonly sourceType: ReportSourceType;
  readonly location: FictionalReportLocation;
  readonly observedAtMs: number;
  readonly submittedAtMs: number;
  readonly receivedAtMs: number;
  readonly narrative: string;
  readonly claims: readonly ObservableClaim[];
  readonly status: ReportStatus;
  readonly urgency?: ObservableUrgency;
  readonly sourceMetadata?: PublicSourceMetadata;
}

export interface FictionalGeographyConfig {
  readonly districts?: readonly string[];
  readonly roads?: readonly string[];
  readonly landmarks?: readonly string[];
  readonly buildings?: readonly string[];
  readonly originX?: number;
  readonly originY?: number;
  readonly clusterRadius?: number;
}

export interface ReportGenerationConfig {
  readonly reportCount: number;
  readonly incidentIds?: readonly string[];
  readonly startTimeMs?: number;
  readonly frequencyMs?: number;
  readonly categories?: readonly ReportCategory[];
  readonly sourceWeights?: Partial<Record<ReportSourceType, number>>;
  readonly geography?: FictionalGeographyConfig;
  readonly noise?: import("./noise.js").InformationNoiseConfig;
}

export function projectPublicObservation(report: EmergencyReport): PublicEmergencyObservation {
  const location = freezeLocation(report.location);
  const claims = Object.freeze(
    report.claims.map((claim) =>
      Object.freeze({
        code: claim.code,
        statement: claim.statement,
        stage: claim.stage,
        assistanceRequested: claim.assistanceRequested,
        ...(claim.value === undefined ? {} : { value: claim.value }),
        ...(claim.confidence === undefined ? {} : { confidence: claim.confidence }),
        ...(claim.detailStatus === undefined ? {} : { detailStatus: claim.detailStatus }),
      }),
    ),
  );
  const sourceMetadata =
    report.sourceMetadata === undefined
      ? undefined
      : Object.freeze({
          channel: report.sourceMetadata.channel,
          ...(report.sourceMetadata.organizationLabel === undefined
            ? {}
            : { organizationLabel: report.sourceMetadata.organizationLabel }),
          ...(report.sourceMetadata.sensorKind === undefined
            ? {}
            : { sensorKind: report.sourceMetadata.sensorKind }),
        });

  return Object.freeze({
    reportId: report.id,
    runId: report.runId,
    category: report.category,
    sourceType: report.sourceType,
    location,
    observedAtMs: report.observedAtMs,
    submittedAtMs: report.submittedAtMs,
    receivedAtMs: report.receivedAtMs,
    narrative: report.narrative,
    claims,
    status: report.status,
    ...(report.urgency === undefined ? {} : { urgency: report.urgency }),
    ...(sourceMetadata === undefined ? {} : { sourceMetadata }),
  });
}

export function freezeEmergencyReport(report: EmergencyReport): EmergencyReport {
  return Object.freeze({
    ...report,
    location: freezeLocation(report.location),
    claims: Object.freeze(report.claims.map((claim) => Object.freeze({ ...claim }))),
    ...(report.sourceMetadata === undefined
      ? {}
      : { sourceMetadata: Object.freeze({ ...report.sourceMetadata }) }),
  });
}

function freezeLocation(location: FictionalReportLocation): FictionalReportLocation {
  return Object.freeze({
    fictional: true,
    coordinateSystem: "SIMULATED_LOCAL_GRID",
    x: location.x,
    y: location.y,
    district: location.district,
    primaryReference: location.primaryReference,
    ...(location.secondaryReference === undefined
      ? {}
      : { secondaryReference: location.secondaryReference }),
    description: location.description,
    ...(location.precision === undefined ? {} : { precision: location.precision }),
  });
}

