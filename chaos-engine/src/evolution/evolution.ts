import { SeededRng } from "../core/random.js";
import { SimulationConfigError } from "../simulation/errors.js";
import type { InformationNoiseConfig } from "../reporting/noise.js";
import type { ReportCategory } from "../reporting/types.js";

export type DisasterType = "FLOOD" | "SEVERE_STORM" | "EARTHQUAKE_AFTERMATH" | "URBAN_FIRE";
export type InfrastructureType = "ROAD" | "ELECTRICAL_SUBSTATION" | "COMMUNICATION_TOWER" | "SHELTER" | "CRITICAL_BUILDING";
export type InfrastructureStatus = "OPERATIONAL" | "DEGRADED" | "OFFLINE" | "RECOVERING";

export interface EnvironmentState {
  readonly rainfall: number;
  readonly floodwater: number;
  readonly wind: number;
  readonly fire: number;
  readonly structuralDamage: number;
  readonly roadAccessibility: number;
  readonly electricalAvailability: number;
  readonly communicationAvailability: number;
  readonly shelterOccupancy: number;
}

export interface InfrastructureEntity {
  readonly id: string;
  readonly type: InfrastructureType;
  readonly status: InfrastructureStatus;
  readonly condition: number;
  readonly capacity: number;
  readonly location: Readonly<{ x: number; y: number; fictional: true }>;
  readonly history: readonly InfrastructureHistoryEntry[];
}

export interface InfrastructureHistoryEntry {
  readonly eventId: string;
  readonly atMs: number;
  readonly status: InfrastructureStatus;
  readonly condition: number;
  readonly ruleId: string;
}

export interface CascadeApplication {
  readonly ruleId: string;
  readonly eventId: string;
  readonly causeEventId?: string;
  readonly atMs: number;
  readonly depth: number;
  readonly affectedIds: readonly string[];
}

export interface EvolutionConfig {
  readonly incidentId: string;
  readonly disasterType: DisasterType;
  readonly stepCount: number;
  readonly stepIntervalMs: number;
  readonly initialEnvironment?: Partial<EnvironmentState>;
  readonly maximumCascadeDepth?: number;
  readonly maximumSecondaryEvents?: number;
  readonly perRuleActivationLimit?: number;
  readonly ruleCooldownSteps?: number;
  readonly observationProbability?: number;
  readonly reportNoise?: InformationNoiseConfig;
}

export type IncidentEvolutionAction = "ACTIVATE" | "ESCALATE" | "IMPROVE" | "STABILIZE" | "RESOLVE";

export interface EvolutionMutation {
  readonly scheduledAtMs: number;
  readonly disasterType: DisasterType;
  readonly environment: EnvironmentState;
  readonly ruleIds: readonly string[];
  readonly infrastructureChanges: readonly Readonly<{
    infrastructureId: string;
    status: InfrastructureStatus;
    condition: number;
    ruleId: string;
  }>[];
  readonly incidentAction?: IncidentEvolutionAction;
  readonly severityAmount?: number;
  readonly secondaryIncidentType?: string;
  readonly observationCategory?: ReportCategory;
  readonly reportNoise?: InformationNoiseConfig;
  readonly cascadeDepth: number;
}

export interface EvolutionPlan {
  readonly incidentId: string;
  readonly mutations: readonly EvolutionMutation[];
  readonly maximumSecondaryEvents: number;
}

export const CASCADE_RULE_IDS = [
  "HEAVY_RAIN_INCREASES_FLOODWATER",
  "FLOODWATER_CLOSES_ROAD",
  "FLOODWATER_FAILS_SUBSTATION",
  "POWER_LOSS_DEGRADES_COMMUNICATIONS",
  "COMMUNICATION_FAILURE_DELAYS_REPORTS",
  "FIRE_DAMAGES_NEARBY_STRUCTURE",
  "STRUCTURAL_DAMAGE_CREATES_COLLAPSE_HAZARD",
  "STORM_WIND_DAMAGES_POWER_LINES",
  "SHELTER_OVERCROWDING_REQUESTS_SUPPLIES",
  "PROLONGED_HAZARD_ESCALATES_INCIDENT",
  "IMPROVING_CONDITIONS_RECOVER_INFRASTRUCTURE",
] as const;

export function createInitialInfrastructure(runId: string): readonly InfrastructureEntity[] {
  const types: readonly InfrastructureType[] = ["ROAD", "ELECTRICAL_SUBSTATION", "COMMUNICATION_TOWER", "SHELTER", "CRITICAL_BUILDING"];
  return Object.freeze(types.map((type, index) => Object.freeze({
    id: `infra_${runId.slice(4)}_${type.toLowerCase()}_${index}`,
    type,
    status: "OPERATIONAL" as const,
    condition: 1,
    capacity: type === "SHELTER" ? 100 : 1,
    location: Object.freeze({ x: 10_000 + index * 200, y: 10_000 + index * 150, fictional: true as const }),
    history: Object.freeze([]),
  })));
}

export function planEvolution(config: EvolutionConfig, seed: string, startTimeMs: number): EvolutionPlan {
  validateEvolutionConfig(config);
  const rng = new SeededRng(`${seed}\u0000evolution\u0000${config.incidentId}\u0000${config.disasterType}`);
  const depthLimit = config.maximumCascadeDepth ?? 8;
  const perRuleLimit = config.perRuleActivationLimit ?? 20;
  const ruleCounts = new Map<string, number>();
  const lastRuleStep = new Map<string, number>();
  let env = initialEnvironment(config.disasterType, config.initialEnvironment);
  const mutations: EvolutionMutation[] = [];
  let secondaryCount = 0;

  for (let step = 0; step < config.stepCount; step += 1) {
    const stream = rng.stream(`step:${step}`);
    const rules: string[] = [];
    const changes: EvolutionMutation["infrastructureChanges"][number][] = [];
    const depth = Math.min(step + 1, depthLimit);
    const addRule = (ruleId: string): boolean => {
      const count = ruleCounts.get(ruleId) ?? 0;
      const lastStep = lastRuleStep.get(ruleId);
      if (
        count >= perRuleLimit ||
        step + 1 > depthLimit ||
        (lastStep !== undefined && step - lastStep <= (config.ruleCooldownSteps ?? 0))
      ) return false;
      ruleCounts.set(ruleId, count + 1);
      lastRuleStep.set(ruleId, step);
      rules.push(ruleId);
      return true;
    };

    if (config.disasterType === "FLOOD") {
      const rising = step < config.stepCount / 2;
      const rain = clamp(env.rainfall + (rising ? 0.12 : -0.3) + stream.nextFloat() * 0.04);
      let water = env.floodwater;
      if (rising && rain > 0.55 && addRule("HEAVY_RAIN_INCREASES_FLOODWATER")) water = clamp(water + rain * 0.16);
      else water = clamp(water - 0.22);
      env = freezeEnv({ ...env, rainfall: rain, floodwater: water, roadAccessibility: clamp(1 - water), electricalAvailability: water > 0.72 ? 0 : env.electricalAvailability });
      if (water > 0.5 && addRule("FLOODWATER_CLOSES_ROAD")) changes.push(change("ROAD", "OFFLINE", 0.2, "FLOODWATER_CLOSES_ROAD"));
      if (water > 0.72 && addRule("FLOODWATER_FAILS_SUBSTATION")) changes.push(change("ELECTRICAL_SUBSTATION", "OFFLINE", 0.15, "FLOODWATER_FAILS_SUBSTATION"));
      if (!rising && water < 0.4 && addRule("IMPROVING_CONDITIONS_RECOVER_INFRASTRUCTURE")) {
        changes.push(change("ROAD", "RECOVERING", 0.65, "IMPROVING_CONDITIONS_RECOVER_INFRASTRUCTURE"));
        changes.push(change("ELECTRICAL_SUBSTATION", "RECOVERING", 0.6, "IMPROVING_CONDITIONS_RECOVER_INFRASTRUCTURE"));
      }
    } else if (config.disasterType === "SEVERE_STORM") {
      const wind = clamp(env.wind + (step < config.stepCount / 2 ? 0.16 : -0.2));
      const rain = clamp(env.rainfall + (step < config.stepCount / 2 ? 0.1 : -0.15));
      env = freezeEnv({ ...env, wind, rainfall: rain, electricalAvailability: wind > 0.7 ? 0.2 : clamp(env.electricalAvailability + 0.15) });
      if (wind > 0.7 && addRule("STORM_WIND_DAMAGES_POWER_LINES")) changes.push(change("ELECTRICAL_SUBSTATION", "DEGRADED", 0.35, "STORM_WIND_DAMAGES_POWER_LINES"));
    } else if (config.disasterType === "URBAN_FIRE") {
      const fire = clamp(env.fire + (step < config.stepCount / 2 ? 0.18 + env.wind * 0.04 : -0.22));
      const damage = clamp(env.structuralDamage + fire * 0.12);
      env = freezeEnv({ ...env, fire, structuralDamage: damage });
      if (fire > 0.55 && addRule("FIRE_DAMAGES_NEARBY_STRUCTURE")) changes.push(change("CRITICAL_BUILDING", "DEGRADED", clamp(1 - damage), "FIRE_DAMAGES_NEARBY_STRUCTURE"));
    } else {
      const damage = clamp(env.structuralDamage + (step === 0 ? 0.35 : 0.08));
      env = freezeEnv({ ...env, structuralDamage: damage, roadAccessibility: clamp(1 - damage * 0.6) });
    }

    if (env.electricalAvailability < 0.4 && addRule("POWER_LOSS_DEGRADES_COMMUNICATIONS")) {
      env = freezeEnv({ ...env, communicationAvailability: 0.25 });
      changes.push(change("COMMUNICATION_TOWER", "DEGRADED", 0.4, "POWER_LOSS_DEGRADES_COMMUNICATIONS"));
    }
    if (env.communicationAvailability < 0.4) addRule("COMMUNICATION_FAILURE_DELAYS_REPORTS");
    if (env.shelterOccupancy > 0.9) addRule("SHELTER_OVERCROWDING_REQUESTS_SUPPLIES");
    if ((env.structuralDamage > 0.55 || (config.disasterType === "EARTHQUAKE_AFTERMATH" && step > 0)) && secondaryCount < (config.maximumSecondaryEvents ?? 4) && addRule("STRUCTURAL_DAMAGE_CREATES_COLLAPSE_HAZARD")) secondaryCount += 1;
    const hazardous = Math.max(env.floodwater, env.fire, env.wind, env.structuralDamage);
    if (hazardous > 0.65) addRule("PROLONGED_HAZARD_ESCALATES_INCIDENT");

    const improving = step >= Math.ceil(config.stepCount / 2) && hazardous < 0.65;
    const action: IncidentEvolutionAction = step === 0 ? "ACTIVATE" : hazardous > 0.65 ? "ESCALATE" : improving ? (step === config.stepCount - 1 ? "STABILIZE" : "IMPROVE") : "IMPROVE";
    const category: ReportCategory = changes.some((item) => item.infrastructureId === "ROAD") ? "ROAD_OBSTRUCTION" : changes.some((item) => item.infrastructureId === "COMMUNICATION_TOWER") ? "COMMUNICATION_OUTAGE" : config.disasterType === "FLOOD" ? "FLOODED_STRUCTURE" : config.disasterType === "URBAN_FIRE" ? "STRUCTURE_FIRE" : "INFRASTRUCTURE_FAILURE";
    mutations.push(Object.freeze({
      disasterType: config.disasterType,
      environment: env,
      ruleIds: Object.freeze(rules),
      infrastructureChanges: Object.freeze(changes),
      incidentAction: action,
      severityAmount: 1,
      ...(rules.includes("STRUCTURAL_DAMAGE_CREATES_COLLAPSE_HAZARD") ? { secondaryIncidentType: "BUILDING_COLLAPSE" } : {}),
      ...(stream.nextFloat() < (config.observationProbability ?? 0.65) ? { observationCategory: category, reportNoise: config.reportNoise } : {}),
      cascadeDepth: depth,
      scheduledAtMs: startTimeMs + (step + 1) * config.stepIntervalMs,
    }) as EvolutionMutation);
  }
  return Object.freeze({ incidentId: config.incidentId, mutations: Object.freeze(mutations), maximumSecondaryEvents: config.maximumSecondaryEvents ?? 4 });
}

export function validateEvolutionConfig(config: EvolutionConfig): void {
  if (!config || typeof config !== "object") throw new SimulationConfigError("Evolution configuration must be an object.");
  if (!Number.isSafeInteger(config.stepCount) || config.stepCount < 1 || config.stepCount > 1_000) throw new SimulationConfigError("stepCount must be from 1 to 1000.");
  if (!Number.isSafeInteger(config.stepIntervalMs) || config.stepIntervalMs < 1) throw new SimulationConfigError("stepIntervalMs must be positive.");
  for (const value of Object.values(config.initialEnvironment ?? {})) if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new SimulationConfigError("Environment values must be normalized from 0 to 1.");
  const probability = config.observationProbability ?? 0.65;
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new SimulationConfigError("observationProbability must be from 0 to 1.");
  if ((config.maximumCascadeDepth ?? 8) < 1 || (config.maximumCascadeDepth ?? 8) > 100) throw new SimulationConfigError("maximumCascadeDepth must be from 1 to 100.");
  if ((config.maximumSecondaryEvents ?? 4) < 0 || (config.maximumSecondaryEvents ?? 4) > 100) throw new SimulationConfigError("maximumSecondaryEvents must be from 0 to 100.");
  if (!Number.isSafeInteger(config.ruleCooldownSteps ?? 0) || (config.ruleCooldownSteps ?? 0) < 0 || (config.ruleCooldownSteps ?? 0) > 1_000) throw new SimulationConfigError("ruleCooldownSteps must be from 0 to 1000.");
}

function initialEnvironment(type: DisasterType, override: Partial<EnvironmentState> | undefined): EnvironmentState {
  const base: EnvironmentState = { rainfall: type === "FLOOD" || type === "SEVERE_STORM" ? 0.55 : 0.1, floodwater: type === "FLOOD" ? 0.25 : 0, wind: type === "SEVERE_STORM" ? 0.5 : type === "URBAN_FIRE" ? 0.25 : 0.1, fire: type === "URBAN_FIRE" ? 0.35 : 0, structuralDamage: type === "EARTHQUAKE_AFTERMATH" ? 0.35 : 0.05, roadAccessibility: 1, electricalAvailability: 1, communicationAvailability: 1, shelterOccupancy: 0.65 };
  return freezeEnv({ ...base, ...(override ?? {}) });
}
function freezeEnv(value: EnvironmentState): EnvironmentState { return Object.freeze({ rainfall: clamp(value.rainfall), floodwater: clamp(value.floodwater), wind: clamp(value.wind), fire: clamp(value.fire), structuralDamage: clamp(value.structuralDamage), roadAccessibility: clamp(value.roadAccessibility), electricalAvailability: clamp(value.electricalAvailability), communicationAvailability: clamp(value.communicationAvailability), shelterOccupancy: clamp(value.shelterOccupancy) }); }
function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }
function change(type: InfrastructureType, status: InfrastructureStatus, condition: number, ruleId: string) { return Object.freeze({ infrastructureId: type, status, condition: clamp(condition), ruleId }); }
