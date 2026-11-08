import { SimulationConfigError, SimulationEventError } from "./errors.js";
import type { ResponderSnapshot } from "./responder.js";
import type { TaskSnapshot } from "./task.js";
import { validateTravelLocation, type FictionalTravelLocation } from "./travel.js";

export const EQUIPMENT_CONDITIONS = ["OPERATIONAL", "DEGRADED", "UNAVAILABLE", "UNDER_REPAIR"] as const;
export const RESOURCE_CATEGORIES = ["MEDICAL_SUPPLY", "RESCUE_CONSUMABLE", "FIRE_SUPPRESSION", "FUEL_ENERGY", "REPAIR_MATERIAL", "FOOD_WATER", "EMERGENCY_SUPPLY", "REUSABLE_EQUIPMENT"] as const;
export type EquipmentCondition = (typeof EQUIPMENT_CONDITIONS)[number];
export type ResourceCategory = (typeof RESOURCE_CATEGORIES)[number];
export type FatigueMode = "INACTIVE" | "TRAVEL" | "WORK" | "RECOVERY";

export const MAX_FATIGUE = 100;
export const MAX_RESOURCE_RATE_PER_HOUR = 1_000;
export const MAX_RECOVERY_DURATION_MS = 30 * 24 * 60 * 60 * 1_000;
export const MAX_STOCKPILES = 1_000;
export const MAX_STOCKPILE_ITEM_QUANTITY = 1_000_000;
export const MAX_STOCKPILE_TOTAL_QUANTITY = 10_000_000;
export const MAX_REPLENISHMENT_QUANTITY = 100_000;
export const MAX_REPLENISHMENT_DELAY_MS = 30 * 24 * 60 * 60 * 1_000;
export const MAX_TOTAL_RESOURCE_EVENTS = 500_000;

export interface ResourceDefinition {
  readonly category: ResourceCategory;
  readonly consumable: boolean;
  readonly essential?: boolean;
}

export interface StockpileDefinition {
  readonly id: string;
  readonly location: FictionalTravelLocation;
  readonly inventory: Readonly<Record<string, number>>;
}

export interface ResourceConfig {
  readonly enabled?: boolean;
  readonly maximumFatigue?: number;
  readonly initialFatigue?: number;
  readonly responderInitialFatigue?: Readonly<Record<string, number>>;
  readonly travelFatiguePerHour?: number;
  readonly workFatiguePerHour?: number;
  readonly inactiveRecoveryPerHour?: number;
  readonly recoveryReductionPerHour?: number;
  readonly assignmentFatigueThreshold?: number;
  readonly recoveryCompletionThreshold?: number;
  readonly recoveryDurationMs?: number;
  readonly resourceDefinitions?: Readonly<Record<string, ResourceDefinition>>;
  readonly responderEquipmentConditions?: Readonly<Record<string, Readonly<Record<string, EquipmentCondition>>>>;
  readonly initialStockpiles?: readonly StockpileDefinition[];
  readonly maxStockpileCount?: number;
  readonly maxReplenishmentAmount?: number;
  readonly defaultReplenishmentDelayMs?: number;
  readonly maxReplenishmentDelayMs?: number;
  readonly maxResourceEvents?: number;
}

export interface ValidatedResourceConfig {
  readonly enabled: boolean;
  readonly maximumFatigue: number;
  readonly initialFatigue: number;
  readonly responderInitialFatigue: Readonly<Record<string, number>>;
  readonly travelFatiguePerHour: number;
  readonly workFatiguePerHour: number;
  readonly inactiveRecoveryPerHour: number;
  readonly recoveryReductionPerHour: number;
  readonly assignmentFatigueThreshold: number;
  readonly recoveryCompletionThreshold: number;
  readonly recoveryDurationMs: number;
  readonly resourceDefinitions: Readonly<Record<string, Readonly<Required<ResourceDefinition>>>>;
  readonly responderEquipmentConditions: Readonly<Record<string, Readonly<Record<string, EquipmentCondition>>>>;
  readonly initialStockpiles: readonly StockpileDefinition[];
  readonly maxStockpileCount: number;
  readonly maxReplenishmentAmount: number;
  readonly defaultReplenishmentDelayMs: number;
  readonly maxReplenishmentDelayMs: number;
  readonly maxResourceEvents: number;
}

export interface ResourceHistoryEntry {
  readonly eventId: string;
  readonly causeEventId?: string;
  readonly atMs: number;
  readonly action: "INITIALIZED" | "FATIGUE_UPDATED" | "MODE_CHANGED" | "RESOURCE_RESERVED" | "RESOURCE_CONSUMED" | "RESOURCE_RELEASED" | "EQUIPMENT_CHANGED" | "REPLENISHED";
  readonly fatigue: number;
  readonly fatigueMode: FatigueMode;
  readonly details?: Readonly<Record<string, number | string>>;
}

export interface ResponderResourceSnapshot {
  readonly responderId: string;
  readonly fatigue: number;
  readonly fatigueMode: FatigueMode;
  readonly lastFatigueUpdatedAtMs: number;
  readonly inventory: Readonly<Record<string, number>>;
  readonly equipmentConditions: Readonly<Record<string, EquipmentCondition>>;
  readonly history: readonly ResourceHistoryEntry[];
}

export interface TaskResourceSnapshot {
  readonly taskId: string;
  readonly responderId: string;
  readonly reservedConsumables: Readonly<Record<string, number>>;
  readonly reusableEquipment: Readonly<Record<string, number>>;
  readonly status: "RESERVED" | "CONSUMED" | "RELEASED";
  readonly reservedAtMs: number;
  readonly consumedAtMs?: number;
  readonly releasedAtMs?: number;
  readonly eventHistoryIds: readonly string[];
}

export interface StockpileSnapshot extends StockpileDefinition {
  readonly registeredAtMs: number;
  readonly history: readonly Readonly<{ eventId: string; causeEventId?: string; atMs: number; action: "REGISTERED" | "TRANSFERRED"; quantities: Readonly<Record<string, number>> }>[];
}

export interface ReplenishmentSnapshot {
  readonly id: string;
  readonly stockpileId: string;
  readonly responderId: string;
  readonly quantities: Readonly<Record<string, number>>;
  readonly requestedAtMs: number;
  readonly scheduledCompletionAtMs: number;
  readonly status: "PENDING" | "COMPLETED" | "FAILED";
  readonly eventHistoryIds: readonly string[];
  readonly failureReason?: "INSUFFICIENT_STOCK" | "DESTINATION_CAPACITY";
}

export interface ResourceChange {
  readonly kind: "FATIGUE_UPDATED" | "RESOURCE_RESERVED" | "RESOURCE_CONSUMED" | "RESOURCE_RELEASED" | "EQUIPMENT_CHANGED" | "TASK_RELEASED" | "RECOVERY_STARTED" | "RECOVERY_COMPLETED" | "STOCKPILE_REGISTERED" | "REPLENISHMENT_REQUESTED" | "REPLENISHMENT_COMPLETED" | "RESOURCE_EVENT_IGNORED";
  readonly responderId?: string;
  readonly taskId?: string;
  readonly stockpileId?: string;
  readonly replenishmentId?: string;
  readonly reason?: string;
}

export function validateResourceConfig(input: unknown): ValidatedResourceConfig {
  if (input === undefined) input = {};
  if (!isRecord(input)) throw new SimulationConfigError("resources must be an object.");
  const enabled = input.enabled ?? false;
  if (typeof enabled !== "boolean") throw new SimulationConfigError("resources.enabled must be a boolean.");
  const maximumFatigue = bounded(input.maximumFatigue ?? MAX_FATIGUE, "resources.maximumFatigue", 1, MAX_FATIGUE);
  const initialFatigue = bounded(input.initialFatigue ?? 0, "resources.initialFatigue", 0, maximumFatigue);
  const responderInitialFatigue = validateFatigueMap(input.responderInitialFatigue, maximumFatigue);
  const travelFatiguePerHour = bounded(input.travelFatiguePerHour ?? 12, "resources.travelFatiguePerHour", 0, MAX_RESOURCE_RATE_PER_HOUR);
  const workFatiguePerHour = bounded(input.workFatiguePerHour ?? 20, "resources.workFatiguePerHour", 0, MAX_RESOURCE_RATE_PER_HOUR);
  const inactiveRecoveryPerHour = bounded(input.inactiveRecoveryPerHour ?? 0, "resources.inactiveRecoveryPerHour", 0, MAX_RESOURCE_RATE_PER_HOUR);
  const recoveryReductionPerHour = bounded(input.recoveryReductionPerHour ?? 50, "resources.recoveryReductionPerHour", 0, MAX_RESOURCE_RATE_PER_HOUR);
  const assignmentFatigueThreshold = bounded(input.assignmentFatigueThreshold ?? Math.min(80, maximumFatigue), "resources.assignmentFatigueThreshold", 0, maximumFatigue);
  const recoveryCompletionThreshold = bounded(input.recoveryCompletionThreshold ?? Math.min(40, maximumFatigue), "resources.recoveryCompletionThreshold", 0, maximumFatigue);
  const recoveryDurationMs = integer(input.recoveryDurationMs ?? 60 * 60 * 1_000, "resources.recoveryDurationMs", 1, MAX_RECOVERY_DURATION_MS);
  const resourceDefinitions = validateDefinitions(input.resourceDefinitions);
  const responderEquipmentConditions = validateConditionMap(input.responderEquipmentConditions);
  const maxStockpileCount = integer(input.maxStockpileCount ?? 100, "resources.maxStockpileCount", 1, MAX_STOCKPILES);
  const initialStockpiles = validateStockpiles(input.initialStockpiles, maxStockpileCount);
  const maxReplenishmentAmount = integer(input.maxReplenishmentAmount ?? 10_000, "resources.maxReplenishmentAmount", 1, MAX_REPLENISHMENT_QUANTITY);
  const defaultReplenishmentDelayMs = integer(input.defaultReplenishmentDelayMs ?? 60_000, "resources.defaultReplenishmentDelayMs", 0, MAX_REPLENISHMENT_DELAY_MS);
  const maxReplenishmentDelayMs = integer(input.maxReplenishmentDelayMs ?? MAX_REPLENISHMENT_DELAY_MS, "resources.maxReplenishmentDelayMs", 0, MAX_REPLENISHMENT_DELAY_MS);
  if (defaultReplenishmentDelayMs > maxReplenishmentDelayMs) throw new SimulationConfigError("Default replenishment delay exceeds its maximum.");
  const maxResourceEvents = integer(input.maxResourceEvents ?? 100_000, "resources.maxResourceEvents", 1, MAX_TOTAL_RESOURCE_EVENTS);
  return Object.freeze({ enabled, maximumFatigue, initialFatigue, responderInitialFatigue, travelFatiguePerHour, workFatiguePerHour, inactiveRecoveryPerHour, recoveryReductionPerHour, assignmentFatigueThreshold, recoveryCompletionThreshold, recoveryDurationMs, resourceDefinitions, responderEquipmentConditions, initialStockpiles, maxStockpileCount, maxReplenishmentAmount, defaultReplenishmentDelayMs, maxReplenishmentDelayMs, maxResourceEvents });
}

export function createResponderResource(responder: ResponderSnapshot, config: ValidatedResourceConfig, eventId: string, atMs: number): ResponderResourceSnapshot {
  const fatigue = config.responderInitialFatigue[responder.id] ?? config.responderInitialFatigue[responder.callsign] ?? config.initialFatigue;
  const configured = config.responderEquipmentConditions[responder.id] ?? config.responderEquipmentConditions[responder.callsign] ?? {};
  const conditions: Record<string, EquipmentCondition> = {};
  for (const item of Object.keys(responder.equipmentInventory)) conditions[item] = configured[item] ?? "OPERATIONAL";
  return freezeResponderResource({ responderId: responder.id, fatigue, fatigueMode: "INACTIVE", lastFatigueUpdatedAtMs: atMs, inventory: responder.equipmentInventory, equipmentConditions: conditions, history: [history(eventId, atMs, "INITIALIZED", fatigue, "INACTIVE")] });
}

export function advanceResponderFatigue(current: ResponderResourceSnapshot, atMs: number, eventId: string, config: ValidatedResourceConfig, nextMode = current.fatigueMode, causeEventId?: string): ResponderResourceSnapshot {
  if (atMs < current.lastFatigueUpdatedAtMs) throw new SimulationEventError("Fatigue cannot update backward in virtual time.");
  const elapsed = atMs - current.lastFatigueUpdatedAtMs;
  const rate = current.fatigueMode === "TRAVEL" ? config.travelFatiguePerHour : current.fatigueMode === "WORK" ? config.workFatiguePerHour : current.fatigueMode === "RECOVERY" ? -config.recoveryReductionPerHour : -config.inactiveRecoveryPerHour;
  const fatigue = clamp(round(current.fatigue + elapsed * rate / 3_600_000), 0, config.maximumFatigue);
  const action = nextMode === current.fatigueMode ? "FATIGUE_UPDATED" : "MODE_CHANGED";
  return freezeResponderResource({ ...current, fatigue, fatigueMode: nextMode, lastFatigueUpdatedAtMs: atMs, history: [...current.history, history(eventId, atMs, action, fatigue, nextMode, causeEventId, { elapsedMs: elapsed })] });
}

export function reserveTaskResources(task: TaskSnapshot, responder: ResponderResourceSnapshot, config: ValidatedResourceConfig, eventId: string, atMs: number): { responder: ResponderResourceSnapshot; reservation: TaskResourceSnapshot } {
  const consumables: Record<string, number> = {};
  const reusable: Record<string, number> = {};
  for (const [item, quantity] of Object.entries(task.requiredEquipment)) {
    if ((responder.inventory[item] ?? 0) < quantity) throw new SimulationEventError(`Responder ${responder.responderId} lacks ${item}.`);
    const condition = responder.equipmentConditions[item] ?? "OPERATIONAL";
    if (condition === "UNAVAILABLE" || condition === "UNDER_REPAIR") throw new SimulationEventError(`Responder ${responder.responderId} equipment ${item} is ${condition}.`);
    if (config.resourceDefinitions[item]?.consumable === true) consumables[item] = quantity;
    else reusable[item] = quantity;
  }
  const reservation = freezeTaskResource({ taskId: task.id, responderId: responder.responderId, reservedConsumables: consumables, reusableEquipment: reusable, status: "RESERVED", reservedAtMs: atMs, eventHistoryIds: [eventId] });
  return { responder: appendResourceHistory(responder, eventId, atMs, "RESOURCE_RESERVED", { taskId: task.id }), reservation };
}

export function consumeTaskResources(responder: ResponderResourceSnapshot, reservation: TaskResourceSnapshot, eventId: string, atMs: number): { responder: ResponderResourceSnapshot; reservation: TaskResourceSnapshot } {
  if (reservation.status === "CONSUMED") return { responder, reservation };
  if (reservation.status !== "RESERVED") throw new SimulationEventError(`Task ${reservation.taskId} resources are not reserved.`);
  const inventory = { ...responder.inventory };
  for (const [item, quantity] of Object.entries(reservation.reservedConsumables)) {
    if ((inventory[item] ?? 0) < quantity) throw new SimulationEventError(`Responder ${responder.responderId} has insufficient ${item} at task start.`);
    inventory[item] = (inventory[item] ?? 0) - quantity;
  }
  return {
    responder: freezeResponderResource({ ...appendResourceHistory(responder, eventId, atMs, "RESOURCE_CONSUMED", reservation.reservedConsumables), inventory }),
    reservation: freezeTaskResource({ ...reservation, status: "CONSUMED", consumedAtMs: atMs, eventHistoryIds: [...reservation.eventHistoryIds, eventId] }),
  };
}

export function releaseTaskResources(responder: ResponderResourceSnapshot, reservation: TaskResourceSnapshot, eventId: string, atMs: number): { responder: ResponderResourceSnapshot; reservation: TaskResourceSnapshot } {
  if (reservation.status !== "RESERVED") return { responder, reservation };
  return { responder: appendResourceHistory(responder, eventId, atMs, "RESOURCE_RELEASED", { taskId: reservation.taskId }), reservation: freezeTaskResource({ ...reservation, status: "RELEASED", releasedAtMs: atMs, eventHistoryIds: [...reservation.eventHistoryIds, eventId] }) };
}

export function changeEquipmentCondition(current: ResponderResourceSnapshot, item: string, target: EquipmentCondition, eventId: string, atMs: number, causeEventId?: string, simulatedCause?: string): ResponderResourceSnapshot {
  if (!(item in current.inventory)) throw new SimulationEventError(`Equipment ${item} does not exist for responder ${current.responderId}.`);
  const from = current.equipmentConditions[item] ?? "OPERATIONAL";
  if (!validEquipmentTransition(from, target)) throw new SimulationEventError(`Equipment ${item} cannot transition from ${from} to ${target}.`);
  return freezeResponderResource({ ...current, equipmentConditions: { ...current.equipmentConditions, [item]: target }, history: [...current.history, history(eventId, atMs, "EQUIPMENT_CHANGED", current.fatigue, current.fatigueMode, causeEventId, { item, from, to: target, ...(simulatedCause === undefined ? {} : { cause: simulatedCause }) })] });
}

export function hasEssentialEquipment(current: ResponderResourceSnapshot, config: ValidatedResourceConfig): boolean {
  return Object.entries(config.resourceDefinitions).every(([item, definition]) => !definition.essential || ((current.inventory[item] ?? 0) > 0 && !["UNAVAILABLE", "UNDER_REPAIR"].includes(current.equipmentConditions[item] ?? "OPERATIONAL")));
}

export function createStockpile(definition: StockpileDefinition, eventId: string, atMs: number, causeEventId?: string): StockpileSnapshot {
  return freezeStockpile({ ...definition, registeredAtMs: atMs, history: [{ eventId, ...(causeEventId === undefined ? {} : { causeEventId }), atMs, action: "REGISTERED", quantities: definition.inventory }] });
}

export function validateStockpileDefinition(input: unknown, label = "stockpile"): StockpileDefinition {
  if (!isRecord(input)) throw new SimulationConfigError(`${label} must be an object.`);
  const id = stringValue(input.id, `${label}.id`);
  if (!/^stockpile_[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)) throw new SimulationConfigError(`${label}.id must use the stockpile_ prefix.`);
  const location = validateTravelLocation(input.location, `${label}.location`);
  const inventory = validateInventory(input.inventory, `${label}.inventory`, MAX_STOCKPILE_ITEM_QUANTITY, MAX_STOCKPILE_TOTAL_QUANTITY, true);
  return Object.freeze({ id, location, inventory });
}

export function validateTransferQuantities(input: unknown, maximum: number): Readonly<Record<string, number>> {
  return validateInventory(input, "replenishment.quantities", maximum, maximum, false);
}

export function transferFromStockpile(stockpile: StockpileSnapshot, responder: ResponderResourceSnapshot, quantities: Readonly<Record<string, number>>, eventId: string, atMs: number, causeEventId?: string): { stockpile: StockpileSnapshot; responder: ResponderResourceSnapshot } {
  const source = { ...stockpile.inventory };
  const destination = { ...responder.inventory };
  for (const [item, quantity] of Object.entries(quantities)) {
    if ((source[item] ?? 0) < quantity) throw new SimulationEventError(`Stockpile ${stockpile.id} has insufficient ${item}.`);
    if ((destination[item] ?? 0) + quantity > 10_000) throw new SimulationEventError(`Responder ${responder.responderId} inventory capacity for ${item} would be exceeded.`);
    source[item] = (source[item] ?? 0) - quantity;
    destination[item] = (destination[item] ?? 0) + quantity;
  }
  return {
    stockpile: freezeStockpile({ ...stockpile, inventory: source, history: [...stockpile.history, { eventId, ...(causeEventId === undefined ? {} : { causeEventId }), atMs, action: "TRANSFERRED", quantities }] }),
    responder: freezeResponderResource({ ...appendResourceHistory(responder, eventId, atMs, "REPLENISHED", quantities), inventory: destination }),
  };
}

export function isEquipmentCondition(value: unknown): value is EquipmentCondition { return typeof value === "string" && (EQUIPMENT_CONDITIONS as readonly string[]).includes(value); }
export function freezeResponderResource(value: ResponderResourceSnapshot): ResponderResourceSnapshot { return Object.freeze({ ...value, inventory: Object.freeze({ ...value.inventory }), equipmentConditions: Object.freeze({ ...value.equipmentConditions }), history: Object.freeze(value.history.map((entry) => Object.freeze({ ...entry, ...(entry.details === undefined ? {} : { details: Object.freeze({ ...entry.details }) }) }))) }); }
export function freezeTaskResource(value: TaskResourceSnapshot): TaskResourceSnapshot { return Object.freeze({ ...value, reservedConsumables: Object.freeze({ ...value.reservedConsumables }), reusableEquipment: Object.freeze({ ...value.reusableEquipment }), eventHistoryIds: Object.freeze([...value.eventHistoryIds]) }); }
export function freezeStockpile(value: StockpileSnapshot): StockpileSnapshot { return Object.freeze({ ...value, location: Object.freeze({ ...value.location }), inventory: Object.freeze({ ...value.inventory }), history: Object.freeze(value.history.map((entry) => Object.freeze({ ...entry, quantities: Object.freeze({ ...entry.quantities }) }))) }); }
export function freezeReplenishment(value: ReplenishmentSnapshot): ReplenishmentSnapshot { return Object.freeze({ ...value, quantities: Object.freeze({ ...value.quantities }), eventHistoryIds: Object.freeze([...value.eventHistoryIds]) }); }

function appendResourceHistory(current: ResponderResourceSnapshot, eventId: string, atMs: number, action: ResourceHistoryEntry["action"], details?: Readonly<Record<string, number | string>>): ResponderResourceSnapshot { return freezeResponderResource({ ...current, history: [...current.history, history(eventId, atMs, action, current.fatigue, current.fatigueMode, undefined, details)] }); }
function history(eventId: string, atMs: number, action: ResourceHistoryEntry["action"], fatigue: number, fatigueMode: FatigueMode, causeEventId?: string, details?: Readonly<Record<string, number | string>>): ResourceHistoryEntry { return Object.freeze({ eventId, ...(causeEventId === undefined ? {} : { causeEventId }), atMs, action, fatigue, fatigueMode, ...(details === undefined ? {} : { details: Object.freeze({ ...details }) }) }); }
function validEquipmentTransition(from: EquipmentCondition, to: EquipmentCondition): boolean { if (from === to) return false; return from === "OPERATIONAL" ? to === "DEGRADED" || to === "UNAVAILABLE" : from === "DEGRADED" ? to !== "DEGRADED" : from === "UNAVAILABLE" ? to === "UNDER_REPAIR" : to === "OPERATIONAL" || to === "DEGRADED" || to === "UNAVAILABLE"; }
function validateDefinitions(input: unknown): ValidatedResourceConfig["resourceDefinitions"] { if (input === undefined) return Object.freeze({}); if (!isRecord(input)) throw new SimulationConfigError("resources.resourceDefinitions must be an object."); if (Object.keys(input).length > 100) throw new SimulationConfigError("resources.resourceDefinitions must not exceed 100 items."); const result: Record<string, Readonly<Required<ResourceDefinition>>> = {}; for (const [item, raw] of Object.entries(input)) { if (item.trim().length === 0 || item.length > 64 || !isRecord(raw) || !(RESOURCE_CATEGORIES as readonly unknown[]).includes(raw.category) || typeof raw.consumable !== "boolean" || (raw.essential !== undefined && typeof raw.essential !== "boolean")) throw new SimulationConfigError(`Invalid resource definition for ${item}.`); result[item] = Object.freeze({ category: raw.category as ResourceCategory, consumable: raw.consumable, essential: raw.essential ?? false }); } return Object.freeze(result); }
function validateConditionMap(input: unknown): ValidatedResourceConfig["responderEquipmentConditions"] { if (input === undefined) return Object.freeze({}); if (!isRecord(input)) throw new SimulationConfigError("resources.responderEquipmentConditions must be an object."); const result: Record<string, Readonly<Record<string, EquipmentCondition>>> = {}; for (const [responder, raw] of Object.entries(input)) { if (!isRecord(raw) || Object.keys(raw).length > 100) throw new SimulationConfigError("Responder equipment conditions must be bounded objects."); const items: Record<string, EquipmentCondition> = {}; for (const [item, condition] of Object.entries(raw)) { if (!isEquipmentCondition(condition)) throw new SimulationConfigError(`Invalid equipment condition for ${responder}.${item}.`); items[item] = condition; } result[responder] = Object.freeze(items); } return Object.freeze(result); }
function validateStockpiles(input: unknown, maximum: number): readonly StockpileDefinition[] { if (input === undefined) return Object.freeze([]); if (!Array.isArray(input) || input.length > maximum) throw new SimulationConfigError("resources.initialStockpiles exceeds its configured limit."); const values = input.map((item, index) => validateStockpileDefinition(item, `resources.initialStockpiles[${index}]`)); if (new Set(values.map((item) => item.id)).size !== values.length) throw new SimulationConfigError("Initial stockpile IDs must be unique."); return Object.freeze(values); }
function validateFatigueMap(input: unknown, maximum: number): Readonly<Record<string, number>> { if (input === undefined) return Object.freeze({}); if (!isRecord(input)) throw new SimulationConfigError("resources.responderInitialFatigue must be an object."); const result: Record<string, number> = {}; for (const [key, value] of Object.entries(input)) result[key] = bounded(value, `resources.responderInitialFatigue.${key}`, 0, maximum); return Object.freeze(result); }
function validateInventory(input: unknown, label: string, perItemMaximum: number, totalMaximum: number, allowZero: boolean): Readonly<Record<string, number>> { if (!isRecord(input)) throw new SimulationConfigError(`${label} must be an object.`); const result: Record<string, number> = {}; let total = 0; for (const [item, value] of Object.entries(input)) { if (item.trim().length === 0 || item.length > 64) throw new SimulationConfigError(`${label} contains an invalid item name.`); const quantity = integer(value, `${label}.${item}`, allowZero ? 0 : 1, perItemMaximum); total += quantity; if (total > totalMaximum) throw new SimulationConfigError(`${label} exceeds its total quantity limit.`); result[item] = quantity; } if (!allowZero && Object.keys(result).length === 0) throw new SimulationConfigError(`${label} must contain at least one item.`); return Object.freeze(result); }
function bounded(value: unknown, label: string, minimum: number, maximum: number): number { if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw new SimulationConfigError(`${label} must be between ${minimum} and ${maximum}.`); return value; }
function integer(value: unknown, label: string, minimum: number, maximum: number): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new SimulationConfigError(`${label} must be an integer between ${minimum} and ${maximum}.`); return value; }
function stringValue(value: unknown, label: string): string { if (typeof value !== "string" || value.length === 0 || value.length > 128) throw new SimulationConfigError(`${label} must be a non-empty string no longer than 128 characters.`); return value; }
function clamp(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, value)); }
function round(value: number): number { return Math.round(value * 1_000_000) / 1_000_000; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
