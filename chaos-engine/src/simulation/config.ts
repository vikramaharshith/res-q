import { SimulationConfigError } from "./errors.js";
import {
  validateResponderDefinition,
  type InitialResponderDefinition,
  type ValidatedResponderDefinition,
} from "./responder.js";
import {
  defaultRoadNetworkConfig,
  validateRoadNetworkConfig,
  type RoadNetworkConfig,
} from "./travel.js";
import {
  validateCommunicationConfig,
  type CommunicationConfig,
  type ValidatedCommunicationConfig,
} from "./communication.js";
import {
  validateResourceConfig,
  type ResourceConfig,
  type ValidatedResourceConfig,
} from "./resources.js";

export const MIN_INCIDENT_SEVERITY = 1;
export const MAX_INCIDENT_SEVERITY = 10;

const DEFAULT_MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_EVENT_COUNT = 100_000;
const DEFAULT_MAX_INCIDENT_COUNT = 10_000;
const DEFAULT_MAX_RESPONDER_COUNT = 1_000;
const DEFAULT_MAX_TASK_COUNT = 10_000;
const DEFAULT_MAX_TRAVEL_ATTEMPT_COUNT = 1_000;
const ABSOLUTE_MAX_EVENT_COUNT = 1_000_000;
const ABSOLUTE_MAX_INCIDENT_COUNT = 100_000;
const ABSOLUTE_MAX_RESPONDER_COUNT = 10_000;
const ABSOLUTE_MAX_TASK_COUNT = 100_000;
const ABSOLUTE_MAX_TRAVEL_ATTEMPT_COUNT = 10_000;
const CUSTOM_INCIDENT_ID_PATTERN = /^inc_custom_[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export interface SimulatedLocation {
  latitude: number;
  longitude: number;
  label?: string;
}

export interface InitialIncidentDefinition {
  id?: string;
  incidentType: string;
  location: SimulatedLocation;
  severity: number;
}

export interface SimulationConfig {
  scenarioId: string;
  seed: string | number;
  startTimeMs: number;
  maxDurationMs?: number;
  maxEventCount?: number;
  maxIncidentCount?: number;
  maxResponderCount?: number;
  maxTaskCount?: number;
  automaticTaskAssignment?: boolean;
  maxTravelAttemptCount?: number;
  roadNetwork?: RoadNetworkConfig;
  communication?: CommunicationConfig;
  resources?: ResourceConfig;
  initialIncidents?: readonly InitialIncidentDefinition[];
  initialResponders?: readonly InitialResponderDefinition[];
}

export interface ValidatedSimulationConfig {
  readonly scenarioId: string;
  readonly seed: string;
  readonly startTimeMs: number;
  readonly maxDurationMs: number;
  readonly maxEventCount: number;
  readonly maxIncidentCount: number;
  readonly maxResponderCount: number;
  readonly maxTaskCount: number;
  readonly automaticTaskAssignment: boolean;
  readonly maxTravelAttemptCount: number;
  readonly roadNetwork: RoadNetworkConfig;
  readonly communication: ValidatedCommunicationConfig;
  readonly resources: ValidatedResourceConfig;
  readonly initialIncidents: readonly Readonly<InitialIncidentDefinition>[];
  readonly initialResponders: readonly ValidatedResponderDefinition[];
}

export function validateSimulationConfig(input: unknown): ValidatedSimulationConfig {
  if (!isRecord(input)) {
    throw new SimulationConfigError("Simulation configuration must be an object.");
  }

  const scenarioId = requireNonEmptyString(input.scenarioId, "scenarioId", 128);
  const seed = normalizeSeed(input.seed);
  const startTimeMs = requireSafeInteger(input.startTimeMs, "startTimeMs");
  const maxDurationMs = optionalPositiveInteger(
    input.maxDurationMs,
    "maxDurationMs",
    DEFAULT_MAX_DURATION_MS,
  );
  const maxEventCount = optionalBoundedPositiveInteger(
    input.maxEventCount,
    "maxEventCount",
    DEFAULT_MAX_EVENT_COUNT,
    ABSOLUTE_MAX_EVENT_COUNT,
  );
  const maxIncidentCount = optionalBoundedPositiveInteger(
    input.maxIncidentCount,
    "maxIncidentCount",
    DEFAULT_MAX_INCIDENT_COUNT,
    ABSOLUTE_MAX_INCIDENT_COUNT,
  );
  const maxResponderCount = optionalBoundedPositiveInteger(
    input.maxResponderCount,
    "maxResponderCount",
    DEFAULT_MAX_RESPONDER_COUNT,
    ABSOLUTE_MAX_RESPONDER_COUNT,
  );
  const maxTaskCount = optionalBoundedPositiveInteger(
    input.maxTaskCount,
    "maxTaskCount",
    DEFAULT_MAX_TASK_COUNT,
    ABSOLUTE_MAX_TASK_COUNT,
  );
  const automaticTaskAssignment = input.automaticTaskAssignment ?? false;
  if (typeof automaticTaskAssignment !== "boolean") {
    throw new SimulationConfigError("automaticTaskAssignment must be a boolean.");
  }
  const maxTravelAttemptCount = optionalBoundedPositiveInteger(
    input.maxTravelAttemptCount,
    "maxTravelAttemptCount",
    DEFAULT_MAX_TRAVEL_ATTEMPT_COUNT,
    ABSOLUTE_MAX_TRAVEL_ATTEMPT_COUNT,
  );
  const roadNetwork = validateRoadNetworkConfig(
    input.roadNetwork ?? defaultRoadNetworkConfig(),
  );
  const communication = validateCommunicationConfig(input.communication);
  const resources = validateResourceConfig(input.resources);

  if (!Number.isSafeInteger(startTimeMs + maxDurationMs)) {
    throw new SimulationConfigError("startTimeMs plus maxDurationMs exceeds the safe range.");
  }

  const rawInitialIncidents = input.initialIncidents ?? [];
  if (!Array.isArray(rawInitialIncidents)) {
    throw new SimulationConfigError("initialIncidents must be an array.");
  }
  if (rawInitialIncidents.length > maxIncidentCount) {
    throw new SimulationConfigError("Initial incidents exceed maxIncidentCount.");
  }
  if (rawInitialIncidents.length > maxEventCount) {
    throw new SimulationConfigError("Initial incident events exceed maxEventCount.");
  }

  const explicitIds = new Set<string>();
  const initialIncidents = rawInitialIncidents.map((incident, index) => {
    const validated = validateIncidentDefinition(incident, `initialIncidents[${index}]`);
    if (validated.id !== undefined) {
      if (explicitIds.has(validated.id)) {
        throw new SimulationConfigError(`Duplicate initial incident ID: ${validated.id}.`);
      }
      explicitIds.add(validated.id);
    }
    return validated;
  });

  const rawInitialResponders = input.initialResponders ?? [];
  if (!Array.isArray(rawInitialResponders)) {
    throw new SimulationConfigError("initialResponders must be an array.");
  }
  if (rawInitialResponders.length > maxResponderCount) {
    throw new SimulationConfigError("Initial responders exceed maxResponderCount.");
  }
  if (rawInitialIncidents.length + rawInitialResponders.length > maxEventCount) {
    throw new SimulationConfigError("Initial entity events exceed maxEventCount.");
  }

  const responderIds = new Set<string>();
  const callsigns = new Set<string>();
  const initialResponders = rawInitialResponders.map((responder, index) => {
    const validated = validateResponderDefinition(responder, `initialResponders[${index}]`);
    if (validated.id !== undefined) {
      if (responderIds.has(validated.id)) {
        throw new SimulationConfigError(`Duplicate initial responder ID: ${validated.id}.`);
      }
      responderIds.add(validated.id);
    }
    if (validated.callsign !== undefined) {
      if (callsigns.has(validated.callsign)) {
        throw new SimulationConfigError(
          `Duplicate initial responder callsign: ${validated.callsign}.`,
        );
      }
      callsigns.add(validated.callsign);
    }
    return validated;
  });

  return Object.freeze({
    scenarioId,
    seed,
    startTimeMs,
    maxDurationMs,
    maxEventCount,
    maxIncidentCount,
    maxResponderCount,
    maxTaskCount,
    automaticTaskAssignment,
    maxTravelAttemptCount,
    roadNetwork,
    communication,
    resources,
    initialIncidents: Object.freeze(initialIncidents),
    initialResponders: Object.freeze(initialResponders),
  });
}

export function validateIncidentDefinition(
  input: unknown,
  label = "incident",
): Readonly<InitialIncidentDefinition> {
  if (!isRecord(input)) {
    throw new SimulationConfigError(`${label} must be an object.`);
  }

  const id = input.id;
  if (id !== undefined && (typeof id !== "string" || !CUSTOM_INCIDENT_ID_PATTERN.test(id))) {
    throw new SimulationConfigError(
      `${label}.id must use the inc_custom_ prefix and contain only letters, digits, hyphens, or underscores.`,
    );
  }

  const incidentType = requireNonEmptyString(input.incidentType, `${label}.incidentType`, 128);
  const severity = requireSafeInteger(input.severity, `${label}.severity`);
  if (severity < MIN_INCIDENT_SEVERITY || severity > MAX_INCIDENT_SEVERITY) {
    throw new SimulationConfigError(
      `${label}.severity must be between ${MIN_INCIDENT_SEVERITY} and ${MAX_INCIDENT_SEVERITY}.`,
    );
  }

  if (!isRecord(input.location)) {
    throw new SimulationConfigError(`${label}.location must be an object.`);
  }
  const latitude = requireFiniteNumber(input.location.latitude, `${label}.location.latitude`);
  const longitude = requireFiniteNumber(input.location.longitude, `${label}.location.longitude`);
  if (latitude < -90 || latitude > 90) {
    throw new SimulationConfigError(`${label}.location.latitude must be between -90 and 90.`);
  }
  if (longitude < -180 || longitude > 180) {
    throw new SimulationConfigError(`${label}.location.longitude must be between -180 and 180.`);
  }

  const rawLocationLabel = input.location.label;
  const locationLabel =
    rawLocationLabel === undefined
      ? undefined
      : requireNonEmptyString(rawLocationLabel, `${label}.location.label`, 256);
  const location: SimulatedLocation = Object.freeze({
    latitude,
    longitude,
    ...(locationLabel === undefined ? {} : { label: locationLabel }),
  });

  return Object.freeze({
    ...(id === undefined ? {} : { id }),
    incidentType,
    location,
    severity,
  });
}

export function canonicalizeConfig(config: ValidatedSimulationConfig): string {
  return JSON.stringify({
    scenarioId: config.scenarioId,
    seed: config.seed,
    startTimeMs: config.startTimeMs,
    maxDurationMs: config.maxDurationMs,
    maxEventCount: config.maxEventCount,
    maxIncidentCount: config.maxIncidentCount,
    maxResponderCount: config.maxResponderCount,
    maxTaskCount: config.maxTaskCount,
    automaticTaskAssignment: config.automaticTaskAssignment,
    maxTravelAttemptCount: config.maxTravelAttemptCount,
    roadNetwork: {
      nodes: config.roadNetwork.nodes.map((node) => ({ id: node.id, location: node.location })),
      segments: config.roadNetwork.segments.map((segment) => ({
        id: segment.id,
        fromNodeId: segment.fromNodeId,
        toNodeId: segment.toNodeId,
        distanceUnits: segment.distanceUnits,
        speedUnitsPerSecond: segment.speedUnitsPerSecond,
        congestionPermille: segment.congestionPermille ?? 1_000,
        bidirectional: segment.bidirectional ?? true,
        initialState: segment.initialState ?? "ACCESSIBLE",
        infrastructureType: segment.infrastructureType ?? null,
      })),
    },
    communication: config.communication,
    resources: config.resources,
    initialIncidents: config.initialIncidents.map((incident) => ({
      id: incident.id ?? null,
      incidentType: incident.incidentType,
      location: {
        latitude: incident.location.latitude,
        longitude: incident.location.longitude,
        label: incident.location.label ?? null,
      },
      severity: incident.severity,
    })),
    initialResponders: config.initialResponders.map((responder) => ({
      id: responder.id ?? null,
      callsign: responder.callsign ?? null,
      responderType: responder.responderType,
      capabilities: responder.capabilities,
      location: responder.location,
      crewCapacity: responder.crewCapacity,
      equipmentInventory: responder.equipmentInventory,
      initialState: responder.initialState,
    })),
  });
}

function normalizeSeed(value: unknown): string {
  if (typeof value === "string") {
    if (value.length === 0 || value.length > 256) {
      throw new SimulationConfigError("seed must contain between 1 and 256 characters.");
    }
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return String(value);
  }
  throw new SimulationConfigError("seed must be a non-empty string or safe integer.");
}

function requireNonEmptyString(value: unknown, label: string, maximumLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximumLength) {
    throw new SimulationConfigError(
      `${label} must be a non-empty string no longer than ${maximumLength} characters.`,
    );
  }
  return value;
}

function requireSafeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new SimulationConfigError(`${label} must be a safe integer.`);
  }
  return value;
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SimulationConfigError(`${label} must be a finite number.`);
  }
  return value;
}

function optionalPositiveInteger(value: unknown, label: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = requireSafeInteger(value, label);
  if (parsed <= 0) {
    throw new SimulationConfigError(`${label} must be greater than zero.`);
  }
  return parsed;
}

function optionalBoundedPositiveInteger(
  value: unknown,
  label: string,
  fallback: number,
  maximum: number,
): number {
  const parsed = optionalPositiveInteger(value, label, fallback);
  if (parsed > maximum) {
    throw new SimulationConfigError(`${label} must not exceed ${maximum}.`);
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

