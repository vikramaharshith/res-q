import type { DisasterType } from "../evolution/evolution.js";
import type { InformationNoiseConfig } from "../reporting/noise.js";
import type { ReportCategory } from "../reporting/types.js";
import type { SimulationConfig } from "./config.js";
import type { InitialResponderDefinition, ResponderType } from "./responder.js";
import { SimulationEngine } from "./simulation-engine.js";
import type { TaskDefinition, TaskStatus } from "./task.js";

export const INTEGRATION_DIFFICULTIES = ["CALM", "BUSY", "CHAOS", "EXTREME"] as const;
export type IntegrationDifficulty = (typeof INTEGRATION_DIFFICULTIES)[number];

export interface ResponderIntegrationPreset {
  readonly difficulty: IntegrationDifficulty;
  readonly responderCount: number;
  readonly baseReportCount: number;
  readonly operationalTaskCount: number;
  readonly shortageTaskCount: number;
  readonly config: SimulationConfig;
}

export interface ResponderIntegrationMetrics {
  readonly difficulty: IntegrationDifficulty;
  readonly executionDurationMs: number;
  readonly virtualDurationMs: number;
  readonly baseReportCount: number;
  readonly finalReportCount: number;
  readonly incidentCount: number;
  readonly responderCount: number;
  readonly totalTaskCount: number;
  readonly assignedTasks: number;
  readonly completedTasks: number;
  readonly failedTasks: number;
  readonly pendingTasks: number;
  readonly averageSimulatedResponseDelayMs: number;
  readonly communicationMessagesDelayed: number;
  readonly communicationMessagesFailed: number;
  readonly resourceShortages: number;
  readonly cascadingEvents: number;
  readonly peakEventQueueSize: number;
  readonly totalProcessedEvents: number;
}

export interface ResponderIntegrationRun {
  readonly engine: SimulationEngine;
  readonly metrics: ResponderIntegrationMetrics;
  readonly canonicalState: string;
  readonly publicAuditViolations: readonly string[];
  readonly invariantViolations: readonly string[];
}

interface ResponseProfile {
  readonly type: ResponderType;
  readonly prefix: string;
  readonly capability: string;
  readonly equipment: string;
  readonly category: ReportCategory;
  readonly incidentIndex: number;
}

const START_TIME_MS = 1_000_000;
const PROFILES: readonly ResponseProfile[] = Object.freeze([
  { type: "AMBULANCE", prefix: "MED", capability: "EMERGENCY_MEDICAL_CARE", equipment: "medical_kit", category: "MEDICAL_ASSISTANCE", incidentIndex: 1 },
  { type: "FIRE_ENGINE", prefix: "FIRE", capability: "FIRE_SUPPRESSION", equipment: "fire_retardant", category: "STRUCTURE_FIRE", incidentIndex: 3 },
  { type: "WATER_RESCUE", prefix: "WATER", capability: "WATER_RESCUE", equipment: "rescue_rope", category: "WATER_RESCUE", incidentIndex: 0 },
  { type: "SEARCH_AND_RESCUE", prefix: "SAR", capability: "SEARCH_AND_RESCUE", equipment: "rescue_rope", category: "BUILDING_COLLAPSE", incidentIndex: 1 },
  { type: "POLICE", prefix: "POLICE", capability: "TRAFFIC_CONTROL", equipment: "traffic_kit", category: "ROAD_OBSTRUCTION", incidentIndex: 0 },
  { type: "UTILITY_REPAIR", prefix: "UTILITY", capability: "ELECTRICAL_REPAIR", equipment: "insulated_tools", category: "ELECTRICAL_HAZARD", incidentIndex: 2 },
  { type: "EVACUATION_TRANSPORT", prefix: "EVAC", capability: "MASS_EVACUATION", equipment: "evacuation_seat", category: "EVACUATION_REQUEST", incidentIndex: 0 },
  { type: "SUPPLY_DELIVERY", prefix: "SUPPLY", capability: "LOGISTICS", equipment: "supply_crate", category: "SUPPLY_REQUEST", incidentIndex: 2 },
]);

const INCIDENTS = Object.freeze([
  Object.freeze({ id: "inc_custom_urban_flood", incidentType: "URBAN_FLOOD", location: Object.freeze({ latitude: 0, longitude: 80, label: "Fictional Riverside Ward" }), severity: 6 }),
  Object.freeze({ id: "inc_custom_earthquake", incidentType: "EARTHQUAKE_AFTERMATH", location: Object.freeze({ latitude: 80, longitude: 0, label: "Fictional Mason District" }), severity: 7 }),
  Object.freeze({ id: "inc_custom_storm", incidentType: "SEVERE_STORM", location: Object.freeze({ latitude: 0, longitude: -80, label: "Fictional West Grid" }), severity: 6 }),
  Object.freeze({ id: "inc_custom_urban_fire", incidentType: "URBAN_FIRE", location: Object.freeze({ latitude: -80, longitude: 0, label: "Fictional Foundry Quarter" }), severity: 7 }),
]);

const SCALE = Object.freeze({
  CALM: Object.freeze({ responders: 10, reports: 100, tasks: 8, shortages: 1, unavailable: 0, noise: 0.01, workMs: 900_000 }),
  BUSY: Object.freeze({ responders: 50, reports: 1_000, tasks: 25, shortages: 3, unavailable: 3, noise: 0.08, workMs: 1_200_000 }),
  CHAOS: Object.freeze({ responders: 100, reports: 5_000, tasks: 50, shortages: 8, unavailable: 10, noise: 0.16, workMs: 1_800_000 }),
  EXTREME: Object.freeze({ responders: 200, reports: 10_000, tasks: 100, shortages: 20, unavailable: 30, noise: 0.25, workMs: 3_600_000 }),
} as const);

/** Creates the four deterministic Phase 6F workload configurations. */
export function createResponderIntegrationPreset(difficulty: IntegrationDifficulty): ResponderIntegrationPreset {
  const scale = SCALE[difficulty];
  const responders = createResponders(scale.responders, scale.unavailable);
  const config: SimulationConfig = {
    scenarioId: `phase-6f-${difficulty.toLowerCase()}`,
    seed: `phase-6f-deterministic-${difficulty.toLowerCase()}`,
    startTimeMs: START_TIME_MS,
    maxDurationMs: 3 * 24 * 60 * 60 * 1_000,
    maxEventCount: 300_000,
    maxIncidentCount: 100,
    maxResponderCount: scale.responders,
    maxTaskCount: scale.tasks + scale.shortages,
    maxTravelAttemptCount: scale.tasks,
    automaticTaskAssignment: false,
    initialIncidents: INCIDENTS,
    initialResponders: responders,
    roadNetwork: integrationRoadNetwork(),
    communication: {
      enabled: true,
      normalDelayMs: 20,
      degradedAdditionalDelayMs: difficulty === "CALM" ? 50 : 1_000,
      intermittentAdditionalDelayMs: difficulty === "EXTREME" ? 5_000 : 500,
      retryIntervalMs: 1_000,
      deterministicJitterMs: difficulty === "CALM" ? 0 : 100,
      intermittentDeliveryProbability: difficulty === "EXTREME" ? 0.45 : 0.8,
      maxRetriesPerMessage: 2,
      maxPendingMessages: 20_000,
      maxDeliveryDelayMs: 120_000,
      maxCommunicationEvents: 100_000,
      infrastructureLink: { communicationTowerEffect: "NONE" },
    },
    resources: {
      enabled: true,
      initialFatigue: difficulty === "EXTREME" ? 25 : difficulty === "CHAOS" ? 15 : 5,
      travelFatiguePerHour: difficulty === "EXTREME" ? 35 : 15,
      workFatiguePerHour: difficulty === "EXTREME" ? 55 : 25,
      recoveryReductionPerHour: 80,
      assignmentFatigueThreshold: 85,
      recoveryCompletionThreshold: 70,
      recoveryDurationMs: 60 * 60 * 1_000,
      resourceDefinitions: {
        radio: { category: "REUSABLE_EQUIPMENT", consumable: false, essential: true },
        medical_kit: { category: "MEDICAL_SUPPLY", consumable: true },
        fire_retardant: { category: "FIRE_SUPPRESSION", consumable: true },
        rescue_rope: { category: "REUSABLE_EQUIPMENT", consumable: false },
        traffic_kit: { category: "REUSABLE_EQUIPMENT", consumable: false },
        insulated_tools: { category: "REUSABLE_EQUIPMENT", consumable: false },
        evacuation_seat: { category: "REUSABLE_EQUIPMENT", consumable: false },
        supply_crate: { category: "EMERGENCY_SUPPLY", consumable: true },
        specialized_shortage_item: { category: "RESCUE_CONSUMABLE", consumable: true },
      },
      initialStockpiles: [{
        id: "stockpile_phase6f",
        location: gridLocation(0, 0, "Fictional central stockpile"),
        inventory: { medical_kit: 1_000, fire_retardant: 1_000, supply_crate: 1_000 },
      }],
      defaultReplenishmentDelayMs: 5_000,
      maxReplenishmentDelayMs: 60_000,
      maxReplenishmentAmount: 10_000,
      maxResourceEvents: 100_000,
    },
  };
  return Object.freeze({ difficulty, responderCount: scale.responders, baseReportCount: scale.reports, operationalTaskCount: scale.tasks, shortageTaskCount: scale.shortages, config });
}

/** Runs a complete assignment-to-recovery simulation using only public engine APIs. */
export function runResponderIntegrationWorkload(difficulty: IntegrationDifficulty): ResponderIntegrationRun {
  const preset = createResponderIntegrationPreset(difficulty);
  const engine = new SimulationEngine(preset.config);
  const started = performance.now();
  executeResponderIntegrationWorkload(engine, preset);
  const duration = performance.now() - started;
  const publicAuditViolations = auditPublicSimulationOutputs(engine);
  const invariantViolations = validateResponderIntegrationInvariants(engine);
  return Object.freeze({
    engine,
    metrics: collectMetrics(engine, preset, duration),
    canonicalState: canonicalizeResponderIntegrationState(engine),
    publicAuditViolations,
    invariantViolations,
  });
}

/** Reusable execution routine; callers may reset the engine and invoke it again for replay tests. */
export function executeResponderIntegrationWorkload(engine: SimulationEngine, preset: ResponderIntegrationPreset): void {
  drain(engine); // deterministic initial incident, responder, communication, resource, and stockpile events
  const incidentIds = INCIDENTS.map((item) => item.id);
  engine.scheduleReports({
    reportCount: preset.baseReportCount,
    frequencyMs: 1,
    categories: PROFILES.map((item) => item.category),
    noise: noiseFor(preset),
  });
  const taskDefinitions = createTasks(preset);
  for (const definition of taskDefinitions) engine.createTask(definition);
  drain(engine);

  const locallyReserved = new Set<string>();
  const assignments: Array<{ taskId: string; responderId: string }> = [];
  for (const task of engine.getTasks()) {
    const responder = engine.getEligibleRespondersForTask(task.id).find((item) => !locallyReserved.has(item.id));
    if (responder === undefined) continue;
    locallyReserved.add(responder.id);
    assignments.push({ taskId: task.id, responderId: responder.id });
  }
  const dispatchOutageResponder = assignments[0]?.responderId;
  if (dispatchOutageResponder !== undefined) {
    const now = engine.getState().currentTimeMs;
    engine.scheduleCommunicationStateChange(dispatchOutageResponder, "OFFLINE", now, -20);
    engine.scheduleCommunicationStateChange(dispatchOutageResponder, "RECOVERING", now + 2_000);
    engine.scheduleCommunicationStateChange(dispatchOutageResponder, "CONNECTED", now + 2_001);
  }
  for (const assignment of assignments) engine.assignTask(assignment.taskId, assignment.responderId);
  drain(engine);

  const departureTime = engine.getState().currentTimeMs;
  for (const assignment of assignments) {
    const history = engine.getTask(assignment.taskId)?.causalEventHistory;
    const causeEventId = history?.at(-1)?.eventId;
    engine.departResponder(assignment.taskId, departureTime, {
      progressIntervalMs: 1_000,
      ...(causeEventId === undefined ? {} : { causeEventId }),
    });
  }
  const travelOutageResponder = assignments[1]?.responderId ?? assignments[0]?.responderId;
  if (travelOutageResponder !== undefined) {
    engine.scheduleCommunicationStateChange(travelOutageResponder, "OFFLINE", departureTime, -20);
    engine.scheduleCommunicationStateChange(travelOutageResponder, "RECOVERING", departureTime + 30_000);
    engine.scheduleCommunicationStateChange(travelOutageResponder, "CONNECTED", departureTime + 30_001);
  }
  engine.scheduleRoadStateChange("road_hub_flood", "BLOCKED", departureTime + 100, -10);
  const disasterTypes: readonly DisasterType[] = ["FLOOD", "EARTHQUAKE_AFTERMATH", "SEVERE_STORM", "URBAN_FIRE"];
  for (let index = 0; index < incidentIds.length; index += 1) {
    engine.scheduleEvolution({
      incidentId: incidentIds[index]!,
      disasterType: disasterTypes[index]!,
      stepCount: preset.difficulty === "CALM" ? 4 : 8,
      stepIntervalMs: 250,
      maximumCascadeDepth: 8,
      maximumSecondaryEvents: 3,
      observationProbability: preset.difficulty === "CALM" ? 0.1 : 0.5,
      reportNoise: noiseFor(preset),
    });
  }
  drain(engine);

  const arrivals = new Map(engine.getTravels().filter((item) => item.status === "ARRIVED").map((item) => [item.taskId, item]));
  const startTime = engine.getState().currentTimeMs;
  const startEvents = new Map<string, string>();
  for (const task of engine.getTasks()) {
    if (task.status === "EN_ROUTE" && arrivals.has(task.id)) {
      const event = engine.scheduleTaskStateTransition(task.id, "IN_PROGRESS", startTime, 0, arrivals.get(task.id)?.eventHistory.at(-1)?.eventId);
      startEvents.set(task.id, event.id);
    } else if (task.status === "EN_ROUTE") {
      engine.scheduleTaskStateTransition(task.id, "FAILED", startTime);
    }
  }
  const executionOutageResponder = assignments[2]?.responderId;
  if (executionOutageResponder !== undefined) {
    engine.scheduleCommunicationStateChange(executionOutageResponder, "OFFLINE", startTime, -20);
  }
  const unassigned = engine.getResponders().find((item) => !locallyReserved.has(item.id) && item.availabilityState === "AVAILABLE");
  if (unassigned !== undefined) {
    engine.scheduleEquipmentFailure(unassigned.id, "radio", "UNAVAILABLE", "FICTIONAL_STORM_DAMAGE", startTime + 1);
    engine.scheduleEquipmentRepair(unassigned.id, "radio", "UNDER_REPAIR", startTime + 2);
    engine.scheduleEquipmentRepair(unassigned.id, "radio", "OPERATIONAL", startTime + 3);
  }
  drain(engine);

  const active = engine.getTasks().filter((item) => item.status === "IN_PROGRESS");
  const workDuration = SCALE[preset.difficulty].workMs;
  const terminalTime = engine.getState().currentTimeMs + workDuration;
  for (let index = 0; index < active.length; index += 1) {
    const status: TaskStatus = index > 0 && index % 10 === 0 ? "FAILED" : "COMPLETED";
    engine.scheduleTaskStateTransition(active[index]!.id, status, terminalTime, 0, startEvents.get(active[index]!.id));
  }
  if (executionOutageResponder !== undefined) {
    engine.scheduleCommunicationStateChange(executionOutageResponder, "RECOVERING", terminalTime + 500);
    engine.scheduleCommunicationStateChange(executionOutageResponder, "CONNECTED", terminalTime + 501);
  }
  const recoveryOutageResponder = assignments[3]?.responderId;
  if (recoveryOutageResponder !== undefined) {
    engine.scheduleCommunicationStateChange(recoveryOutageResponder, "OFFLINE", terminalTime, -20);
    engine.scheduleCommunicationStateChange(recoveryOutageResponder, "RECOVERING", terminalTime + 3_600_500);
    engine.scheduleCommunicationStateChange(recoveryOutageResponder, "CONNECTED", terminalTime + 3_600_501);
  }
  const replenishmentResponder = active[0]?.assignedResponderId;
  if (replenishmentResponder !== undefined) {
    engine.requestReplenishment("stockpile_phase6f", replenishmentResponder, { medical_kit: 1 }, terminalTime + 1, 5_000);
    engine.requestReplenishment("stockpile_phase6f", replenishmentResponder, { supply_crate: 9_999 }, terminalTime + 2, 5_000);
  }
  drain(engine);
}

export function canonicalizeResponderIntegrationState(engine: SimulationEngine): string {
  const state = engine.getState();
  const causalHistory = state.eventHistory.map(({ event, processedAtMs, change }) => ({
    id: event.id,
    type: event.type,
    scheduledTimeMs: event.scheduledTimeMs,
    priority: event.priority,
    ...(event.causeEventId === undefined ? {} : { causeEventId: event.causeEventId }),
    ...(event.relatedIncidentId === undefined ? {} : { relatedIncidentId: event.relatedIncidentId }),
    ...(event.relatedResponderId === undefined ? {} : { relatedResponderId: event.relatedResponderId }),
    ...(event.relatedTaskId === undefined ? {} : { relatedTaskId: event.relatedTaskId }),
    ...(event.relatedTravelId === undefined ? {} : { relatedTravelId: event.relatedTravelId }),
    processedAtMs,
    change,
  }));
  return JSON.stringify({
    incidents: state.incidents,
    responders: state.responders,
    tasks: state.tasks,
    travels: state.travels,
    roadNetwork: state.roadNetwork,
    communications: state.communications,
    publicOperationalObservations: state.publicOperationalObservations,
    commandCenterKnowledge: state.commandCenterKnowledge,
    responderResources: state.responderResources,
    taskResources: state.taskResources,
    stockpiles: state.stockpiles,
    replenishments: state.replenishments,
    publicEmergencyObservations: engine.getPublicObservations(),
    environment: engine.getHiddenEnvironmentHistory(),
    cascades: engine.getHiddenCascadeApplications(),
    eventHistory: causalHistory,
  });
}

export function auditPublicSimulationOutputs(engine: SimulationEngine): readonly string[] {
  const forbidden = new Set([
    "internalIncidentId", "actualSeverity", "severity", "environment", "infrastructure",
    "causeEventId", "failureReason", "duplicateFamilyId", "duplicateOfReportId",
    "contradictionOfReportId", "sourceQuality", "reliabilityScore", "groundTruthLocation",
    "futureEvents", "privateEvaluation", "transformations", "deliveryIncidentState",
  ]);
  const violations: string[] = [];
  const inspect = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => inspect(item, `${path}[${index}]`));
      return;
    }
    if (typeof value !== "object" || value === null) return;
    for (const [key, item] of Object.entries(value)) {
      if (forbidden.has(key)) violations.push(`${path}.${key}`);
      inspect(item, `${path}.${key}`);
    }
  };
  inspect(engine.getPublicObservations(), "publicEmergencyObservations");
  inspect(engine.getPublicOperationalObservations(), "publicOperationalObservations");
  return Object.freeze(violations);
}

export function validateResponderIntegrationInvariants(engine: SimulationEngine): readonly string[] {
  const violations: string[] = [];
  const state = engine.getState();
  const processedIds = new Set<string>();
  for (const record of state.eventHistory) {
    if (record.event.causeEventId !== undefined && !processedIds.has(record.event.causeEventId)) violations.push(`invalid-cause:${record.event.id}`);
    processedIds.add(record.event.id);
  }
  for (const resource of state.responderResources) {
    for (const [item, quantity] of Object.entries(resource.inventory)) if (quantity < 0) violations.push(`negative-inventory:${resource.responderId}:${item}`);
  }
  const activeByResponder = new Map<string, number>();
  for (const task of state.tasks) {
    if (["ASSIGNED", "EN_ROUTE", "IN_PROGRESS"].includes(task.status) && task.assignedResponderId !== undefined) activeByResponder.set(task.assignedResponderId, (activeByResponder.get(task.assignedResponderId) ?? 0) + 1);
    const started = task.causalEventHistory.find((item) => item.status === "IN_PROGRESS");
    if (started !== undefined) {
      const travel = state.travels.find((item) => item.taskId === task.id);
      if (travel?.arrivedAtMs === undefined || started.atMs < travel.arrivedAtMs) violations.push(`work-before-arrival:${task.id}`);
    }
  }
  for (const [responderId, count] of activeByResponder) if (count > 1) violations.push(`overlapping-assignment:${responderId}`);
  for (const travel of state.travels) {
    const task = state.tasks.find((item) => item.id === travel.taskId);
    if (task?.status === "CANCELLED" && travel.status === "ARRIVED") violations.push(`phantom-arrival:${travel.id}`);
    if (travel.status === "ARRIVED") {
      const responder = state.responders.find((item) => item.id === travel.responderId);
      if (responder !== undefined && (responder.location.x !== travel.destination.x || responder.location.y !== travel.destination.y)) violations.push(`teleportation:${travel.id}`);
    }
  }
  if (state.processedEventCount > engine.config.maxEventCount) violations.push("event-capacity-exceeded");
  return Object.freeze(violations);
}

function collectMetrics(engine: SimulationEngine, preset: ResponderIntegrationPreset, executionDurationMs: number): ResponderIntegrationMetrics {
  const state = engine.getState();
  const tasks = state.tasks;
  const delays = state.travels.filter((item) => item.arrivedAtMs !== undefined).map((travel) => {
    const task = tasks.find((item) => item.id === travel.taskId)!;
    return travel.arrivedAtMs! - task.createdAtMs;
  });
  const messages = engine.getHiddenOperationalMessages();
  const normalDelay = engine.config.communication.normalDelayMs;
  const delayed = messages.filter((item) => item.receivedAtMs !== undefined && item.receivedAtMs - item.submittedAtMs > normalDelay).length;
  const failed = messages.filter((item) => item.deliveryStatus === "FAILED").length;
  const statusCount = (status: TaskStatus): number => tasks.filter((item) => item.status === status).length;
  return Object.freeze({
    difficulty: preset.difficulty,
    executionDurationMs: Math.round(executionDurationMs * 100) / 100,
    virtualDurationMs: state.currentTimeMs - state.startTimeMs,
    baseReportCount: preset.baseReportCount,
    finalReportCount: state.reports.length,
    incidentCount: state.incidents.length,
    responderCount: state.responders.length,
    totalTaskCount: tasks.length,
    assignedTasks: tasks.filter((item) => item.assignedResponderId !== undefined).length,
    completedTasks: statusCount("COMPLETED"),
    failedTasks: statusCount("FAILED"),
    pendingTasks: statusCount("PENDING"),
    averageSimulatedResponseDelayMs: delays.length === 0 ? 0 : Math.round(delays.reduce((sum, item) => sum + item, 0) / delays.length),
    communicationMessagesDelayed: delayed,
    communicationMessagesFailed: failed,
    resourceShortages: statusCount("PENDING") + state.replenishments.filter((item) => item.status === "FAILED").length,
    cascadingEvents: engine.getHiddenCascadeApplications().length,
    peakEventQueueSize: state.peakPendingEventCount,
    totalProcessedEvents: state.processedEventCount,
  });
}

function createResponders(count: number, unavailableCount: number): readonly InitialResponderDefinition[] {
  return Object.freeze(Array.from({ length: count }, (_, index) => {
    const profile = PROFILES[index % PROFILES.length]!;
    return Object.freeze({
      id: `rsp_custom_phase6f_${String(index + 1).padStart(3, "0")}`,
      callsign: `${profile.prefix}-${String(index + 1).padStart(3, "0")}`,
      responderType: profile.type,
      location: gridLocation((index % 5) - 2, Math.floor(index / 5) % 5 - 2, `Fictional ${profile.prefix} base`),
      crewCapacity: profile.type === "EVACUATION_TRANSPORT" ? 20 : 6,
      equipmentInventory: Object.freeze({ radio: 1, [profile.equipment]: 4 }),
      initialState: index >= count - unavailableCount ? "OFFLINE" as const : "AVAILABLE" as const,
    });
  }));
}

function createTasks(preset: ResponderIntegrationPreset): readonly TaskDefinition[] {
  const work = SCALE[preset.difficulty].workMs;
  const tasks: TaskDefinition[] = [];
  for (let index = 0; index < preset.operationalTaskCount; index += 1) {
    const profile = PROFILES[index % PROFILES.length]!;
    tasks.push(Object.freeze({
      id: `task_custom_phase6f_${String(index + 1).padStart(3, "0")}`,
      relatedIncidentId: INCIDENTS[profile.incidentIndex]!.id,
      requiredCapabilities: Object.freeze([profile.capability]),
      requiredEquipment: Object.freeze({ [profile.equipment]: 1 }),
      requiredCrewCapacity: profile.type === "EVACUATION_TRANSPORT" ? 10 : 2,
      eligibleResponderTypes: Object.freeze([profile.type]),
      priority: index % 9 === 0 ? "CRITICAL" as const : index % 3 === 0 ? "HIGH" as const : "NORMAL" as const,
      estimatedEffortMs: work,
    }));
  }
  for (let index = 0; index < preset.shortageTaskCount; index += 1) {
    tasks.push(Object.freeze({
      id: `task_custom_phase6f_shortage_${String(index + 1).padStart(3, "0")}`,
      relatedIncidentId: INCIDENTS[index % INCIDENTS.length]!.id,
      requiredCapabilities: Object.freeze(["WATER_RESCUE"]),
      requiredEquipment: Object.freeze({ specialized_shortage_item: 1 }),
      requiredCrewCapacity: 2,
      eligibleResponderTypes: Object.freeze(["WATER_RESCUE" as const]),
      priority: "HIGH" as const,
      estimatedEffortMs: work,
    }));
  }
  return Object.freeze(tasks);
}

function noiseFor(preset: ResponderIntegrationPreset): InformationNoiseConfig {
  const probability = SCALE[preset.difficulty].noise;
  if (preset.difficulty === "CALM") return Object.freeze({ maxDuplicatesPerOriginal: 0, maxFinalReportCount: preset.baseReportCount, contradictionProbability: probability, missingDetailProbability: probability, minAdditionalDelayMs: 0, maxAdditionalDelayMs: 100 });
  return Object.freeze({
    duplicateProbability: probability / 2,
    contradictionProbability: probability,
    missingDetailProbability: probability,
    delayProbability: probability,
    staleProbability: probability / 2,
    locationErrorProbability: probability,
    maxDuplicatesPerOriginal: 1,
    minAdditionalDelayMs: 100,
    maxAdditionalDelayMs: preset.difficulty === "EXTREME" ? 10_000 : 2_000,
    maxLocationOffset: preset.difficulty === "EXTREME" ? 500 : 100,
    maxFinalReportCount: preset.baseReportCount * 2,
  });
}

function integrationRoadNetwork(): NonNullable<SimulationConfig["roadNetwork"]> {
  const nodes = [
    { id: "node_hub", location: gridLocation(0, 0, "Fictional central hub") },
    { id: "node_relay", location: gridLocation(40, 40, "Fictional alternate junction") },
    { id: "node_flood", location: gridLocation(80, 0, "Fictional Riverside Ward") },
    { id: "node_quake", location: gridLocation(0, 80, "Fictional Mason District") },
    { id: "node_storm", location: gridLocation(-80, 0, "Fictional West Grid") },
    { id: "node_fire", location: gridLocation(0, -80, "Fictional Foundry Quarter") },
  ] as const;
  return Object.freeze({ nodes, segments: Object.freeze([
    { id: "road_hub_flood", fromNodeId: "node_hub", toNodeId: "node_flood", distanceUnits: 80, speedUnitsPerSecond: 20, infrastructureType: "ROAD" as const },
    { id: "road_hub_relay", fromNodeId: "node_hub", toNodeId: "node_relay", distanceUnits: 57, speedUnitsPerSecond: 20 },
    { id: "road_relay_flood", fromNodeId: "node_relay", toNodeId: "node_flood", distanceUnits: 57, speedUnitsPerSecond: 20 },
    { id: "road_hub_quake", fromNodeId: "node_hub", toNodeId: "node_quake", distanceUnits: 80, speedUnitsPerSecond: 20 },
    { id: "road_relay_quake", fromNodeId: "node_relay", toNodeId: "node_quake", distanceUnits: 57, speedUnitsPerSecond: 20 },
    { id: "road_hub_storm", fromNodeId: "node_hub", toNodeId: "node_storm", distanceUnits: 80, speedUnitsPerSecond: 20 },
    { id: "road_hub_fire", fromNodeId: "node_hub", toNodeId: "node_fire", distanceUnits: 80, speedUnitsPerSecond: 20 },
  ]) });
}

function gridLocation(x: number, y: number, label: string) {
  return Object.freeze({ fictional: true as const, coordinateSystem: "SIMULATED_LOCAL_GRID" as const, x, y, label });
}

function drain(engine: SimulationEngine): void {
  engine.start();
  engine.runUntilEmpty();
}
