import { SeededRng, type RandomStream } from "../core/random.js";
import { SimulationConfigError, SimulationEventError } from "../simulation/errors.js";
import {
  createFictionalLocation,
  validateFictionalGeography,
} from "./geography.js";
import {
  REPORT_CATEGORIES,
  REPORT_SOURCE_TYPES,
  freezeEmergencyReport,
  type EmergencyReport,
  type ObservableClaim,
  type ObservableUrgency,
  type PublicSourceMetadata,
  type ReportCategory,
  type ReportGenerationConfig,
  type ReportSourceType,
} from "./types.js";

export const MAX_REPORTS_PER_GENERATION = 10_000;
export const MAX_NORMAL_REPORT_DELAY_MS = 180_000;

interface ValidatedReportGenerationConfig {
  readonly reportCount: number;
  readonly startTimeMs: number;
  readonly frequencyMs: number;
  readonly categories?: readonly ReportCategory[];
  readonly sourceWeights: Readonly<Record<ReportSourceType, number>>;
  readonly geography?: ReportGenerationConfig["geography"];
}

export interface ReportableIncident {
  readonly id: string;
  readonly incidentType: string;
}

const DEFAULT_SOURCE_WEIGHTS: Readonly<Record<ReportSourceType, number>> = {
  CIVILIAN_CALLER: 35,
  EMERGENCY_RESPONDER: 20,
  AUTOMATED_SENSOR: 10,
  EMERGENCY_HOTLINE: 15,
  COMMUNITY_ORGANIZATION: 10,
  FIELD_OBSERVER: 10,
};

const CATEGORY_CONTENT: Readonly<
  Record<ReportCategory, { code: string; observations: readonly string[]; followUps: readonly string[] }>
> = {
  FLOODED_STRUCTURE: {
    code: "water_inside_structure",
    observations: ["water is entering the lower level of a structure", "standing water is visible inside a building"],
    followUps: ["occupants are moving to higher floors", "evacuation assistance has been requested"],
  },
  STRANDED_VEHICLE: {
    code: "vehicle_stranded",
    observations: ["a vehicle is stopped in rising water", "a vehicle cannot move from the access road"],
    followUps: ["occupants appear to remain inside", "safe access around the vehicle is limited"],
  },
  WATER_RESCUE: {
    code: "water_rescue_needed",
    observations: ["people are awaiting assistance near moving water", "a water rescue may be needed"],
    followUps: ["responders need a safe approach route", "flotation equipment has been requested"],
  },
  EVACUATION_REQUEST: {
    code: "evacuation_requested",
    observations: ["people are requesting help to leave the area", "an evacuation request has been made"],
    followUps: ["some occupants may need mobility assistance", "a safe pickup point is still needed"],
  },
  MEDICAL_ASSISTANCE: {
    code: "medical_assistance_requested",
    observations: ["medical assistance has been requested", "an injured person needs assessment"],
    followUps: ["access for a medical team appears possible", "the caller is waiting for responder instructions"],
  },
  STRUCTURE_FIRE: {
    code: "smoke_or_fire_visible",
    observations: ["smoke is visible from a structure", "fire conditions are visible inside a building"],
    followUps: ["the extent of the fire is not yet clear", "people nearby are moving away from the structure"],
  },
  BUILDING_COLLAPSE: {
    code: "structural_collapse_visible",
    observations: ["part of a building appears to have collapsed", "visible structural damage has blocked an entrance"],
    followUps: ["the interior cannot be seen safely", "a structural assessment has been requested"],
  },
  ROAD_OBSTRUCTION: {
    code: "road_obstructed",
    observations: ["debris is blocking the roadway", "the travel lane is not passable"],
    followUps: ["vehicles are turning back from the obstruction", "an alternate route is needed"],
  },
  ELECTRICAL_HAZARD: {
    code: "electrical_hazard_visible",
    observations: ["damaged electrical equipment is visible", "wires appear to be down near the route"],
    followUps: ["the immediate area is being avoided", "utility assistance has been requested"],
  },
  COMMUNICATION_OUTAGE: {
    code: "communications_unavailable",
    observations: ["local communication service is unavailable", "radio and phone contact is intermittent"],
    followUps: ["field updates are being relayed manually", "a temporary communication point is needed"],
  },
  POWER_OUTAGE: {
    code: "power_unavailable",
    observations: ["multiple buildings have no visible power", "lighting and electrical service are unavailable"],
    followUps: ["backup lighting is limited", "the outage area is still being checked"],
  },
  SHELTER_SHORTAGE: {
    code: "shelter_capacity_limited",
    observations: ["available shelter space is nearly full", "additional indoor shelter space is needed"],
    followUps: ["arriving residents are waiting for placement", "an overflow location has been requested"],
  },
  SUPPLY_REQUEST: {
    code: "supplies_requested",
    observations: ["essential supplies are running low", "a delivery of basic supplies has been requested"],
    followUps: ["the receiving point remains accessible", "water and basic care items are the stated need"],
  },
  INFRASTRUCTURE_FAILURE: {
    code: "infrastructure_not_operating",
    observations: ["a public facility is not operating", "visible infrastructure damage is affecting access"],
    followUps: ["a technical inspection has been requested", "the affected service remains unavailable"],
  },
  WELFARE_CHECK: {
    code: "welfare_check_requested",
    observations: ["a welfare check has been requested", "community members have not confirmed an occupant's status"],
    followUps: ["no verified medical condition has been reported", "a field check is being requested"],
  },
  HAZARDOUS_CONDITIONS: {
    code: "hazardous_conditions_visible",
    observations: ["unsafe conditions are visible around the site", "access conditions appear hazardous"],
    followUps: ["people are being advised to keep clear", "a closer assessment has not yet been made"],
  },
};

const OPENINGS: Readonly<Record<ReportSourceType, readonly string[]>> = {
  CIVILIAN_CALLER: ["A caller reports", "A nearby resident reports", "A civilian observer says"],
  EMERGENCY_RESPONDER: ["A response crew reports", "A responder update notes", "Field personnel report"],
  AUTOMATED_SENSOR: ["A simulated sensor indicates", "An automated monitor flags", "The local sensor network records"],
  EMERGENCY_HOTLINE: ["The emergency hotline received a report", "A hotline operator relays", "A hotline report states"],
  COMMUNITY_ORGANIZATION: ["A fictional community group reports", "A community support team notes", "A neighborhood aid post reports"],
  FIELD_OBSERVER: ["A field observer reports", "An on-site observation notes", "A field update indicates"],
};

const STAGES = ["NEWLY_OBSERVED", "ONGOING", "IMPROVING"] as const;
const URGENCIES = ["LOW", "MODERATE", "HIGH", "CRITICAL"] as const;

export class ReportGenerator {
  readonly #identityMaterial: string;
  readonly #runId: string;
  readonly #rng: SeededRng;
  #sequence = 0;

  public constructor(identityMaterial: string, runId: string) {
    this.#identityMaterial = identityMaterial;
    this.#runId = runId;
    this.#rng = new SeededRng(`${identityMaterial}\u0000reports`);
  }

  public generate(
    incidents: readonly ReportableIncident[],
    config: ReportGenerationConfig,
    currentTimeMs: number,
    maximumTimeMs: number,
  ): readonly EmergencyReport[] {
    const validated = validateGenerationConfig(config, currentTimeMs, maximumTimeMs);
    if (incidents.length === 0) {
      throw new SimulationEventError("Reports require at least one existing incident.");
    }

    const geography = validateFictionalGeography(validated.geography);
    const reports: EmergencyReport[] = [];

    for (let offset = 0; offset < validated.reportCount; offset += 1) {
      const incident = incidents[offset % incidents.length];
      if (incident === undefined) {
        throw new SimulationEventError("Unable to select an incident for report generation.");
      }
      const sequence = this.#sequence;
      const reportKey = `report:${sequence}`;
      const timing = this.#rng.stream(`${reportKey}:timing`);
      const source = chooseSource(validated.sourceWeights, this.#rng.stream(`${reportKey}:source`));
      const category = chooseCategory(
        incident.incidentType,
        validated.categories,
        offset,
      );
      const language = this.#rng.stream(`${reportKey}:language`);
      const observedAtMs = validated.startTimeMs + offset * validated.frequencyMs;
      const submittedAtMs = observedAtMs + timing.nextInt(5_000, 120_001);
      const receivedAtMs = submittedAtMs + timing.nextInt(1_000, 60_001);
      const location = createFictionalLocation(
        this.#identityMaterial,
        incident.id,
        reportKey,
        geography,
      );
      const stage = STAGES[language.nextInt(0, STAGES.length)] ?? STAGES[0];
      const urgency = URGENCIES[language.nextInt(0, URGENCIES.length)] ?? URGENCIES[0];
      const content = CATEGORY_CONTENT[category];
      const primaryStatement = pick(content.observations, language);
      const followUpStatement = pick(content.followUps, language);
      const claimList: ObservableClaim[] = [
        Object.freeze({
          code: content.code,
          statement: primaryStatement,
          stage,
          assistanceRequested: /requested|needed|assistance/i.test(primaryStatement),
          value: content.code,
          confidence: "HIGH",
          detailStatus: "OBSERVED",
        }),
      ];
      if (language.nextFloat() < 0.75) {
        claimList.push(
          Object.freeze({
            code: `${content.code}_context`,
            statement: followUpStatement,
            stage,
            assistanceRequested: /requested|needed|assistance/i.test(followUpStatement),
            value: "CONTEXT",
            confidence: "HIGH",
            detailStatus: "OBSERVED",
          }),
        );
      }
      const claims: readonly ObservableClaim[] = Object.freeze(claimList);
      const narrative = createNarrative(source, location.description, claims, urgency, language);
      const reportId = this.#createReportId(sequence);
      const metadata = sourceMetadata(source);

      reports.push(
        freezeEmergencyReport({
          id: reportId,
          runId: this.#runId,
          internalIncidentId: incident.id,
          category,
          sourceType: source,
          location,
          observedAtMs,
          submittedAtMs,
          receivedAtMs,
          narrative,
          claims,
          status: "RECEIVED",
          urgency,
          sourceMetadata: metadata,
        }),
      );
      this.#sequence += 1;
    }

    return Object.freeze(reports);
  }

  #createReportId(sequence: number): string {
    const randomPart = this.#rng
      .stream(`report:${sequence}:identifier`)
      .nextUint32()
      .toString(36)
      .padStart(7, "0");
    return `rpt_${this.#runId.slice(4)}_${sequence.toString(36).padStart(7, "0")}_${randomPart}`;
  }
}

function validateGenerationConfig(
  config: ReportGenerationConfig,
  currentTimeMs: number,
  maximumTimeMs: number,
): ValidatedReportGenerationConfig {
  if (typeof config !== "object" || config === null) {
    throw new SimulationConfigError("Report generation configuration must be an object.");
  }
  if (
    !Number.isSafeInteger(config.reportCount) ||
    config.reportCount < 1 ||
    config.reportCount > MAX_REPORTS_PER_GENERATION
  ) {
    throw new SimulationConfigError(
      `reportCount must be an integer from 1 to ${MAX_REPORTS_PER_GENERATION}.`,
    );
  }
  const startTimeMs = config.startTimeMs ?? currentTimeMs;
  const frequencyMs = config.frequencyMs ?? 1_000;
  if (!Number.isSafeInteger(startTimeMs) || startTimeMs < currentTimeMs) {
    throw new SimulationConfigError("startTimeMs must be a safe timestamp at or after current time.");
  }
  if (!Number.isSafeInteger(frequencyMs) || frequencyMs < 0) {
    throw new SimulationConfigError("frequencyMs must be a non-negative safe integer.");
  }
  const lastObservedAtMs = startTimeMs + (config.reportCount - 1) * frequencyMs;
  if (
    !Number.isSafeInteger(lastObservedAtMs) ||
    lastObservedAtMs + MAX_NORMAL_REPORT_DELAY_MS > maximumTimeMs
  ) {
    throw new SimulationConfigError(
      "Report schedule and normal delivery delay exceed maximum simulation duration.",
    );
  }

  const categories = config.categories;
  if (categories !== undefined) {
    if (!Array.isArray(categories) || categories.length === 0) {
      throw new SimulationConfigError("categories must be a non-empty array when provided.");
    }
    for (const category of categories) {
      if (!REPORT_CATEGORIES.includes(category)) {
        throw new SimulationConfigError(`Unsupported report category: ${String(category)}.`);
      }
    }
  }

  const sourceWeights = validateSourceWeights(config.sourceWeights);
  return {
    reportCount: config.reportCount,
    startTimeMs,
    frequencyMs,
    ...(categories === undefined ? {} : { categories: Object.freeze([...categories]) }),
    sourceWeights,
    ...(config.geography === undefined ? {} : { geography: config.geography }),
  };
}

function validateSourceWeights(
  input: Partial<Record<ReportSourceType, number>> | undefined,
): Readonly<Record<ReportSourceType, number>> {
  const weights = { ...DEFAULT_SOURCE_WEIGHTS, ...(input ?? {}) };
  let total = 0;
  for (const source of REPORT_SOURCE_TYPES) {
    const weight = weights[source];
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0) {
      throw new SimulationConfigError(`Source weight for ${source} must be non-negative.`);
    }
    total += weight;
  }
  if (total <= 0) {
    throw new SimulationConfigError("At least one source weight must be greater than zero.");
  }
  return Object.freeze(weights);
}

function chooseSource(
  weights: Readonly<Record<ReportSourceType, number>>,
  stream: RandomStream,
): ReportSourceType {
  const total = REPORT_SOURCE_TYPES.reduce((sum, source) => sum + weights[source], 0);
  let selection = stream.nextFloat() * total;
  for (const source of REPORT_SOURCE_TYPES) {
    selection -= weights[source];
    if (selection < 0) {
      return source;
    }
  }
  return REPORT_SOURCE_TYPES[REPORT_SOURCE_TYPES.length - 1] ?? "FIELD_OBSERVER";
}

function chooseCategory(
  incidentType: string,
  configured: readonly ReportCategory[] | undefined,
  offset: number,
): ReportCategory {
  if (configured !== undefined) {
    return configured[offset % configured.length] ?? configured[0] ?? "HAZARDOUS_CONDITIONS";
  }
  const normalized = incidentType.toUpperCase();
  const direct = REPORT_CATEGORIES.find((category) => normalized.includes(category));
  if (direct !== undefined) {
    return direct;
  }
  if (normalized.includes("FIRE")) return "STRUCTURE_FIRE";
  if (normalized.includes("FLOOD") || normalized.includes("WATER")) return "FLOODED_STRUCTURE";
  if (normalized.includes("COLLAPSE")) return "BUILDING_COLLAPSE";
  if (normalized.includes("POWER")) return "POWER_OUTAGE";
  if (normalized.includes("ROAD")) return "ROAD_OBSTRUCTION";
  return "HAZARDOUS_CONDITIONS";
}

function createNarrative(
  source: ReportSourceType,
  locationDescription: string,
  claims: readonly ObservableClaim[],
  urgency: ObservableUrgency,
  stream: RandomStream,
): string {
  const opening = pick(OPENINGS[source], stream);
  const primary = claims[0]?.statement ?? "an observable emergency condition is present";
  const followUp = claims[1]?.statement;
  const stage = claims[0]?.stage ?? "ONGOING";
  const stagePhrases = {
    NEWLY_OBSERVED: "The condition was newly observed.",
    ONGOING: "The condition remains observable.",
    IMPROVING: "The observer notes signs of improvement.",
  } as const;
  const urgencyPhrases: Readonly<Record<ObservableUrgency, readonly string[]>> = {
    LOW: ["The situation is being monitored.", "No immediate escalation is described."],
    MODERATE: ["A timely field check is requested.", "Assistance is requested when available."],
    HIGH: ["Prompt assistance is requested.", "The observer considers the need urgent."],
    CRITICAL: ["Immediate assistance is requested.", "The observer describes an urgent threat."],
  };
  const structures =
    followUp === undefined
      ? [
          `${opening} ${primary} at ${locationDescription}.`,
          `${opening} that ${primary}. The location is ${locationDescription}.`,
        ]
      : [
          `${opening} ${primary} at ${locationDescription}. ${capitalize(followUp)}.`,
          `${opening} that ${primary}. The location is ${locationDescription}. ${capitalize(followUp)}.`,
          `${opening} ${primary} near ${locationDescription}; ${followUp}.`,
        ];
  return `${pick(structures, stream)} ${stagePhrases[stage]} ${pick(urgencyPhrases[urgency], stream)}`;
}

function sourceMetadata(source: ReportSourceType): PublicSourceMetadata {
  switch (source) {
    case "CIVILIAN_CALLER":
      return Object.freeze({ channel: "VOICE" });
    case "EMERGENCY_RESPONDER":
      return Object.freeze({ channel: "RADIO", organizationLabel: "Fictional Response Service" });
    case "AUTOMATED_SENSOR":
      return Object.freeze({ channel: "SENSOR_NETWORK", sensorKind: "simulated condition monitor" });
    case "EMERGENCY_HOTLINE":
      return Object.freeze({ channel: "HOTLINE" });
    case "COMMUNITY_ORGANIZATION":
      return Object.freeze({
        channel: "COMMUNITY_NETWORK",
        organizationLabel: "Fictional Community Support Network",
      });
    case "FIELD_OBSERVER":
      return Object.freeze({ channel: "FIELD_NOTE" });
  }
}

function pick<T>(values: readonly T[], stream: RandomStream): T {
  const value = values[stream.nextInt(0, values.length)];
  if (value === undefined) {
    throw new SimulationEventError("Unable to choose deterministic report content.");
  }
  return value;
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

