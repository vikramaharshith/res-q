import { SimulationConfigError, SimulationEventError } from "./errors.js";
import {
  RESPONDER_TYPES,
  type ResponderSnapshot,
  type ResponderType,
} from "./responder.js";

export const TASK_STATUSES = [
  "PENDING",
  "ASSIGNED",
  "EN_ROUTE",
  "IN_PROGRESS",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export const TASK_PRIORITIES = ["LOW", "NORMAL", "HIGH", "CRITICAL"] as const;
export const TASK_ASSIGNMENT_ORIGINS = ["SIMULATION_BASELINE"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskAssignmentOrigin = (typeof TASK_ASSIGNMENT_ORIGINS)[number];

export const MAX_TASK_CAPABILITY_COUNT = 64;
export const MAX_TASK_EQUIPMENT_ITEM_TYPES = 100;
export const MAX_TASK_EQUIPMENT_QUANTITY_PER_ITEM = 10_000;
export const MAX_TASK_TOTAL_EQUIPMENT_QUANTITY = 100_000;
export const MAX_TASK_REQUIRED_CREW_CAPACITY = 100;
export const MAX_TASK_ESTIMATED_EFFORT_MS = 30 * 24 * 60 * 60 * 1_000;

const CUSTOM_TASK_ID_PATTERN = /^task_custom_[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

const VALID_TRANSITIONS = Object.freeze({
  PENDING: Object.freeze(["FAILED", "CANCELLED"]),
  ASSIGNED: Object.freeze(["EN_ROUTE", "FAILED", "CANCELLED"]),
  EN_ROUTE: Object.freeze(["IN_PROGRESS", "FAILED", "CANCELLED"]),
  IN_PROGRESS: Object.freeze(["COMPLETED", "FAILED", "CANCELLED"]),
  COMPLETED: Object.freeze([]),
  FAILED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
} as const);

export const ACTIVE_TASK_STATUSES: readonly TaskStatus[] = Object.freeze([
  "ASSIGNED",
  "EN_ROUTE",
  "IN_PROGRESS",
]);

export interface TaskDefinition {
  readonly id?: string;
  readonly relatedIncidentId: string;
  readonly requiredCapabilities: readonly string[];
  readonly requiredEquipment: Readonly<Record<string, number>>;
  readonly requiredCrewCapacity: number;
  readonly eligibleResponderTypes?: readonly ResponderType[];
  readonly priority: TaskPriority;
  readonly estimatedEffortMs: number;
}

export interface ValidatedTaskDefinition {
  readonly id?: string;
  readonly relatedIncidentId: string;
  readonly requiredCapabilities: readonly string[];
  readonly requiredEquipment: Readonly<Record<string, number>>;
  readonly requiredCrewCapacity: number;
  readonly eligibleResponderTypes?: readonly ResponderType[];
  readonly priority: TaskPriority;
  readonly estimatedEffortMs: number;
}

export type TaskHistoryAction =
  | "CREATED"
  | "ASSIGNED"
  | "ASSIGNMENT_SKIPPED"
  | "STATE_TRANSITION";

export interface TaskHistoryEntry {
  readonly eventId: string;
  readonly causeEventId?: string;
  readonly atMs: number;
  readonly action: TaskHistoryAction;
  readonly previousStatus: TaskStatus | null;
  readonly status: TaskStatus;
  readonly responderId?: string;
  readonly assignmentOrigin?: TaskAssignmentOrigin;
}

export interface TaskSnapshot {
  readonly id: string;
  readonly relatedIncidentId: string;
  readonly requiredCapabilities: readonly string[];
  readonly requiredEquipment: Readonly<Record<string, number>>;
  readonly requiredCrewCapacity: number;
  readonly eligibleResponderTypes?: readonly ResponderType[];
  readonly priority: TaskPriority;
  readonly status: TaskStatus;
  readonly assignedResponderId?: string;
  readonly assignmentOrigin?: TaskAssignmentOrigin;
  readonly createdAtMs: number;
  readonly lastUpdatedAtMs: number;
  readonly estimatedEffortMs: number;
  readonly causalEventHistory: readonly TaskHistoryEntry[];
}

export interface TaskCreatedChange {
  readonly kind: "TASK_CREATED";
  readonly taskId: string;
  readonly relatedIncidentId: string;
  readonly status: "PENDING";
}

export interface TaskAssignedChange {
  readonly kind: "TASK_ASSIGNED";
  readonly taskId: string;
  readonly responderId: string;
  readonly previousStatus: "PENDING";
  readonly status: "ASSIGNED";
  readonly origin: "SIMULATION_BASELINE";
  readonly automatic: boolean;
}

export interface TaskAssignmentSkippedChange {
  readonly kind: "TASK_ASSIGNMENT_SKIPPED";
  readonly taskId: string;
  readonly status: "PENDING";
  readonly origin: "SIMULATION_BASELINE";
  readonly reason: "NO_ELIGIBLE_RESPONDER";
}

export interface TaskStateChangedChange {
  readonly kind: "TASK_STATE_CHANGED";
  readonly taskId: string;
  readonly previousStatus: TaskStatus;
  readonly status: TaskStatus;
}

export type TaskChange =
  | TaskCreatedChange
  | TaskAssignedChange
  | TaskAssignmentSkippedChange
  | TaskStateChangedChange;

export function validateTaskDefinition(
  input: unknown,
  label = "task",
): ValidatedTaskDefinition {
  if (!isRecord(input)) {
    throw new SimulationConfigError(`${label} must be an object.`);
  }
  const id = input.id;
  if (id !== undefined && (typeof id !== "string" || !CUSTOM_TASK_ID_PATTERN.test(id))) {
    throw new SimulationConfigError(
      `${label}.id must use the task_custom_ prefix and contain only letters, digits, hyphens, or underscores.`,
    );
  }
  const relatedIncidentId = requireNonEmptyString(
    input.relatedIncidentId,
    `${label}.relatedIncidentId`,
    128,
  );
  const requiredCapabilities = validateCapabilities(
    input.requiredCapabilities,
    `${label}.requiredCapabilities`,
  );
  const requiredEquipment = validateRequiredEquipment(
    input.requiredEquipment,
    `${label}.requiredEquipment`,
  );
  const requiredCrewCapacity = requireSafeInteger(
    input.requiredCrewCapacity,
    `${label}.requiredCrewCapacity`,
  );
  if (
    requiredCrewCapacity < 1 ||
    requiredCrewCapacity > MAX_TASK_REQUIRED_CREW_CAPACITY
  ) {
    throw new SimulationConfigError(
      `${label}.requiredCrewCapacity must be between 1 and ${MAX_TASK_REQUIRED_CREW_CAPACITY}.`,
    );
  }
  const eligibleResponderTypes = validateResponderTypes(
    input.eligibleResponderTypes,
    `${label}.eligibleResponderTypes`,
  );
  if (!isTaskPriority(input.priority)) {
    throw new SimulationConfigError(`${label}.priority is not supported.`);
  }
  const estimatedEffortMs = requireSafeInteger(
    input.estimatedEffortMs,
    `${label}.estimatedEffortMs`,
  );
  if (estimatedEffortMs < 1 || estimatedEffortMs > MAX_TASK_ESTIMATED_EFFORT_MS) {
    throw new SimulationConfigError(
      `${label}.estimatedEffortMs must be between 1 and ${MAX_TASK_ESTIMATED_EFFORT_MS}.`,
    );
  }

  return Object.freeze({
    ...(id === undefined ? {} : { id }),
    relatedIncidentId,
    requiredCapabilities,
    requiredEquipment,
    requiredCrewCapacity,
    ...(eligibleResponderTypes === undefined ? {} : { eligibleResponderTypes }),
    priority: input.priority,
    estimatedEffortMs,
  });
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value);
}

export function isValidTaskTransition(from: TaskStatus, to: TaskStatus): boolean {
  return (VALID_TRANSITIONS[from] as readonly TaskStatus[]).includes(to);
}

export function isActiveTaskStatus(status: TaskStatus): boolean {
  return ACTIVE_TASK_STATUSES.includes(status);
}

export function taskAssignmentEventPriority(priority: TaskPriority): number {
  switch (priority) {
    case "CRITICAL":
      return -30;
    case "HIGH":
      return -20;
    case "NORMAL":
      return -10;
    case "LOW":
      return 0;
  }
}

export function createTask(
  id: string,
  definition: ValidatedTaskDefinition,
  eventId: string,
  timestampMs: number,
  causeEventId?: string,
): { task: TaskSnapshot; change: TaskCreatedChange } {
  const history = historyEntry({
    eventId,
    ...(causeEventId === undefined ? {} : { causeEventId }),
    atMs: timestampMs,
    action: "CREATED",
    previousStatus: null,
    status: "PENDING",
  });
  const task = freezeTaskSnapshot({
    id,
    relatedIncidentId: definition.relatedIncidentId,
    requiredCapabilities: definition.requiredCapabilities,
    requiredEquipment: definition.requiredEquipment,
    requiredCrewCapacity: definition.requiredCrewCapacity,
    ...(definition.eligibleResponderTypes === undefined
      ? {}
      : { eligibleResponderTypes: definition.eligibleResponderTypes }),
    priority: definition.priority,
    status: "PENDING",
    createdAtMs: timestampMs,
    lastUpdatedAtMs: timestampMs,
    estimatedEffortMs: definition.estimatedEffortMs,
    causalEventHistory: [history],
  });
  return {
    task,
    change: Object.freeze({
      kind: "TASK_CREATED",
      taskId: id,
      relatedIncidentId: definition.relatedIncidentId,
      status: "PENDING",
    }),
  };
}

export function assignTask(
  current: TaskSnapshot,
  responderId: string,
  eventId: string,
  timestampMs: number,
  automatic: boolean,
  causeEventId?: string,
): { task: TaskSnapshot; change: TaskAssignedChange } {
  if (current.status !== "PENDING" || current.assignedResponderId !== undefined) {
    throw new SimulationEventError(`Task ${current.id} is not pending assignment.`);
  }
  const history = historyEntry({
    eventId,
    ...(causeEventId === undefined ? {} : { causeEventId }),
    atMs: timestampMs,
    action: "ASSIGNED",
    previousStatus: current.status,
    status: "ASSIGNED",
    responderId,
    assignmentOrigin: "SIMULATION_BASELINE",
  });
  const task = freezeTaskSnapshot({
    ...current,
    status: "ASSIGNED",
    assignedResponderId: responderId,
    assignmentOrigin: "SIMULATION_BASELINE",
    lastUpdatedAtMs: timestampMs,
    causalEventHistory: [...current.causalEventHistory, history],
  });
  return {
    task,
    change: Object.freeze({
      kind: "TASK_ASSIGNED",
      taskId: current.id,
      responderId,
      previousStatus: "PENDING",
      status: "ASSIGNED",
      origin: "SIMULATION_BASELINE",
      automatic,
    }),
  };
}

export function recordSkippedAssignment(
  current: TaskSnapshot,
  eventId: string,
  timestampMs: number,
  causeEventId?: string,
): { task: TaskSnapshot; change: TaskAssignmentSkippedChange } {
  if (current.status !== "PENDING" || current.assignedResponderId !== undefined) {
    throw new SimulationEventError(`Task ${current.id} is not pending assignment.`);
  }
  const history = historyEntry({
    eventId,
    ...(causeEventId === undefined ? {} : { causeEventId }),
    atMs: timestampMs,
    action: "ASSIGNMENT_SKIPPED",
    previousStatus: "PENDING",
    status: "PENDING",
    assignmentOrigin: "SIMULATION_BASELINE",
  });
  return {
    task: freezeTaskSnapshot({
      ...current,
      lastUpdatedAtMs: timestampMs,
      causalEventHistory: [...current.causalEventHistory, history],
    }),
    change: Object.freeze({
      kind: "TASK_ASSIGNMENT_SKIPPED",
      taskId: current.id,
      status: "PENDING",
      origin: "SIMULATION_BASELINE",
      reason: "NO_ELIGIBLE_RESPONDER",
    }),
  };
}

export function transitionTask(
  current: TaskSnapshot,
  targetStatus: TaskStatus,
  eventId: string,
  timestampMs: number,
  causeEventId?: string,
): { task: TaskSnapshot; change: TaskStateChangedChange } {
  if (!isValidTaskTransition(current.status, targetStatus)) {
    throw new SimulationEventError(
      `Task ${current.id} cannot transition from ${current.status} to ${targetStatus}.`,
    );
  }
  if (
    (targetStatus === "EN_ROUTE" || targetStatus === "IN_PROGRESS" || targetStatus === "COMPLETED") &&
    current.assignedResponderId === undefined
  ) {
    throw new SimulationEventError(`Task ${current.id} has no assigned responder.`);
  }
  const history = historyEntry({
    eventId,
    ...(causeEventId === undefined ? {} : { causeEventId }),
    atMs: timestampMs,
    action: "STATE_TRANSITION",
    previousStatus: current.status,
    status: targetStatus,
    ...(current.assignedResponderId === undefined
      ? {}
      : { responderId: current.assignedResponderId }),
    ...(current.assignmentOrigin === undefined
      ? {}
      : { assignmentOrigin: current.assignmentOrigin }),
  });
  return {
    task: freezeTaskSnapshot({
      ...current,
      status: targetStatus,
      lastUpdatedAtMs: timestampMs,
      causalEventHistory: [...current.causalEventHistory, history],
    }),
    change: Object.freeze({
      kind: "TASK_STATE_CHANGED",
      taskId: current.id,
      previousStatus: current.status,
      status: targetStatus,
    }),
  };
}

export function isResponderQualifiedForTask(
  task: Pick<
    TaskSnapshot,
    | "requiredCapabilities"
    | "requiredEquipment"
    | "requiredCrewCapacity"
    | "eligibleResponderTypes"
  >,
  responder: ResponderSnapshot,
  activeAssignedResponderIds: ReadonlySet<string> = new Set<string>(),
): boolean {
  if (responder.availabilityState !== "AVAILABLE") return false;
  if (activeAssignedResponderIds.has(responder.id)) return false;
  if (
    task.eligibleResponderTypes !== undefined &&
    !task.eligibleResponderTypes.includes(responder.responderType)
  ) {
    return false;
  }
  if (responder.crewCapacity < task.requiredCrewCapacity) return false;
  if (
    !task.requiredCapabilities.every((capability) =>
      responder.capabilities.includes(capability),
    )
  ) {
    return false;
  }
  return Object.entries(task.requiredEquipment).every(
    ([item, quantity]) => (responder.equipmentInventory[item] ?? 0) >= quantity,
  );
}

/**
 * Stable baseline policy: best crew fit, then least surplus required equipment,
 * then callsign and ID. It consumes only task requirements and responder telemetry.
 */
export function matchRespondersForTask(
  task: Pick<
    TaskSnapshot,
    | "requiredCapabilities"
    | "requiredEquipment"
    | "requiredCrewCapacity"
    | "eligibleResponderTypes"
  >,
  responders: readonly ResponderSnapshot[],
  activeAssignedResponderIds: ReadonlySet<string> = new Set<string>(),
): readonly ResponderSnapshot[] {
  return Object.freeze(
    responders
      .filter((responder) =>
        isResponderQualifiedForTask(task, responder, activeAssignedResponderIds),
      )
      .sort((left, right) => {
        const crewDifference =
          left.crewCapacity - task.requiredCrewCapacity -
          (right.crewCapacity - task.requiredCrewCapacity);
        if (crewDifference !== 0) return crewDifference;
        const equipmentDifference =
          equipmentSurplus(left, task.requiredEquipment) -
          equipmentSurplus(right, task.requiredEquipment);
        if (equipmentDifference !== 0) return equipmentDifference;
        const callsignDifference = compareText(left.callsign, right.callsign);
        if (callsignDifference !== 0) return callsignDifference;
        return compareText(left.id, right.id);
      }),
  );
}

export function freezeTaskSnapshot(task: TaskSnapshot): TaskSnapshot {
  return Object.freeze({
    ...task,
    requiredCapabilities: Object.freeze([...task.requiredCapabilities]),
    requiredEquipment: Object.freeze({ ...task.requiredEquipment }),
    ...(task.eligibleResponderTypes === undefined
      ? {}
      : { eligibleResponderTypes: Object.freeze([...task.eligibleResponderTypes]) }),
    causalEventHistory: Object.freeze(
      task.causalEventHistory.map((entry) => Object.freeze({ ...entry })),
    ),
  });
}

function historyEntry(input: {
  eventId: string;
  causeEventId?: string;
  atMs: number;
  action: TaskHistoryAction;
  previousStatus: TaskStatus | null;
  status: TaskStatus;
  responderId?: string;
  assignmentOrigin?: TaskAssignmentOrigin;
}): TaskHistoryEntry {
  return Object.freeze({
    eventId: input.eventId,
    ...(input.causeEventId === undefined ? {} : { causeEventId: input.causeEventId }),
    atMs: input.atMs,
    action: input.action,
    previousStatus: input.previousStatus,
    status: input.status,
    ...(input.responderId === undefined ? {} : { responderId: input.responderId }),
    ...(input.assignmentOrigin === undefined
      ? {}
      : { assignmentOrigin: input.assignmentOrigin }),
  });
}

function equipmentSurplus(
  responder: ResponderSnapshot,
  requiredEquipment: Readonly<Record<string, number>>,
): number {
  return Object.entries(requiredEquipment).reduce(
    (sum, [item, quantity]) => sum + (responder.equipmentInventory[item] ?? 0) - quantity,
    0,
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateCapabilities(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new SimulationConfigError(`${label} must be a non-empty array.`);
  }
  if (value.length > MAX_TASK_CAPABILITY_COUNT) {
    throw new SimulationConfigError(
      `${label} must not exceed ${MAX_TASK_CAPABILITY_COUNT} entries.`,
    );
  }
  const capabilities = value.map((item, index) =>
    requireNonEmptyString(item, `${label}[${index}]`, 64),
  );
  if (new Set(capabilities).size !== capabilities.length) {
    throw new SimulationConfigError(`${label} must not contain duplicates.`);
  }
  return Object.freeze(capabilities);
}

function validateRequiredEquipment(
  value: unknown,
  label: string,
): Readonly<Record<string, number>> {
  if (!isRecord(value)) {
    throw new SimulationConfigError(`${label} must be an object.`);
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_TASK_EQUIPMENT_ITEM_TYPES) {
    throw new SimulationConfigError(
      `${label} must not exceed ${MAX_TASK_EQUIPMENT_ITEM_TYPES} item types.`,
    );
  }
  let total = 0;
  const equipment: Record<string, number> = {};
  for (const [item, rawQuantity] of entries) {
    if (item.trim().length === 0 || item.length > 64) {
      throw new SimulationConfigError(`${label} item names must contain 1 to 64 characters.`);
    }
    const quantity = requireSafeInteger(rawQuantity, `${label}.${item}`);
    if (quantity < 1 || quantity > MAX_TASK_EQUIPMENT_QUANTITY_PER_ITEM) {
      throw new SimulationConfigError(
        `${label}.${item} must be between 1 and ${MAX_TASK_EQUIPMENT_QUANTITY_PER_ITEM}.`,
      );
    }
    total += quantity;
    if (total > MAX_TASK_TOTAL_EQUIPMENT_QUANTITY) {
      throw new SimulationConfigError(
        `${label} total quantity must not exceed ${MAX_TASK_TOTAL_EQUIPMENT_QUANTITY}.`,
      );
    }
    equipment[item] = quantity;
  }
  return Object.freeze(equipment);
}

function validateResponderTypes(
  value: unknown,
  label: string,
): readonly ResponderType[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new SimulationConfigError(`${label} must be a non-empty array when provided.`);
  }
  const values: ResponderType[] = value.map((item) => {
    if (typeof item !== "string" || !(RESPONDER_TYPES as readonly string[]).includes(item)) {
      throw new SimulationConfigError(`${label} contains an unsupported responder type.`);
    }
    return item as ResponderType;
  });
  if (new Set(values).size !== values.length) {
    throw new SimulationConfigError(`${label} must not contain duplicates.`);
  }
  return Object.freeze(values);
}

function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === "string" && (TASK_PRIORITIES as readonly string[]).includes(value);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
