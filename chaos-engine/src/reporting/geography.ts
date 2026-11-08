import { SeededRng, type RandomStream } from "../core/random.js";
import { SimulationConfigError } from "../simulation/errors.js";
import type {
  FictionalGeographyConfig,
  FictionalReportLocation,
} from "./types.js";

const DEFAULT_DISTRICTS = [
  "Fictional Northbridge District",
  "Fictional Harborview District",
  "Fictional Cedar District",
  "Fictional Westhaven District",
  "Fictional Ridgeway District",
] as const;
const DEFAULT_ROADS = [
  "Simulated Alder Road",
  "Simulated Meridian Avenue",
  "Simulated Eastbank Route",
  "Simulated Quarry Lane",
  "Simulated Lantern Street",
] as const;
const DEFAULT_LANDMARKS = [
  "Fictional Cedar Junction",
  "Fictional North Pump Station",
  "Fictional Unity Transit Stop",
  "Fictional Harbor Clock",
  "Fictional Ridgeway Plaza",
] as const;
const DEFAULT_BUILDINGS = [
  "Fictional Community Hall",
  "Fictional Riverside Apartments",
  "Fictional Market Annex",
  "Fictional Transit Depot",
  "Fictional Civic Shelter",
] as const;

export interface ValidatedFictionalGeography {
  readonly districts: readonly string[];
  readonly roads: readonly string[];
  readonly landmarks: readonly string[];
  readonly buildings: readonly string[];
  readonly originX: number;
  readonly originY: number;
  readonly clusterRadius: number;
}

export function validateFictionalGeography(
  input: FictionalGeographyConfig | undefined,
): ValidatedFictionalGeography {
  const geography = input ?? {};
  const result: ValidatedFictionalGeography = {
    districts: validateNames(geography.districts, DEFAULT_DISTRICTS, "districts"),
    roads: validateNames(geography.roads, DEFAULT_ROADS, "roads"),
    landmarks: validateNames(geography.landmarks, DEFAULT_LANDMARKS, "landmarks"),
    buildings: validateNames(geography.buildings, DEFAULT_BUILDINGS, "buildings"),
    originX: validateCoordinate(geography.originX ?? 50_000, "originX"),
    originY: validateCoordinate(geography.originY ?? 50_000, "originY"),
    clusterRadius: validateRadius(geography.clusterRadius ?? 40),
  };
  return Object.freeze(result);
}

export function createFictionalLocation(
  identityMaterial: string,
  incidentId: string,
  reportKey: string,
  geography: ValidatedFictionalGeography,
): FictionalReportLocation {
  const clusterRng = new SeededRng(
    `${identityMaterial}\u0000geography\u0000${incidentId}\u0000${canonicalGeography(geography)}`,
  );
  const cluster = clusterRng.stream("cluster");
  const reportRng = new SeededRng(`${identityMaterial}\u0000${reportKey}`).stream("location-offset");

  const district = pick(geography.districts, cluster);
  const road = pick(geography.roads, cluster);
  const landmark = pick(geography.landmarks, cluster);
  const building = pick(geography.buildings, cluster);
  const baseX = geography.originX + cluster.nextInt(-5_000, 5_001);
  const baseY = geography.originY + cluster.nextInt(-5_000, 5_001);
  const x = baseX + reportRng.nextInt(-geography.clusterRadius, geography.clusterRadius + 1);
  const y = baseY + reportRng.nextInt(-geography.clusterRadius, geography.clusterRadius + 1);
  const formats = [
    `${building} near ${landmark} in ${district}`,
    `${road} beside ${landmark} in ${district}`,
    `the junction of ${road} and ${landmark} in ${district}`,
  ] as const;

  return Object.freeze({
    fictional: true,
    coordinateSystem: "SIMULATED_LOCAL_GRID",
    x,
    y,
    district,
    primaryReference: road,
    secondaryReference: landmark,
    description: formats[reportRng.nextInt(0, formats.length)] ?? formats[0],
  });
}

function validateNames(
  value: readonly string[] | undefined,
  fallback: readonly string[],
  label: string,
): readonly string[] {
  const names = value ?? fallback;
  if (!Array.isArray(names) || names.length === 0) {
    throw new SimulationConfigError(`geography.${label} must be a non-empty array.`);
  }
  const validated = names.map((name) => {
    if (typeof name !== "string" || name.trim().length === 0 || name.length > 128) {
      throw new SimulationConfigError(
        `geography.${label} entries must be non-empty strings up to 128 characters.`,
      );
    }
    if (!/fictional|simulated/i.test(name)) {
      throw new SimulationConfigError(
        `geography.${label} entries must be explicitly labeled fictional or simulated.`,
      );
    }
    return name;
  });
  return Object.freeze(validated);
}

function validateCoordinate(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || Math.abs(value) > 1_000_000_000) {
    throw new SimulationConfigError(`geography.${label} must be a safe local-grid coordinate.`);
  }
  return value;
}

function validateRadius(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new SimulationConfigError("geography.clusterRadius must be an integer from 0 to 10000.");
  }
  return value;
}

function pick<T>(values: readonly T[], stream: RandomStream): T {
  const selected = values[stream.nextInt(0, values.length)];
  if (selected === undefined) {
    throw new SimulationConfigError("Fictional geography contains no selectable values.");
  }
  return selected;
}

function canonicalGeography(geography: ValidatedFictionalGeography): string {
  return JSON.stringify(geography);
}

