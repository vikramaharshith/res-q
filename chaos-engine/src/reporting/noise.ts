import { SeededRng, type RandomStream } from "../core/random.js";
import { SimulationConfigError, SimulationEventError } from "../simulation/errors.js";
import type { IncidentSnapshot, IncidentStatus } from "../simulation/incident.js";
import {
  REPORT_SOURCE_TYPES,
  freezeEmergencyReport,
  type EmergencyReport,
  type FictionalReportLocation,
  type ObservableClaim,
  type PublicSourceMetadata,
  type ReportCategory,
  type ReportSourceType,
} from "./types.js";

export type NoiseKind =
  | "duplicate"
  | "contradiction"
  | "missingDetail"
  | "delay"
  | "stale"
  | "locationError";

export interface SourceQualityAdjustment {
  readonly contradictionMultiplier?: number;
  readonly missingDetailMultiplier?: number;
  readonly delayMultiplier?: number;
  readonly staleMultiplier?: number;
  readonly locationErrorMultiplier?: number;
  readonly confidenceAdjustment?: number;
}

export interface InformationNoiseConfig {
  readonly duplicateProbability?: number;
  readonly contradictionProbability?: number;
  readonly missingDetailProbability?: number;
  readonly delayProbability?: number;
  readonly staleProbability?: number;
  readonly locationErrorProbability?: number;
  readonly maxDuplicatesPerOriginal?: number;
  readonly minAdditionalDelayMs?: number;
  readonly maxAdditionalDelayMs?: number;
  readonly maxLocationOffset?: number;
  readonly sourceQualityAdjustments?: Partial<Record<ReportSourceType, SourceQualityAdjustment>>;
  readonly probabilityOverrides?: Partial<Record<NoiseKind, boolean>>;
  readonly maxFinalReportCount?: number;
}

export interface ValidatedNoiseConfig {
  readonly enabled: boolean;
  readonly duplicateProbability: number;
  readonly contradictionProbability: number;
  readonly missingDetailProbability: number;
  readonly delayProbability: number;
  readonly staleProbability: number;
  readonly locationErrorProbability: number;
  readonly maxDuplicatesPerOriginal: number;
  readonly minAdditionalDelayMs: number;
  readonly maxAdditionalDelayMs: number;
  readonly maxLocationOffset: number;
  readonly sourceQualityAdjustments: Readonly<
    Partial<Record<ReportSourceType, Readonly<Required<SourceQualityAdjustment>>>>
  >;
  readonly probabilityOverrides: Readonly<Partial<Record<NoiseKind, boolean>>>;
  readonly maxFinalReportCount: number;
}

export type InformationTransformation =
  | "DUPLICATE"
  | "CONTRADICTION"
  | "OMITTED_DETAIL"
  | "EXPLICIT_UNKNOWN"
  | "LOW_CONFIDENCE"
  | "ADDITIONAL_DELAY"
  | "STALE_CANDIDATE"
  | "LOCATION_OFFSET";

export interface PrivateSourceQuality {
  readonly profile: ReportSourceType;
  readonly reliabilityScore: number;
  readonly contradictionMultiplier: number;
  readonly missingDetailMultiplier: number;
  readonly delayMultiplier: number;
  readonly staleMultiplier: number;
  readonly locationErrorMultiplier: number;
  readonly confidenceAdjustment: number;
}

export interface PrivateReportEvaluation {
  readonly reportId: string;
  readonly internalIncidentId: string;
  readonly duplicateFamilyId?: string;
  readonly duplicateOfReportId?: string;
  readonly contradictionOfReportId?: string;
  readonly transformations: readonly InformationTransformation[];
  readonly omittedDetailCodes: readonly string[];
  readonly explicitUnknownDetailCodes: readonly string[];
  readonly lowConfidenceClaimCodes: readonly string[];
  readonly groundTruthLocation: FictionalReportLocation;
  readonly appliedLocationOffset: Readonly<{ x: number; y: number }>;
  readonly additionalDelayMs: number;
  readonly staleCandidate: boolean;
  readonly isStale: boolean;
  readonly truthfulness: "OBSERVATION_AT_TIME";
  readonly observedAtMs: number;
  readonly observedIncidentState: Readonly<{
    status: IncidentStatus;
    severity: number;
    lastUpdatedAtMs: number;
  }>;
  readonly deliveryIncidentState?: Readonly<{
    status: IncidentStatus;
    severity: number;
    lastUpdatedAtMs: number;
  }>;
  readonly sourceQuality: PrivateSourceQuality;
}

export interface GeneratedReportPlan {
  readonly report: EmergencyReport;
  readonly evaluation: PrivateReportEvaluation;
}

const LOW_NOISE_DEFAULTS = {
  duplicateProbability: 0.05,
  contradictionProbability: 0.06,
  missingDetailProbability: 0.12,
  delayProbability: 0.15,
  staleProbability: 0.04,
  locationErrorProbability: 0.1,
  maxDuplicatesPerOriginal: 1,
  minAdditionalDelayMs: 10_000,
  maxAdditionalDelayMs: 120_000,
  maxLocationOffset: 200,
  maxFinalReportCount: 20_000,
} as const;

const ZERO_NOISE: ValidatedNoiseConfig = Object.freeze({
  enabled: false,
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
  sourceQualityAdjustments: Object.freeze({}),
  probabilityOverrides: Object.freeze({}),
  maxFinalReportCount: 10_000,
});

const SOURCE_PROFILES: Readonly<Record<ReportSourceType, PrivateSourceQuality>> = {
  CIVILIAN_CALLER: profile("CIVILIAN_CALLER", 0.62, 1.25, 1.3, 1.2, 1.25, 1.3, -0.15),
  EMERGENCY_RESPONDER: profile("EMERGENCY_RESPONDER", 0.86, 0.65, 0.6, 0.65, 0.75, 0.55, 0.2),
  AUTOMATED_SENSOR: profile("AUTOMATED_SENSOR", 0.8, 0.75, 0.8, 0.45, 0.6, 0.35, 0.15),
  EMERGENCY_HOTLINE: profile("EMERGENCY_HOTLINE", 0.72, 1, 1.05, 1.1, 1.1, 1, 0),
  COMMUNITY_ORGANIZATION: profile("COMMUNITY_ORGANIZATION", 0.7, 1.05, 1.1, 1.05, 1.05, 1.1, -0.05),
  FIELD_OBSERVER: profile("FIELD_OBSERVER", 0.82, 0.8, 0.75, 0.8, 0.8, 0.7, 0.1),
};

const CONTRADICTIONS: Readonly<
  Record<ReportCategory, { value: string; statement: string }>
> = {
  FLOODED_STRUCTURE: { value: "SHALLOW_WATER", statement: "water appears shallow and is not entering the main floor" },
  STRANDED_VEHICLE: { value: "VEHICLE_MOVING", statement: "the vehicle appears able to move from the access road" },
  WATER_RESCUE: { value: "NO_RESCUE_VISIBLE", statement: "no person currently appears to require a water rescue" },
  EVACUATION_REQUEST: { value: "EVACUATION_COMPLETE", statement: "the visible evacuation appears to be complete" },
  MEDICAL_ASSISTANCE: { value: "NO_MEDICAL_REQUEST", statement: "no immediate medical assistance is being requested" },
  STRUCTURE_FIRE: { value: "SMOKE_DECREASING", statement: "visible smoke appears to be decreasing" },
  BUILDING_COLLAPSE: { value: "STRUCTURE_STANDING", statement: "the visible portion of the structure appears to remain standing" },
  ROAD_OBSTRUCTION: { value: "ROAD_PASSABLE", statement: "the roadway appears passable to ordinary vehicles" },
  ELECTRICAL_HAZARD: { value: "NO_VISIBLE_ELECTRICAL_HAZARD", statement: "no damaged electrical equipment is visible from the observation point" },
  COMMUNICATION_OUTAGE: { value: "COMMUNICATIONS_WORKING", statement: "local communication service appears to be functioning" },
  POWER_OUTAGE: { value: "POWER_AVAILABLE", statement: "visible building power appears to be functioning" },
  SHELTER_SHORTAGE: { value: "SHELTER_SPACE_AVAILABLE", statement: "shelter staff report that space remains available" },
  SUPPLY_REQUEST: { value: "SUPPLIES_ADEQUATE", statement: "the visible supply point appears adequately stocked" },
  INFRASTRUCTURE_FAILURE: { value: "INFRASTRUCTURE_OPERATING", statement: "the observed public facility appears to be operating" },
  WELFARE_CHECK: { value: "WELFARE_CONFIRMED", statement: "the occupant's welfare has reportedly been confirmed" },
  HAZARDOUS_CONDITIONS: { value: "ACCESS_APPEARS_SAFE", statement: "the observed access route appears clear of immediate hazards" },
};

export function validateNoiseConfig(input: InformationNoiseConfig | undefined): ValidatedNoiseConfig {
  if (input === undefined) return ZERO_NOISE;
  if (typeof input !== "object" || input === null) {
    throw new SimulationConfigError("noise must be an object when provided.");
  }
  const minDelay = boundedInteger(input.minAdditionalDelayMs, LOW_NOISE_DEFAULTS.minAdditionalDelayMs, 0, 86_400_000, "minAdditionalDelayMs");
  const maxDelay = boundedInteger(input.maxAdditionalDelayMs, LOW_NOISE_DEFAULTS.maxAdditionalDelayMs, 0, 86_400_000, "maxAdditionalDelayMs");
  if (minDelay > maxDelay) throw new SimulationConfigError("Minimum noise delay cannot exceed maximum delay.");
  const sourceAdjustments: Partial<Record<ReportSourceType, Required<SourceQualityAdjustment>>> = {};
  for (const source of REPORT_SOURCE_TYPES) {
    const adjustment = input.sourceQualityAdjustments?.[source];
    if (adjustment !== undefined) sourceAdjustments[source] = validateAdjustment(adjustment, source);
  }
  const overrides = input.probabilityOverrides ?? {};
  for (const [key, value] of Object.entries(overrides)) {
    if (!["duplicate", "contradiction", "missingDetail", "delay", "stale", "locationError"].includes(key) || typeof value !== "boolean") {
      throw new SimulationConfigError("Noise probability overrides must be supported boolean values.");
    }
  }
  return Object.freeze({
    enabled: true,
    duplicateProbability: probability(input.duplicateProbability, LOW_NOISE_DEFAULTS.duplicateProbability, "duplicateProbability"),
    contradictionProbability: probability(input.contradictionProbability, LOW_NOISE_DEFAULTS.contradictionProbability, "contradictionProbability"),
    missingDetailProbability: probability(input.missingDetailProbability, LOW_NOISE_DEFAULTS.missingDetailProbability, "missingDetailProbability"),
    delayProbability: probability(input.delayProbability, LOW_NOISE_DEFAULTS.delayProbability, "delayProbability"),
    staleProbability: probability(input.staleProbability, LOW_NOISE_DEFAULTS.staleProbability, "staleProbability"),
    locationErrorProbability: probability(input.locationErrorProbability, LOW_NOISE_DEFAULTS.locationErrorProbability, "locationErrorProbability"),
    maxDuplicatesPerOriginal: boundedInteger(input.maxDuplicatesPerOriginal, 1, 0, 5, "maxDuplicatesPerOriginal"),
    minAdditionalDelayMs: minDelay,
    maxAdditionalDelayMs: maxDelay,
    maxLocationOffset: boundedInteger(input.maxLocationOffset, 200, 0, 10_000, "maxLocationOffset"),
    sourceQualityAdjustments: Object.freeze(sourceAdjustments),
    probabilityOverrides: Object.freeze({ ...overrides }),
    maxFinalReportCount: boundedInteger(input.maxFinalReportCount, 20_000, 1, 100_000, "maxFinalReportCount"),
  });
}

export class InformationNoiseProcessor {
  readonly #identityMaterial: string;
  readonly #rng: SeededRng;
  readonly #previousByIncidentCategory = new Map<string, EmergencyReport>();

  public constructor(identityMaterial: string) {
    this.#identityMaterial = identityMaterial;
    this.#rng = new SeededRng(`${identityMaterial}\u0000information-noise`);
  }

  public apply(
    baseReports: readonly EmergencyReport[],
    incidents: ReadonlyMap<string, IncidentSnapshot>,
    config: ValidatedNoiseConfig,
    maximumTimeMs: number,
  ): readonly GeneratedReportPlan[] {
    const plans: GeneratedReportPlan[] = [];
    for (const baseReport of baseReports) {
      const incident = incidents.get(baseReport.internalIncidentId);
      if (incident === undefined) throw new SimulationEventError("Noise processing requires an existing incident.");
      const priorKey = `${incident.id}\u0000${baseReport.category}`;
      const previous = this.#previousByIncidentCategory.get(priorKey);
      const originalPlan = this.#transform(baseReport, incident, config, maximumTimeMs, previous);
      const duplicateCount = this.#duplicateCount(baseReport.id, originalPlan.report.sourceType, config);
      const familyId = duplicateCount > 0 ? `family_${baseReport.id}` : undefined;
      plans.push(withFamily(originalPlan, familyId));
      this.#previousByIncidentCategory.set(priorKey, originalPlan.report);

      for (let duplicateIndex = 0; duplicateIndex < duplicateCount; duplicateIndex += 1) {
        plans.push(this.#duplicate(originalPlan, incident, duplicateIndex, familyId ?? `family_${baseReport.id}`, config, maximumTimeMs));
      }
    }
    if (plans.length > config.maxFinalReportCount) {
      throw new SimulationConfigError("Noise expansion exceeds maxFinalReportCount.");
    }
    return Object.freeze(plans);
  }

  #transform(
    base: EmergencyReport,
    incident: IncidentSnapshot,
    config: ValidatedNoiseConfig,
    maximumTimeMs: number,
    previous: EmergencyReport | undefined,
  ): GeneratedReportPlan {
    const key = base.id;
    const quality = effectiveQuality(base.sourceType, config);
    if (isEffectivelyZero(config)) {
      return Object.freeze({
        report: base,
        evaluation: evaluationFor(
          base,
          incident,
          base.location,
          { x: 0, y: 0 },
          quality,
          [],
          [],
          [],
          [],
          0,
          false,
        ),
      });
    }
    const transformations: InformationTransformation[] = [];
    const omitted: string[] = [];
    const unknown: string[] = [];
    const lowConfidence: string[] = [];
    let claims = base.claims.map((claim) => ({ ...claim }));
    let contradictionOfReportId: string | undefined;

    if (previous !== undefined && applies(config, "contradiction", quality.contradictionMultiplier, this.#rng.stream(`${key}:contradiction`))) {
      const opposite = CONTRADICTIONS[base.category];
      const original = claims[0];
      if (original !== undefined && previous.claims[0]?.value !== opposite.value) {
        claims[0] = { ...original, value: opposite.value, statement: opposite.statement, confidence: confidenceFor(quality.confidenceAdjustment) };
        transformations.push("CONTRADICTION");
        contradictionOfReportId = previous.id;
      }
    }

    if (applies(config, "missingDetail", quality.missingDetailMultiplier, this.#rng.stream(`${key}:missing`))) {
      const mode = this.#rng.stream(`${key}:missing-mode`).nextInt(0, 3);
      if (mode === 0 && claims.length > 1) {
        const removed = claims.pop();
        if (removed !== undefined) omitted.push(removed.code);
        transformations.push("OMITTED_DETAIL");
      } else if (mode === 1) {
        const target = claims[1] ?? claims[0];
        if (target !== undefined) {
          const replacement = { ...target, value: "UNKNOWN", statement: "the related access details are explicitly unknown", detailStatus: "UNKNOWN" as const, confidence: "LOW" as const };
          if (claims.length > 1) claims[1] = replacement;
          else claims[0] = replacement;
          unknown.push(replacement.code);
          transformations.push("EXPLICIT_UNKNOWN");
        }
      } else {
        const target = claims[0];
        if (target !== undefined) {
          claims[0] = { ...target, statement: `the observer is not certain whether ${target.statement}`, confidence: "LOW", detailStatus: "OBSERVED" };
          lowConfidence.push(target.code);
          transformations.push("LOW_CONFIDENCE");
        }
      }
    }

    const groundTruthLocation = base.location;
    let location = base.location;
    let locationOffset = { x: 0, y: 0 };
    if (config.maxLocationOffset > 0 && applies(config, "locationError", quality.locationErrorMultiplier, this.#rng.stream(`${key}:location-error`))) {
      locationOffset = boundedOffset(this.#rng.stream(`${key}:location-offset`), config.maxLocationOffset);
      location = noisyLocation(base.location, locationOffset);
      transformations.push("LOCATION_OFFSET");
    }

    let additionalDelayMs = 0;
    const staleCandidate = applies(config, "stale", quality.staleMultiplier, this.#rng.stream(`${key}:stale`));
    const delayed = applies(config, "delay", quality.delayMultiplier, this.#rng.stream(`${key}:delay`));
    if (delayed || staleCandidate) {
      additionalDelayMs = this.#rng.stream(`${key}:delay-duration`).nextInt(config.minAdditionalDelayMs, config.maxAdditionalDelayMs + 1);
      transformations.push("ADDITIONAL_DELAY");
      if (staleCandidate) transformations.push("STALE_CANDIDATE");
    }
    const receivedAtMs = base.receivedAtMs + additionalDelayMs;
    if (receivedAtMs > maximumTimeMs) throw new SimulationConfigError("Noisy report delivery exceeds maximum simulation duration.");
    const frozenClaims = Object.freeze(claims.map((claim) => Object.freeze(claim)));
    const report = freezeEmergencyReport({
      ...base,
      location,
      receivedAtMs,
      claims: frozenClaims,
      narrative: renderNarrative(base.sourceType, location.description, frozenClaims, base.urgency, key),
    });
    return Object.freeze({
      report,
      evaluation: evaluationFor(report, incident, groundTruthLocation, locationOffset, quality, transformations, omitted, unknown, lowConfidence, additionalDelayMs, staleCandidate, contradictionOfReportId),
    });
  }

  #duplicateCount(reportId: string, source: ReportSourceType, config: ValidatedNoiseConfig): number {
    if (config.maxDuplicatesPerOriginal === 0 || !applies(config, "duplicate", 1, this.#rng.stream(`${reportId}:duplicate`))) return 0;
    return this.#rng.stream(`${reportId}:duplicate-count`).nextInt(1, config.maxDuplicatesPerOriginal + 1);
  }

  #duplicate(
    original: GeneratedReportPlan,
    incident: IncidentSnapshot,
    duplicateIndex: number,
    familyId: string,
    config: ValidatedNoiseConfig,
    maximumTimeMs: number,
  ): GeneratedReportPlan {
    const key = `${original.report.id}:duplicate:${duplicateIndex}`;
    const stream = this.#rng.stream(`${key}:source`);
    const sourceType = REPORT_SOURCE_TYPES[stream.nextInt(0, REPORT_SOURCE_TYPES.length)] ?? original.report.sourceType;
    const quality = effectiveQuality(sourceType, config);
    const extraDelay = this.#rng
      .stream(`${key}:delay`)
      .nextInt(config.minAdditionalDelayMs, config.maxAdditionalDelayMs + 1);
    const submittedAtMs = Math.max(original.report.submittedAtMs, original.report.observedAtMs) + duplicateIndex + 1;
    const receivedAtMs = Math.max(submittedAtMs, original.report.receivedAtMs + extraDelay);
    if (receivedAtMs > maximumTimeMs) throw new SimulationConfigError("Duplicate delivery exceeds maximum simulation duration.");
    const offset = config.maxLocationOffset > 0 ? boundedOffset(this.#rng.stream(`${key}:location`), Math.min(config.maxLocationOffset, 30)) : { x: 0, y: 0 };
    const location = offset.x === 0 && offset.y === 0 ? original.report.location : noisyLocation(original.evaluation.groundTruthLocation, offset);
    const idPart = this.#rng.stream(`${key}:identifier`).nextUint32().toString(36).padStart(7, "0");
    const id = `rpt_dup_${original.report.id.slice(4, 17)}_${duplicateIndex.toString(36)}_${idPart}`;
    const claims = Object.freeze(original.report.claims.map((claim) => Object.freeze({ ...claim })));
    const report = freezeEmergencyReport({
      ...original.report,
      id,
      sourceType,
      sourceMetadata: metadataFor(sourceType),
      location,
      submittedAtMs,
      receivedAtMs,
      claims,
      narrative: `A separate observation adds: ${renderNarrative(sourceType, location.description, claims, original.report.urgency, key)}`,
    });
    return Object.freeze({
      report,
      evaluation: Object.freeze({
        ...evaluationFor(report, incident, original.evaluation.groundTruthLocation, offset, quality, ["DUPLICATE", "ADDITIONAL_DELAY"], [], [], [], receivedAtMs - original.report.receivedAtMs, false),
        duplicateFamilyId: familyId,
        duplicateOfReportId: original.report.id,
      }),
    });
  }
}

export function finalizeEvaluation(evaluation: PrivateReportEvaluation, incident: IncidentSnapshot): PrivateReportEvaluation {
  const isStale =
    incident.lastUpdatedAtMs > evaluation.observedIncidentState.lastUpdatedAtMs &&
    incident.lastUpdatedAtMs > evaluation.observedAtMs;
  return freezeEvaluation({
    ...evaluation,
    isStale,
    deliveryIncidentState: Object.freeze({ status: incident.status, severity: incident.severity, lastUpdatedAtMs: incident.lastUpdatedAtMs }),
  });
}

function evaluationFor(report: EmergencyReport, incident: IncidentSnapshot, truthLocation: FictionalReportLocation, offset: { x: number; y: number }, quality: PrivateSourceQuality, transformations: readonly InformationTransformation[], omitted: readonly string[], unknown: readonly string[], lowConfidence: readonly string[], additionalDelayMs: number, staleCandidate: boolean, contradictionOf?: string): PrivateReportEvaluation {
  return freezeEvaluation({
    reportId: report.id,
    internalIncidentId: report.internalIncidentId,
    ...(contradictionOf === undefined ? {} : { contradictionOfReportId: contradictionOf }),
    transformations: Object.freeze([...transformations]),
    omittedDetailCodes: Object.freeze([...omitted]),
    explicitUnknownDetailCodes: Object.freeze([...unknown]),
    lowConfidenceClaimCodes: Object.freeze([...lowConfidence]),
    groundTruthLocation: truthLocation,
    appliedLocationOffset: Object.freeze({ ...offset }),
    additionalDelayMs,
    staleCandidate,
    isStale: false,
    truthfulness: "OBSERVATION_AT_TIME",
    observedAtMs: report.observedAtMs,
    observedIncidentState: Object.freeze({ status: incident.status, severity: incident.severity, lastUpdatedAtMs: incident.lastUpdatedAtMs }),
    sourceQuality: quality,
  });
}

function withFamily(plan: GeneratedReportPlan, familyId: string | undefined): GeneratedReportPlan {
  if (familyId === undefined) return plan;
  return Object.freeze({ report: plan.report, evaluation: freezeEvaluation({ ...plan.evaluation, duplicateFamilyId: familyId }) });
}

function freezeEvaluation(value: PrivateReportEvaluation): PrivateReportEvaluation {
  return Object.freeze({ ...value, transformations: Object.freeze([...value.transformations]), omittedDetailCodes: Object.freeze([...value.omittedDetailCodes]), explicitUnknownDetailCodes: Object.freeze([...value.explicitUnknownDetailCodes]), lowConfidenceClaimCodes: Object.freeze([...value.lowConfidenceClaimCodes]), groundTruthLocation: Object.freeze({ ...value.groundTruthLocation }), appliedLocationOffset: Object.freeze({ ...value.appliedLocationOffset }), observedIncidentState: Object.freeze({ ...value.observedIncidentState }), ...(value.deliveryIncidentState === undefined ? {} : { deliveryIncidentState: Object.freeze({ ...value.deliveryIncidentState }) }), sourceQuality: Object.freeze({ ...value.sourceQuality }) });
}

function applies(config: ValidatedNoiseConfig, kind: NoiseKind, multiplier: number, stream: RandomStream): boolean {
  const override = config.probabilityOverrides[kind];
  if (override !== undefined) return override;
  const probabilityValue = config[`${kind}Probability` as keyof ValidatedNoiseConfig];
  const base = typeof probabilityValue === "number" ? probabilityValue : 0;
  return stream.nextFloat() < Math.min(1, base * multiplier);
}

function isEffectivelyZero(config: ValidatedNoiseConfig): boolean {
  return (
    config.duplicateProbability === 0 &&
    config.contradictionProbability === 0 &&
    config.missingDetailProbability === 0 &&
    config.delayProbability === 0 &&
    config.staleProbability === 0 &&
    config.locationErrorProbability === 0 &&
    !Object.values(config.probabilityOverrides).includes(true)
  );
}

function effectiveQuality(source: ReportSourceType, config: ValidatedNoiseConfig): PrivateSourceQuality {
  const base = SOURCE_PROFILES[source];
  const adjustment = config.sourceQualityAdjustments[source];
  if (adjustment === undefined) return base;
  return Object.freeze({ profile: source, reliabilityScore: base.reliabilityScore, contradictionMultiplier: base.contradictionMultiplier * adjustment.contradictionMultiplier, missingDetailMultiplier: base.missingDetailMultiplier * adjustment.missingDetailMultiplier, delayMultiplier: base.delayMultiplier * adjustment.delayMultiplier, staleMultiplier: base.staleMultiplier * adjustment.staleMultiplier, locationErrorMultiplier: base.locationErrorMultiplier * adjustment.locationErrorMultiplier, confidenceAdjustment: base.confidenceAdjustment + adjustment.confidenceAdjustment });
}

function profile(profileName: ReportSourceType, reliabilityScore: number, contradictionMultiplier: number, missingDetailMultiplier: number, delayMultiplier: number, staleMultiplier: number, locationErrorMultiplier: number, confidenceAdjustment: number): PrivateSourceQuality {
  return Object.freeze({ profile: profileName, reliabilityScore, contradictionMultiplier, missingDetailMultiplier, delayMultiplier, staleMultiplier, locationErrorMultiplier, confidenceAdjustment });
}

function validateAdjustment(value: SourceQualityAdjustment, source: string): Required<SourceQualityAdjustment> {
  const multiplier = (input: number | undefined, label: string): number => {
    const result = input ?? 1;
    if (!Number.isFinite(result) || result < 0 || result > 4) throw new SimulationConfigError(`${source}.${label} must be between 0 and 4.`);
    return result;
  };
  const confidence = value.confidenceAdjustment ?? 0;
  if (!Number.isFinite(confidence) || confidence < -1 || confidence > 1) throw new SimulationConfigError(`${source}.confidenceAdjustment must be between -1 and 1.`);
  return Object.freeze({ contradictionMultiplier: multiplier(value.contradictionMultiplier, "contradictionMultiplier"), missingDetailMultiplier: multiplier(value.missingDetailMultiplier, "missingDetailMultiplier"), delayMultiplier: multiplier(value.delayMultiplier, "delayMultiplier"), staleMultiplier: multiplier(value.staleMultiplier, "staleMultiplier"), locationErrorMultiplier: multiplier(value.locationErrorMultiplier, "locationErrorMultiplier"), confidenceAdjustment: confidence });
}

function probability(value: number | undefined, fallback: number, label: string): number {
  const result = value ?? fallback;
  if (!Number.isFinite(result) || result < 0 || result > 1) throw new SimulationConfigError(`${label} must be a finite probability from 0 to 1.`);
  return result;
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new SimulationConfigError(`${label} must be an integer from ${minimum} to ${maximum}.`);
  return result;
}

function confidenceFor(adjustment: number): "LOW" | "MEDIUM" | "HIGH" {
  if (adjustment >= 0.15) return "HIGH";
  if (adjustment <= -0.1) return "LOW";
  return "MEDIUM";
}

function boundedOffset(stream: RandomStream, maximum: number): { x: number; y: number } {
  if (maximum === 0) return { x: 0, y: 0 };
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const x = stream.nextInt(-maximum, maximum + 1);
    const y = stream.nextInt(-maximum, maximum + 1);
    if ((x !== 0 || y !== 0) && x * x + y * y <= maximum * maximum) return { x, y };
  }
  return { x: maximum, y: 0 };
}

function noisyLocation(location: FictionalReportLocation, offset: { x: number; y: number }): FictionalReportLocation {
  return Object.freeze({ ...location, x: location.x + offset.x, y: location.y + offset.y, description: `the approximate area near ${location.primaryReference} in ${location.district}`, precision: "APPROXIMATE" });
}

function renderNarrative(source: ReportSourceType, location: string, claims: readonly ObservableClaim[], urgency: EmergencyReport["urgency"], key: string): string {
  const stream = new SeededRng(key).stream("noisy-narrative");
  const openings: Record<ReportSourceType, readonly string[]> = {
    CIVILIAN_CALLER: ["A caller reports", "A civilian observer says"], EMERGENCY_RESPONDER: ["A responder update notes", "Field personnel report"], AUTOMATED_SENSOR: ["A simulated sensor indicates", "An automated monitor flags"], EMERGENCY_HOTLINE: ["A hotline operator relays", "A hotline report states"], COMMUNITY_ORGANIZATION: ["A fictional community group reports", "A community support team notes"], FIELD_OBSERVER: ["A field observer reports", "An on-site observation notes"],
  };
  const opening = openings[source][stream.nextInt(0, openings[source].length)] ?? openings[source][0];
  const statements = claims.map((claim) => claim.statement);
  const body = statements
    .map((statement) => `${statement.charAt(0).toUpperCase()}${statement.slice(1)}.`)
    .join(" ");
  const urgencyText = urgency === "CRITICAL" ? " Immediate assistance is requested." : urgency === "HIGH" ? " Prompt review is requested." : "";
  return `${opening} ${body} The reported location is ${location}.${urgencyText}`.replace(/\s+/g, " ").trim();
}

function metadataFor(source: ReportSourceType): PublicSourceMetadata {
  switch (source) {
    case "CIVILIAN_CALLER": return Object.freeze({ channel: "VOICE" });
    case "EMERGENCY_RESPONDER": return Object.freeze({ channel: "RADIO", organizationLabel: "Fictional Response Service" });
    case "AUTOMATED_SENSOR": return Object.freeze({ channel: "SENSOR_NETWORK", sensorKind: "simulated condition monitor" });
    case "EMERGENCY_HOTLINE": return Object.freeze({ channel: "HOTLINE" });
    case "COMMUNITY_ORGANIZATION": return Object.freeze({ channel: "COMMUNITY_NETWORK", organizationLabel: "Fictional Community Support Network" });
    case "FIELD_OBSERVER": return Object.freeze({ channel: "FIELD_NOTE" });
  }
}
