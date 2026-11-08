import { SimulationConfigError, SimulationEventError } from "./errors.js";

export const RESPONDER_TYPES = [
  "AMBULANCE",
  "FIRE_ENGINE",
  "WATER_RESCUE",
  "SEARCH_AND_RESCUE",
  "POLICE",
  "UTILITY_REPAIR",
  "EVACUATION_TRANSPORT",
  "SUPPLY_DELIVERY",
] as const;

export const RESPONDER_AVAILABILITY_STATES = [
  "AVAILABLE",
  "RESERVED",
  "EN_ROUTE",
  "ON_SCENE",
  "BUSY",
  "RECOVERING",
  "OFFLINE",
] as const;

export type ResponderType = (typeof RESPONDER_TYPES)[number];
export type ResponderAvailabilityState = (typeof RESPONDER_AVAILABILITY_STATES)[number];

export const MAX_RESPONDER_CREW_CAPACITY = 100;
export const MAX_RESPONDER_CAPABILITY_COUNT = 64;
export const MAX_RESPONDER_INVENTORY_ITEM_TYPES = 100;
export const MAX_RESPONDER_INVENTORY_QUANTITY_PER_ITEM = 10_000;
export const MAX_RESPONDER_TOTAL_INVENTORY_QUANTITY = 100_000;

const CUSTOM_RESPONDER_ID_PATTERN = /^rsp_custom_[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const CALLSIGN_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,31}$/;
const MAX_GRID_COORDINATE = 1_000_000;

const DEFAULT_CAPABILITIES: Readonly<Record<ResponderType, readonly string[]>> =
  Object.freeze({
    AMBULANCE: Object.freeze(["EMERGENCY_MEDICAL_CARE", "PATIENT_TRANSPORT"]),
    FIRE_ENGINE: Object.freeze(["FIRE_SUPPRESSION", "TECHNICAL_RESCUE"]),
    WATER_RESCUE: Object.freeze(["WATER_RESCUE", "FLOOD_RESPONSE"]),
    SEARCH_AND_RESCUE: Object.freeze([
      "SEARCH_AND_RESCUE",
      "SEARCH",
      "TECHNICAL_RESCUE",
    ]),
    POLICE: Object.freeze(["SCENE_SAFETY", "TRAFFIC_CONTROL"]),
    UTILITY_REPAIR: Object.freeze([
      "ELECTRICAL_REPAIR",
      "INFRASTRUCTURE_REPAIR",
      "UTILITY_ISOLATION",
    ]),
    EVACUATION_TRANSPORT: Object.freeze(["MASS_EVACUATION", "PASSENGER_TRANSPORT"]),
    SUPPLY_DELIVERY: Object.freeze(["SUPPLY_TRANSPORT", "LOGISTICS"]),
  });

const VALID_TRANSITIONS = Object.freeze({
  AVAILABLE: Object.freeze(["RESERVED", "OFFLINE"]),
  RESERVED: Object.freeze(["AVAILABLE", "EN_ROUTE", "RECOVERING", "OFFLINE"]),
  EN_ROUTE: Object.freeze(["ON_SCENE", "RECOVERING", "OFFLINE"]),
  ON_SCENE: Object.freeze(["BUSY", "RECOVERING", "OFFLINE"]),
  BUSY: Object.freeze(["ON_SCENE", "RECOVERING", "OFFLINE"]),
  RECOVERING: Object.freeze(["AVAILABLE", "OFFLINE"]),
  OFFLINE: Object.freeze(["AVAILABLE"]),
} as const);

export interface FictionalResponderLocation {
  readonly fictional: true;
  readonly coordinateSystem: "SIMULATED_LOCAL_GRID";
  readonly x: number;
  readonly y: number;
  readonly label: string;
}

export interface InitialResponderDefinition {
  readonly id?: string;
  readonly callsign?: string;
  readonly responderType: ResponderType;
  readonly capabilities?: readonly string[];
  readonly location: FictionalResponderLocation;
  readonly crewCapacity: number;
  readonly equipmentInventory: Readonly<Record<string, number>>;
  readonly initialState?: ResponderAvailabilityState;
}

export interface ValidatedResponderDefinition {
  readonly id?: string;
  readonly callsign?: string;
  readonly responderType: ResponderType;
  readonly capabilities: readonly string[];
  readonly location: FictionalResponderLocation;
  readonly crewCapacity: number;
  readonly equipmentInventory: Readonly<Record<string, number>>;
  readonly initialState: ResponderAvailabilityState;
}

export interface ResponderStateHistoryEntry {
  readonly eventId: string;
  readonly atMs: number;
  readonly previousState: ResponderAvailabilityState | null;
  readonly state: ResponderAvailabilityState;
}

export interface ResponderSnapshot {
  readonly id: string;
  readonly callsign: string;
  readonly responderType: ResponderType;
  readonly capabilities: readonly string[];
  readonly location: FictionalResponderLocation;
  readonly crewCapacity: number;
  readonly equipmentInventory: Readonly<Record<string, number>>;
  readonly availabilityState: ResponderAvailabilityState;
  readonly registeredAtMs: number;
  readonly lastUpdatedAtMs: number;
  readonly eventHistoryIds: readonly string[];
  readonly stateHistory: readonly ResponderStateHistoryEntry[];
}

export interface ResponderRegisteredChange {
  readonly kind: "RESPONDER_REGISTERED";
  readonly responderId: string;
  readonly callsign: string;
  readonly state: ResponderAvailabilityState;
}

export interface ResponderStateChangedChange {
  readonly kind: "RESPONDER_STATE_CHANGED";
  readonly responderId: string;
  readonly previousState: ResponderAvailabilityState;
  readonly state: ResponderAvailabilityState;
}

export type ResponderChange = ResponderRegisteredChange | ResponderStateChangedChange;

export function validateResponderDefinition(
  input: unknown,
  label = "responder",
): ValidatedResponderDefinition {
  if (!isRecord(input)) {
    throw new SimulationConfigError(`${label} must be an object.`);
  }

  const id = input.id;
  if (id !== undefined && (typeof id !== "string" || !CUSTOM_RESPONDER_ID_PATTERN.test(id))) {
    throw new SimulationConfigError(
      `${label}.id must use the rsp_custom_ prefix and contain only letters, digits, hyphens, or underscores.`,
    );
  }

  const callsign = input.callsign;
  if (callsign !== undefined && (typeof callsign !== "string" || !CALLSIGN_PATTERN.test(callsign))) {
    throw new SimulationConfigError(
      `${label}.callsign must contain 1 to 32 uppercase letters, digits, or hyphens.`,
    );
  }

  if (!isResponderType(input.responderType)) {
    throw new SimulationConfigError(`${label}.responderType is not supported.`);
  }
  const responderType = input.responderType;

  const capabilities = validateCapabilities(input.capabilities, responderType, label);
  const location = validateLocation(input.location, `${label}.location`);
  const crewCapacity = requireSafeInteger(input.crewCapacity, `${label}.crewCapacity`);
  if (crewCapacity < 1 || crewCapacity > MAX_RESPONDER_CREW_CAPACITY) {
    throw new SimulationConfigError(
      `${label}.crewCapacity must be between 1 and ${MAX_RESPONDER_CREW_CAPACITY}.`,
    );
  }

  const equipmentInventory = validateInventory(
    input.equipmentInventory,
    `${label}.equipmentInventory`,
  );
  const initialState = input.initialState ?? "AVAILABLE";
  if (!isResponderAvailabilityState(initialState)) {
    throw new SimulationConfigError(`${label}.initialState is not supported.`);
  }

  return Object.freeze({
    ...(id === undefined ? {} : { id }),
    ...(callsign === undefined ? {} : { callsign }),
    responderType,
    capabilities,
    location,
    crewCapacity,
    equipmentInventory,
    initialState,
  });
}

export function isValidResponderTransition(
  from: ResponderAvailabilityState,
  to: ResponderAvailabilityState,
): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export function createResponder(
  id: string,
  callsign: string,
  definition: ValidatedResponderDefinition,
  eventId: string,
  timestampMs: number,
): { responder: ResponderSnapshot; change: ResponderRegisteredChange } {
  const historyEntry = Object.freeze({
    eventId,
    atMs: timestampMs,
    previousState: null,
    state: definition.initialState,
  });
  const responder = freezeResponderSnapshot({
    id,
    callsign,
    responderType: definition.responderType,
    capabilities: definition.capabilities,
    location: definition.location,
    crewCapacity: definition.crewCapacity,
    equipmentInventory: definition.equipmentInventory,
    availabilityState: definition.initialState,
    registeredAtMs: timestampMs,
    lastUpdatedAtMs: timestampMs,
    eventHistoryIds: [eventId],
    stateHistory: [historyEntry],
  });
  return {
    responder,
    change: Object.freeze({
      kind: "RESPONDER_REGISTERED",
      responderId: id,
      callsign,
      state: definition.initialState,
    }),
  };
}

export function transitionResponder(
  current: ResponderSnapshot,
  targetState: ResponderAvailabilityState,
  eventId: string,
  timestampMs: number,
): { responder: ResponderSnapshot; change: ResponderStateChangedChange } {
  if (!isValidResponderTransition(current.availabilityState, targetState)) {
    throw new SimulationEventError(
      `Responder ${current.id} cannot transition from ${current.availabilityState} to ${targetState}.`,
    );
  }
  const entry = Object.freeze({
    eventId,
    atMs: timestampMs,
    previousState: current.availabilityState,
    state: targetState,
  });
  const responder = freezeResponderSnapshot({
    ...current,
    availabilityState: targetState,
    lastUpdatedAtMs: timestampMs,
    eventHistoryIds: [...current.eventHistoryIds, eventId],
    stateHistory: [...current.stateHistory, entry],
  });
  return {
    responder,
    change: Object.freeze({
      kind: "RESPONDER_STATE_CHANGED",
      responderId: current.id,
      previousState: current.availabilityState,
      state: targetState,
    }),
  };
}

export function freezeResponderSnapshot(responder: ResponderSnapshot): ResponderSnapshot {
  return Object.freeze({
    ...responder,
    capabilities: Object.freeze([...responder.capabilities]),
    location: Object.freeze({ ...responder.location }),
    equipmentInventory: Object.freeze({ ...responder.equipmentInventory }),
    eventHistoryIds: Object.freeze([...responder.eventHistoryIds]),
    stateHistory: Object.freeze(
      responder.stateHistory.map((entry) => Object.freeze({ ...entry })),
    ),
  });
}

function validateCapabilities(
  value: unknown,
  responderType: ResponderType,
  label: string,
): readonly string[] {
  if (value === undefined) {
    return Object.freeze([...DEFAULT_CAPABILITIES[responderType]]);
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new SimulationConfigError(`${label}.capabilities must be a non-empty array.`);
  }
  if (value.length > MAX_RESPONDER_CAPABILITY_COUNT) {
    throw new SimulationConfigError(
      `${label}.capabilities must not exceed ${MAX_RESPONDER_CAPABILITY_COUNT} entries.`,
    );
  }
  const capabilities = value.map((item, index) =>
    requireNonEmptyString(item, `${label}.capabilities[${index}]`, 64),
  );
  if (new Set(capabilities).size !== capabilities.length) {
    throw new SimulationConfigError(`${label}.capabilities must not contain duplicates.`);
  }
  return Object.freeze(capabilities);
}

function validateLocation(value: unknown, label: string): FictionalResponderLocation {
  if (!isRecord(value)) {
    throw new SimulationConfigError(`${label} must be an object.`);
  }
  if (value.fictional !== true || value.coordinateSystem !== "SIMULATED_LOCAL_GRID") {
    throw new SimulationConfigError(
      `${label} must be explicitly fictional and use SIMULATED_LOCAL_GRID.`,
    );
  }
  const x = requireFiniteNumber(value.x, `${label}.x`);
  const y = requireFiniteNumber(value.y, `${label}.y`);
  if (Math.abs(x) > MAX_GRID_COORDINATE || Math.abs(y) > MAX_GRID_COORDINATE) {
    throw new SimulationConfigError(
      `${label} coordinates must be within ${MAX_GRID_COORDINATE} simulated units.`,
    );
  }
  const locationLabel = requireNonEmptyString(value.label, `${label}.label`, 256);
  if (!/fictional|simulated/i.test(locationLabel)) {
    throw new SimulationConfigError(`${label}.label must identify the location as fictional or simulated.`);
  }
  return Object.freeze({
    fictional: true,
    coordinateSystem: "SIMULATED_LOCAL_GRID",
    x,
    y,
    label: locationLabel,
  });
}

function validateInventory(value: unknown, label: string): Readonly<Record<string, number>> {
  if (!isRecord(value)) {
    throw new SimulationConfigError(`${label} must be an object.`);
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_RESPONDER_INVENTORY_ITEM_TYPES) {
    throw new SimulationConfigError(
      `${label} must not exceed ${MAX_RESPONDER_INVENTORY_ITEM_TYPES} item types.`,
    );
  }
  let total = 0;
  const inventory: Record<string, number> = {};
  for (const [name, rawQuantity] of entries) {
    if (name.trim().length === 0 || name.length > 64) {
      throw new SimulationConfigError(`${label} item names must contain 1 to 64 characters.`);
    }
    const quantity = requireSafeInteger(rawQuantity, `${label}.${name}`);
    if (quantity < 0 || quantity > MAX_RESPONDER_INVENTORY_QUANTITY_PER_ITEM) {
      throw new SimulationConfigError(
        `${label}.${name} must be between 0 and ${MAX_RESPONDER_INVENTORY_QUANTITY_PER_ITEM}.`,
      );
    }
    total += quantity;
    if (total > MAX_RESPONDER_TOTAL_INVENTORY_QUANTITY) {
      throw new SimulationConfigError(
        `${label} total quantity must not exceed ${MAX_RESPONDER_TOTAL_INVENTORY_QUANTITY}.`,
      );
    }
    inventory[name] = quantity;
  }
  return Object.freeze(inventory);
}

function isResponderType(value: unknown): value is ResponderType {
  return typeof value === "string" && (RESPONDER_TYPES as readonly string[]).includes(value);
}

export function isResponderAvailabilityState(
  value: unknown,
): value is ResponderAvailabilityState {
  return (
    typeof value === "string" &&
    (RESPONDER_AVAILABILITY_STATES as readonly string[]).includes(value)
  );
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
