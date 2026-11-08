import { SeededRng } from "../core/random.js";
import { SimulationConfigError, SimulationEventError } from "./errors.js";
import type { ResponderAvailabilityState, ResponderSnapshot } from "./responder.js";
import type { TaskStatus } from "./task.js";
import type { EquipmentCondition } from "./resources.js";
import {
  validateTravelLocation,
  type FictionalTravelLocation,
  type TravelStatus,
} from "./travel.js";

export const COMMUNICATION_STATES = [
  "CONNECTED",
  "DEGRADED",
  "INTERMITTENT",
  "OFFLINE",
  "RECOVERING",
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

export type CommunicationState = (typeof COMMUNICATION_STATES)[number];
export type OperationalMessageType = (typeof OPERATIONAL_MESSAGE_TYPES)[number];
export type OperationalMessageSource = "RESPONDER_UNIT" | "SIMULATION_SYSTEM";
export type OperationalDeliveryStatus = "PENDING" | "DELIVERED" | "FAILED";

export const MAX_COMMUNICATION_RETRIES = 10;
export const MAX_PENDING_OPERATIONAL_MESSAGES = 100_000;
export const MAX_COMMUNICATION_DELAY_MS = 7 * 24 * 60 * 60 * 1_000;
export const MAX_TOTAL_COMMUNICATION_EVENTS = 500_000;

export interface CommunicationInfrastructureLinkConfig {
  readonly communicationTowerEffect?: "NONE" | "GLOBAL" | "RESPONDER_IDS" | "RADIUS";
  readonly responderIds?: readonly string[];
  readonly center?: FictionalTravelLocation;
  readonly radiusUnits?: number;
  readonly electricalAffectsLinkedResponders?: boolean;
}

export interface CommunicationConfig {
  readonly enabled?: boolean;
  readonly initialState?: CommunicationState;
  readonly responderInitialStates?: Readonly<Record<string, CommunicationState>>;
  readonly normalDelayMs?: number;
  readonly degradedAdditionalDelayMs?: number;
  readonly intermittentAdditionalDelayMs?: number;
  readonly retryIntervalMs?: number;
  readonly deterministicJitterMs?: number;
  readonly intermittentDeliveryProbability?: number;
  readonly maxRetriesPerMessage?: number;
  readonly maxPendingMessages?: number;
  readonly maxDeliveryDelayMs?: number;
  readonly maxCommunicationEvents?: number;
  readonly permanentlyFailedMessageTypes?: readonly OperationalMessageType[];
  readonly infrastructureLink?: CommunicationInfrastructureLinkConfig;
}

export interface ValidatedCommunicationConfig {
  readonly enabled: boolean;
  readonly initialState: CommunicationState;
  readonly responderInitialStates: Readonly<Record<string, CommunicationState>>;
  readonly normalDelayMs: number;
  readonly degradedAdditionalDelayMs: number;
  readonly intermittentAdditionalDelayMs: number;
  readonly retryIntervalMs: number;
  readonly deterministicJitterMs: number;
  readonly intermittentDeliveryProbability: number;
  readonly maxRetriesPerMessage: number;
  readonly maxPendingMessages: number;
  readonly maxDeliveryDelayMs: number;
  readonly maxCommunicationEvents: number;
  readonly permanentlyFailedMessageTypes: readonly OperationalMessageType[];
  readonly infrastructureLink: Readonly<{
    communicationTowerEffect: "NONE" | "GLOBAL" | "RESPONDER_IDS" | "RADIUS";
    responderIds: readonly string[];
    center?: FictionalTravelLocation;
    radiusUnits: number;
    electricalAffectsLinkedResponders: boolean;
  }>;
}

export interface CommunicationStateHistoryEntry {
  readonly eventId: string;
  readonly causeEventId?: string;
  readonly atMs: number;
  readonly previousState: CommunicationState | null;
  readonly state: CommunicationState;
}

export interface ResponderCommunicationSnapshot {
  readonly responderId: string;
  readonly state: CommunicationState;
  readonly lastUpdatedAtMs: number;
  readonly eventHistory: readonly CommunicationStateHistoryEntry[];
}

export interface OperationalMessageContent {
  readonly availabilityState?: ResponderAvailabilityState;
  readonly taskStatus?: TaskStatus;
  readonly travelStatus?: TravelStatus;
  readonly communicationState?: CommunicationState;
  readonly location?: FictionalTravelLocation;
  readonly routeVersion?: number;
  readonly fatigue?: number;
  readonly equipmentItem?: string;
  readonly equipmentCondition?: EquipmentCondition;
  readonly inventory?: Readonly<Record<string, number>>;
}

export interface OperationalMessageRequest {
  readonly responderId: string;
  readonly relatedTaskId?: string;
  readonly messageType: OperationalMessageType;
  readonly observedAtMs: number;
  readonly submittedAtMs?: number;
  readonly source?: OperationalMessageSource;
  readonly content: OperationalMessageContent;
}

export interface OperationalMessageSnapshot {
  readonly id: string;
  readonly responderId: string;
  readonly relatedTaskId?: string;
  readonly messageType: OperationalMessageType;
  readonly observedAtMs: number;
  readonly submittedAtMs: number;
  readonly receivedAtMs?: number;
  readonly source: OperationalMessageSource;
  readonly content: OperationalMessageContent;
  readonly deliveryStatus: OperationalDeliveryStatus;
  readonly attemptCount: number;
  readonly lastAttemptAtMs?: number;
  readonly failureReason?: "PERMANENTLY_CONFIGURED" | "RETRY_LIMIT" | "MAXIMUM_DELAY";
  readonly causeEventId?: string;
}

export interface PublicOperationalObservation {
  readonly messageId: string;
  readonly responderId: string;
  readonly relatedTaskId?: string;
  readonly messageType: OperationalMessageType;
  readonly observedAtMs: number;
  readonly submittedAtMs: number;
  readonly receivedAtMs: number;
  readonly source: OperationalMessageSource;
  readonly content: OperationalMessageContent;
  readonly deliveryStatus: "DELIVERED";
}

export interface CommandCenterKnowledge {
  readonly responderId: string;
  readonly latestObservedAtMs: number;
  readonly latestMessageId: string;
  readonly latestReceivedAtMs: number;
  readonly availabilityState?: ResponderAvailabilityState;
  readonly taskId?: string;
  readonly taskStatus?: TaskStatus;
  readonly travelStatus?: TravelStatus;
  readonly communicationState?: CommunicationState;
  readonly location?: FictionalTravelLocation;
  readonly routeVersion?: number;
  readonly fatigue?: number;
  readonly equipmentConditions?: Readonly<Record<string, EquipmentCondition>>;
  readonly inventory?: Readonly<Record<string, number>>;
}

export interface CommunicationStateChangedChange {
  readonly kind: "COMMUNICATION_STATE_CHANGED";
  readonly responderId: string;
  readonly previousState: CommunicationState;
  readonly state: CommunicationState;
}

export interface OperationalMessageChange {
  readonly kind:
    | "OPERATIONAL_MESSAGE_CREATED"
    | "OPERATIONAL_MESSAGE_DELIVERED"
    | "OPERATIONAL_MESSAGE_RETRY_SCHEDULED"
    | "OPERATIONAL_MESSAGE_FAILED"
    | "OPERATIONAL_MESSAGE_EVENT_IGNORED";
  readonly messageId: string;
  readonly responderId: string;
  readonly deliveryStatus: OperationalDeliveryStatus;
  readonly attemptCount: number;
  readonly reason?: string;
}

const VALID_TRANSITIONS = Object.freeze({
  CONNECTED: Object.freeze(["DEGRADED", "INTERMITTENT", "OFFLINE"]),
  DEGRADED: Object.freeze(["CONNECTED", "INTERMITTENT", "OFFLINE", "RECOVERING"]),
  INTERMITTENT: Object.freeze(["CONNECTED", "DEGRADED", "OFFLINE", "RECOVERING"]),
  OFFLINE: Object.freeze(["RECOVERING"]),
  RECOVERING: Object.freeze(["CONNECTED", "DEGRADED", "INTERMITTENT", "OFFLINE"]),
} as const);

export function validateCommunicationConfig(input: unknown): ValidatedCommunicationConfig {
  if (input === undefined) input = {};
  if (!isRecord(input)) throw new SimulationConfigError("communication must be an object.");
  const enabled = input.enabled ?? false;
  if (typeof enabled !== "boolean") throw new SimulationConfigError("communication.enabled must be a boolean.");
  const initialState = input.initialState ?? "CONNECTED";
  if (!isCommunicationState(initialState)) throw new SimulationConfigError("communication.initialState is unsupported.");
  const responderInitialStates = validateStateMap(input.responderInitialStates);
  const normalDelayMs = boundedInteger(input.normalDelayMs ?? 100, "communication.normalDelayMs", 0, MAX_COMMUNICATION_DELAY_MS);
  const degradedAdditionalDelayMs = boundedInteger(input.degradedAdditionalDelayMs ?? 2_000, "communication.degradedAdditionalDelayMs", 0, MAX_COMMUNICATION_DELAY_MS);
  const intermittentAdditionalDelayMs = boundedInteger(input.intermittentAdditionalDelayMs ?? 5_000, "communication.intermittentAdditionalDelayMs", 0, MAX_COMMUNICATION_DELAY_MS);
  const retryIntervalMs = boundedInteger(input.retryIntervalMs ?? 5_000, "communication.retryIntervalMs", 1, MAX_COMMUNICATION_DELAY_MS);
  const deterministicJitterMs = boundedInteger(input.deterministicJitterMs ?? 0, "communication.deterministicJitterMs", 0, MAX_COMMUNICATION_DELAY_MS);
  const probability = finiteProbability(input.intermittentDeliveryProbability ?? 0.5, "communication.intermittentDeliveryProbability");
  const maxRetriesPerMessage = boundedInteger(input.maxRetriesPerMessage ?? 3, "communication.maxRetriesPerMessage", 0, MAX_COMMUNICATION_RETRIES);
  const maxPendingMessages = boundedInteger(input.maxPendingMessages ?? 10_000, "communication.maxPendingMessages", 1, MAX_PENDING_OPERATIONAL_MESSAGES);
  const maxDeliveryDelayMs = boundedInteger(input.maxDeliveryDelayMs ?? 24 * 60 * 60 * 1_000, "communication.maxDeliveryDelayMs", 1, MAX_COMMUNICATION_DELAY_MS);
  const maxCommunicationEvents = boundedInteger(input.maxCommunicationEvents ?? 100_000, "communication.maxCommunicationEvents", 1, MAX_TOTAL_COMMUNICATION_EVENTS);
  const permanentlyFailedMessageTypes = validateMessageTypes(input.permanentlyFailedMessageTypes);
  const infrastructureLink = validateInfrastructureLink(input.infrastructureLink);
  return Object.freeze({ enabled, initialState, responderInitialStates, normalDelayMs, degradedAdditionalDelayMs, intermittentAdditionalDelayMs, retryIntervalMs, deterministicJitterMs, intermittentDeliveryProbability: probability, maxRetriesPerMessage, maxPendingMessages, maxDeliveryDelayMs, maxCommunicationEvents, permanentlyFailedMessageTypes, infrastructureLink });
}

export function initialCommunicationState(
  responder: ResponderSnapshot,
  config: ValidatedCommunicationConfig,
  eventId: string,
  atMs: number,
): ResponderCommunicationSnapshot {
  const state = config.responderInitialStates[responder.id] ?? config.responderInitialStates[responder.callsign] ?? config.initialState;
  return freezeCommunicationState({ responderId: responder.id, state, lastUpdatedAtMs: atMs, eventHistory: [Object.freeze({ eventId, atMs, previousState: null, state })] });
}

export function isValidCommunicationTransition(from: CommunicationState, to: CommunicationState): boolean {
  return (VALID_TRANSITIONS[from] as readonly CommunicationState[]).includes(to);
}

export function communicationTransitionPath(from: CommunicationState, to: CommunicationState): readonly CommunicationState[] {
  if (from === to) return Object.freeze([]);
  const queue: Array<{ state: CommunicationState; path: CommunicationState[] }> = [{ state: from, path: [] }];
  const visited = new Set<CommunicationState>([from]);
  while (queue.length > 0) {
    const item = queue.shift()!;
    for (const next of VALID_TRANSITIONS[item.state] as readonly CommunicationState[]) {
      if (visited.has(next)) continue;
      const path = [...item.path, next];
      if (next === to) return Object.freeze(path);
      visited.add(next);
      queue.push({ state: next, path });
    }
  }
  throw new SimulationEventError(`No communication transition path exists from ${from} to ${to}.`);
}

export function transitionCommunicationState(
  current: ResponderCommunicationSnapshot,
  target: CommunicationState,
  eventId: string,
  atMs: number,
  causeEventId?: string,
): { communication: ResponderCommunicationSnapshot; change: CommunicationStateChangedChange } {
  if (!isValidCommunicationTransition(current.state, target)) throw new SimulationEventError(`Communication for responder ${current.responderId} cannot transition from ${current.state} to ${target}.`);
  const entry = Object.freeze({ eventId, ...(causeEventId === undefined ? {} : { causeEventId }), atMs, previousState: current.state, state: target });
  return {
    communication: freezeCommunicationState({ ...current, state: target, lastUpdatedAtMs: atMs, eventHistory: [...current.eventHistory, entry] }),
    change: Object.freeze({ kind: "COMMUNICATION_STATE_CHANGED", responderId: current.responderId, previousState: current.state, state: target }),
  };
}

export function validateOperationalMessageRequest(input: unknown): OperationalMessageRequest {
  if (!isRecord(input)) throw new SimulationConfigError("Operational message request must be an object.");
  const responderId = requireString(input.responderId, "message.responderId");
  const relatedTaskId = input.relatedTaskId === undefined ? undefined : requireString(input.relatedTaskId, "message.relatedTaskId");
  if (!isOperationalMessageType(input.messageType)) throw new SimulationConfigError("message.messageType is unsupported.");
  const observedAtMs = safeInteger(input.observedAtMs, "message.observedAtMs");
  const submittedAtMs = input.submittedAtMs === undefined ? observedAtMs : safeInteger(input.submittedAtMs, "message.submittedAtMs");
  if (submittedAtMs < observedAtMs) throw new SimulationConfigError("Message submission cannot precede observation.");
  const source = input.source ?? "RESPONDER_UNIT";
  if (source !== "RESPONDER_UNIT" && source !== "SIMULATION_SYSTEM") throw new SimulationConfigError("message.source is unsupported.");
  const content = validateOperationalContent(input.content);
  return Object.freeze({ responderId, ...(relatedTaskId === undefined ? {} : { relatedTaskId }), messageType: input.messageType, observedAtMs, submittedAtMs, source, content });
}

export function createOperationalMessage(
  id: string,
  request: OperationalMessageRequest,
  causeEventId?: string,
): OperationalMessageSnapshot {
  return freezeOperationalMessage({ id, responderId: request.responderId, ...(request.relatedTaskId === undefined ? {} : { relatedTaskId: request.relatedTaskId }), messageType: request.messageType, observedAtMs: request.observedAtMs, submittedAtMs: request.submittedAtMs ?? request.observedAtMs, source: request.source ?? "RESPONDER_UNIT", content: request.content, deliveryStatus: "PENDING", attemptCount: 0, ...(causeEventId === undefined ? {} : { causeEventId }) });
}

export class CommunicationDeliveryPlanner {
  readonly #seed: string;
  public constructor(seed: string) { this.#seed = seed; }

  public delayMs(messageId: string, attempt: number, state: CommunicationState, config: ValidatedCommunicationConfig): number {
    const stream = new SeededRng(`${this.#seed}\u0000communication\u0000${messageId}`).stream(`attempt:${attempt}:delay`);
    const jitter = config.deterministicJitterMs === 0 ? 0 : stream.nextInt(0, config.deterministicJitterMs + 1);
    const additional = state === "DEGRADED" ? config.degradedAdditionalDelayMs : state === "INTERMITTENT" ? config.intermittentAdditionalDelayMs : 0;
    return config.normalDelayMs + additional + jitter;
  }

  public intermittentSucceeds(messageId: string, attempt: number, config: ValidatedCommunicationConfig): boolean {
    return new SeededRng(`${this.#seed}\u0000communication\u0000${messageId}`).stream(`attempt:${attempt}:delivery`).nextFloat() < config.intermittentDeliveryProbability;
  }
}

export function recordDeliveryAttempt(message: OperationalMessageSnapshot, atMs: number): OperationalMessageSnapshot {
  return freezeOperationalMessage({ ...message, attemptCount: message.attemptCount + 1, lastAttemptAtMs: atMs });
}

export function deliverOperationalMessage(message: OperationalMessageSnapshot, receivedAtMs: number): OperationalMessageSnapshot {
  if (receivedAtMs < message.submittedAtMs) throw new SimulationEventError("Message receipt cannot precede submission.");
  return freezeOperationalMessage({ ...message, receivedAtMs, deliveryStatus: "DELIVERED" });
}

export function failOperationalMessage(message: OperationalMessageSnapshot, reason: NonNullable<OperationalMessageSnapshot["failureReason"]>): OperationalMessageSnapshot {
  return freezeOperationalMessage({ ...message, deliveryStatus: "FAILED", failureReason: reason });
}

export function projectPublicOperationalObservation(message: OperationalMessageSnapshot): PublicOperationalObservation {
  if (message.deliveryStatus !== "DELIVERED" || message.receivedAtMs === undefined) throw new SimulationEventError("Only delivered messages can be projected.");
  return Object.freeze({ messageId: message.id, responderId: message.responderId, ...(message.relatedTaskId === undefined ? {} : { relatedTaskId: message.relatedTaskId }), messageType: message.messageType, observedAtMs: message.observedAtMs, submittedAtMs: message.submittedAtMs, receivedAtMs: message.receivedAtMs, source: message.source, content: freezeContent(message.content), deliveryStatus: "DELIVERED" });
}

export function updateCommandCenterKnowledge(current: CommandCenterKnowledge | undefined, observation: PublicOperationalObservation): CommandCenterKnowledge {
  const newer = current === undefined || observation.observedAtMs > current.latestObservedAtMs || (observation.observedAtMs === current.latestObservedAtMs && compareText(observation.messageId, current.latestMessageId) > 0);
  if (!newer) return freezeKnowledge(current!);
  const equipmentConditions = observation.content.equipmentItem === undefined || observation.content.equipmentCondition === undefined ? current?.equipmentConditions : Object.freeze({ ...(current?.equipmentConditions ?? {}), [observation.content.equipmentItem]: observation.content.equipmentCondition });
  return freezeKnowledge({ ...(current ?? {}), responderId: observation.responderId, latestObservedAtMs: observation.observedAtMs, latestMessageId: observation.messageId, latestReceivedAtMs: observation.receivedAtMs, ...(observation.content.availabilityState === undefined ? {} : { availabilityState: observation.content.availabilityState }), ...(observation.relatedTaskId === undefined ? {} : { taskId: observation.relatedTaskId }), ...(observation.content.taskStatus === undefined ? {} : { taskStatus: observation.content.taskStatus }), ...(observation.content.travelStatus === undefined ? {} : { travelStatus: observation.content.travelStatus }), ...(observation.content.communicationState === undefined ? {} : { communicationState: observation.content.communicationState }), ...(observation.content.location === undefined ? {} : { location: observation.content.location }), ...(observation.content.routeVersion === undefined ? {} : { routeVersion: observation.content.routeVersion }), ...(observation.content.fatigue === undefined ? {} : { fatigue: observation.content.fatigue }), ...(equipmentConditions === undefined ? {} : { equipmentConditions }), ...(observation.content.inventory === undefined ? {} : { inventory: observation.content.inventory }) });
}

export function communicationInfrastructureApplies(responder: ResponderSnapshot, config: ValidatedCommunicationConfig): boolean {
  const link = config.infrastructureLink;
  if (link.communicationTowerEffect === "NONE") return false;
  if (link.communicationTowerEffect === "GLOBAL") return true;
  if (link.communicationTowerEffect === "RESPONDER_IDS") return link.responderIds.includes(responder.id) || link.responderIds.includes(responder.callsign);
  if (link.center === undefined) return false;
  return Math.hypot(responder.location.x - link.center.x, responder.location.y - link.center.y) <= link.radiusUnits;
}

export function infrastructureCommunicationState(status: "OPERATIONAL" | "DEGRADED" | "OFFLINE" | "RECOVERING"): CommunicationState {
  return status === "OPERATIONAL" ? "CONNECTED" : status === "DEGRADED" ? "DEGRADED" : status === "OFFLINE" ? "OFFLINE" : "RECOVERING";
}

export function isCommunicationState(value: unknown): value is CommunicationState { return typeof value === "string" && (COMMUNICATION_STATES as readonly string[]).includes(value); }
export function isOperationalMessageType(value: unknown): value is OperationalMessageType { return typeof value === "string" && (OPERATIONAL_MESSAGE_TYPES as readonly string[]).includes(value); }
export function freezeCommunicationState(value: ResponderCommunicationSnapshot): ResponderCommunicationSnapshot { return Object.freeze({ ...value, eventHistory: Object.freeze(value.eventHistory.map((entry) => Object.freeze({ ...entry }))) }); }
export function freezeOperationalMessage(value: OperationalMessageSnapshot): OperationalMessageSnapshot { return Object.freeze({ ...value, content: freezeContent(value.content) }); }

function validateOperationalContent(input: unknown): OperationalMessageContent {
  if (!isRecord(input)) throw new SimulationConfigError("message.content must be an object.");
  const allowed = new Set(["availabilityState", "taskStatus", "travelStatus", "communicationState", "location", "routeVersion", "fatigue", "equipmentItem", "equipmentCondition", "inventory"]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new SimulationConfigError(`message.content.${key} is not allowed.`);
  const availabilityState = input.availabilityState;
  if (availabilityState !== undefined && !["AVAILABLE", "RESERVED", "EN_ROUTE", "ON_SCENE", "BUSY", "RECOVERING", "OFFLINE"].includes(String(availabilityState))) throw new SimulationConfigError("message.content.availabilityState is unsupported.");
  const taskStatus = input.taskStatus;
  if (taskStatus !== undefined && !["PENDING", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED", "FAILED", "CANCELLED"].includes(String(taskStatus))) throw new SimulationConfigError("message.content.taskStatus is unsupported.");
  const travelStatus = input.travelStatus;
  if (travelStatus !== undefined && !["EN_ROUTE", "ARRIVED", "BLOCKED", "INTERRUPTED", "CANCELLED"].includes(String(travelStatus))) throw new SimulationConfigError("message.content.travelStatus is unsupported.");
  const communicationState = input.communicationState;
  if (communicationState !== undefined && !isCommunicationState(communicationState)) throw new SimulationConfigError("message.content.communicationState is unsupported.");
  const routeVersion = input.routeVersion;
  if (routeVersion !== undefined && (typeof routeVersion !== "number" || !Number.isSafeInteger(routeVersion) || routeVersion < 1)) throw new SimulationConfigError("message.content.routeVersion must be positive.");
  const messageLocation = input.location === undefined ? undefined : validateTravelLocation(input.location, "message.content.location");
  const fatigue = input.fatigue;
  if (fatigue !== undefined && (typeof fatigue !== "number" || !Number.isFinite(fatigue) || fatigue < 0 || fatigue > 100)) throw new SimulationConfigError("message.content.fatigue is invalid.");
  const equipmentItem = input.equipmentItem === undefined ? undefined : requireString(input.equipmentItem, "message.content.equipmentItem");
  const equipmentCondition = input.equipmentCondition;
  if (equipmentCondition !== undefined && !["OPERATIONAL", "DEGRADED", "UNAVAILABLE", "UNDER_REPAIR"].includes(String(equipmentCondition))) throw new SimulationConfigError("message.content.equipmentCondition is invalid.");
  if ((equipmentItem === undefined) !== (equipmentCondition === undefined)) throw new SimulationConfigError("Equipment item and condition must be provided together.");
  const inventory = input.inventory === undefined ? undefined : validatePublicInventory(input.inventory);
  return freezeContent({ ...(availabilityState === undefined ? {} : { availabilityState: availabilityState as ResponderAvailabilityState }), ...(taskStatus === undefined ? {} : { taskStatus: taskStatus as TaskStatus }), ...(travelStatus === undefined ? {} : { travelStatus: travelStatus as TravelStatus }), ...(communicationState === undefined ? {} : { communicationState }), ...(messageLocation === undefined ? {} : { location: messageLocation }), ...(routeVersion === undefined ? {} : { routeVersion }), ...(fatigue === undefined ? {} : { fatigue }), ...(equipmentItem === undefined ? {} : { equipmentItem, equipmentCondition: equipmentCondition as EquipmentCondition }), ...(inventory === undefined ? {} : { inventory }) });
}

function freezeContent(value: OperationalMessageContent): OperationalMessageContent { return Object.freeze({ ...value, ...(value.location === undefined ? {} : { location: Object.freeze({ ...value.location }) }), ...(value.inventory === undefined ? {} : { inventory: Object.freeze({ ...value.inventory }) }) }); }
function freezeKnowledge(value: CommandCenterKnowledge): CommandCenterKnowledge { return Object.freeze({ ...value, ...(value.location === undefined ? {} : { location: Object.freeze({ ...value.location }) }), ...(value.equipmentConditions === undefined ? {} : { equipmentConditions: Object.freeze({ ...value.equipmentConditions }) }), ...(value.inventory === undefined ? {} : { inventory: Object.freeze({ ...value.inventory }) }) }); }
function validatePublicInventory(value: unknown): Readonly<Record<string, number>> { if (!isRecord(value)) throw new SimulationConfigError("message.content.inventory must be an object."); const result: Record<string, number> = {}; for (const [item, quantity] of Object.entries(value)) { if (item.length === 0 || item.length > 64 || typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 0 || quantity > 10_000) throw new SimulationConfigError("message.content.inventory contains an invalid entry."); result[item] = quantity; } return Object.freeze(result); }
function validateStateMap(input: unknown): Readonly<Record<string, CommunicationState>> { if (input === undefined) return Object.freeze({}); if (!isRecord(input)) throw new SimulationConfigError("communication.responderInitialStates must be an object."); const output: Record<string, CommunicationState> = {}; for (const [key, value] of Object.entries(input)) { if (key.length === 0 || !isCommunicationState(value)) throw new SimulationConfigError("communication.responderInitialStates contains an invalid entry."); output[key] = value; } return Object.freeze(output); }
function validateMessageTypes(input: unknown): readonly OperationalMessageType[] { if (input === undefined) return Object.freeze([]); if (!Array.isArray(input)) throw new SimulationConfigError("communication.permanentlyFailedMessageTypes must be an array."); const result = input.map((item) => { if (!isOperationalMessageType(item)) throw new SimulationConfigError("communication.permanentlyFailedMessageTypes contains an unsupported type."); return item; }); if (new Set(result).size !== result.length) throw new SimulationConfigError("communication.permanentlyFailedMessageTypes must be unique."); return Object.freeze(result); }
function validateInfrastructureLink(input: unknown): ValidatedCommunicationConfig["infrastructureLink"] { if (input === undefined) return Object.freeze({ communicationTowerEffect: "NONE", responderIds: Object.freeze([]), radiusUnits: 0, electricalAffectsLinkedResponders: false }); if (!isRecord(input)) throw new SimulationConfigError("communication.infrastructureLink must be an object."); const effect = input.communicationTowerEffect ?? "NONE"; if (!["NONE", "GLOBAL", "RESPONDER_IDS", "RADIUS"].includes(String(effect))) throw new SimulationConfigError("communication.infrastructureLink.communicationTowerEffect is unsupported."); const ids = input.responderIds ?? []; if (!Array.isArray(ids) || ids.some((item) => typeof item !== "string" || item.length === 0)) throw new SimulationConfigError("communication.infrastructureLink.responderIds must be strings."); const center = input.center === undefined ? undefined : validateTravelLocation(input.center, "communication.infrastructureLink.center"); const radiusUnits = boundedNumber(input.radiusUnits ?? 0, "communication.infrastructureLink.radiusUnits", 0, 2_000_000); const electrical = input.electricalAffectsLinkedResponders ?? false; if (typeof electrical !== "boolean") throw new SimulationConfigError("communication.infrastructureLink.electricalAffectsLinkedResponders must be a boolean."); if (effect === "RADIUS" && center === undefined) throw new SimulationConfigError("RADIUS communication infrastructure effects require a center."); return Object.freeze({ communicationTowerEffect: effect as "NONE" | "GLOBAL" | "RESPONDER_IDS" | "RADIUS", responderIds: Object.freeze([...ids] as string[]), ...(center === undefined ? {} : { center }), radiusUnits, electricalAffectsLinkedResponders: electrical }); }
function boundedInteger(value: unknown, label: string, min: number, max: number): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new SimulationConfigError(`${label} must be an integer from ${min} to ${max}.`); return value; }
function boundedNumber(value: unknown, label: string, min: number, max: number): number { if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new SimulationConfigError(`${label} must be from ${min} to ${max}.`); return value; }
function finiteProbability(value: unknown, label: string): number { if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new SimulationConfigError(`${label} must be from 0 to 1.`); return value; }
function safeInteger(value: unknown, label: string): number { if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new SimulationConfigError(`${label} must be a safe integer.`); return value; }
function requireString(value: unknown, label: string): string { if (typeof value !== "string" || value.length === 0 || value.length > 128) throw new SimulationConfigError(`${label} must be a non-empty string no longer than 128 characters.`); return value; }
function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
