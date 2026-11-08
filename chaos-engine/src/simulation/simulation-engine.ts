import { EventPriorityQueue } from "../core/event-priority-queue.js";
import { VirtualClock } from "../core/virtual-clock.js";
import {
  createInitialInfrastructure,
  planEvolution,
  type CascadeApplication,
  type EnvironmentState,
  type EvolutionConfig,
  type InfrastructureEntity,
} from "../evolution/evolution.js";
import {
  MAX_REPORTS_PER_GENERATION,
  ReportGenerator,
} from "../reporting/report-generator.js";
import {
  InformationNoiseProcessor,
  finalizeEvaluation,
  validateNoiseConfig,
  type PrivateReportEvaluation,
} from "../reporting/noise.js";
import {
  projectPublicObservation,
  type EmergencyReport,
  type PublicEmergencyObservation,
  type ReportGenerationConfig,
} from "../reporting/types.js";
import {
  MAX_INCIDENT_SEVERITY,
  MIN_INCIDENT_SEVERITY,
  canonicalizeConfig,
  validateIncidentDefinition,
  validateSimulationConfig,
  type SimulationConfig,
  type ValidatedSimulationConfig,
} from "./config.js";
import {
  SimulationConfigError,
  SimulationEventError,
  SimulationLimitError,
  SimulationStateError,
} from "./errors.js";
import type {
  IncidentTransitionEvent,
  SimulationEvent,
  SimulationEventRequest,
} from "./events.js";
import { DeterministicIds } from "./identifiers.js";
import {
  createIncident,
  transitionIncident,
  type IncidentChange,
  type IncidentSnapshot,
} from "./incident.js";
import {
  createResponder,
  freezeResponderSnapshot,
  isResponderAvailabilityState,
  transitionResponder as applyResponderTransition,
  validateResponderDefinition,
  type InitialResponderDefinition,
  type ResponderAvailabilityState,
  type ResponderChange,
  type ResponderSnapshot,
} from "./responder.js";
import {
  assignTask as applyTaskAssignment,
  createTask as createTaskSnapshot,
  freezeTaskSnapshot,
  isActiveTaskStatus,
  isResponderQualifiedForTask,
  isTaskStatus,
  matchRespondersForTask,
  recordSkippedAssignment,
  taskAssignmentEventPriority,
  transitionTask as applyTaskTransition,
  validateTaskDefinition,
  type TaskChange,
  type TaskDefinition,
  type TaskSnapshot,
  type TaskStatus,
} from "./task.js";
import {
  DEFAULT_TRAVEL_PROGRESS_INTERVAL_MS,
  MAX_TRAVEL_PROGRESS_EVENTS,
  MAX_TRAVEL_REROUTES,
  MAX_TRAVEL_RETRIES,
  arriveTravel,
  blockTravel,
  createRoadNetwork,
  createTravel,
  findShortestRoute,
  freezeRoadNetwork,
  freezeTravelSnapshot,
  infrastructureStatusToRoadState,
  isRoadAccessState,
  projectIncidentLocation,
  projectTravel,
  recordTravelProgress,
  remainingRouteSegmentIds,
  rerouteTravel,
  terminateTravel,
  travelProgressEventTimes,
  updateRoadSegmentState,
  type RoadNetworkSnapshot,
  type RoadAccessState,
  type RoadStateChangedChange,
  type TravelChange,
  type TravelSnapshot,
} from "./travel.js";
import {
  CommunicationDeliveryPlanner,
  communicationInfrastructureApplies,
  communicationTransitionPath,
  createOperationalMessage,
  deliverOperationalMessage,
  failOperationalMessage,
  freezeCommunicationState,
  freezeOperationalMessage,
  initialCommunicationState,
  infrastructureCommunicationState,
  isCommunicationState,
  projectPublicOperationalObservation,
  recordDeliveryAttempt,
  transitionCommunicationState,
  updateCommandCenterKnowledge,
  validateOperationalMessageRequest,
  type CommandCenterKnowledge,
  type CommunicationState,
  type CommunicationStateChangedChange,
  type OperationalMessageChange,
  type OperationalMessageRequest,
  type OperationalMessageSnapshot,
  type PublicOperationalObservation,
  type ResponderCommunicationSnapshot,
} from "./communication.js";
import {
  advanceResponderFatigue,
  changeEquipmentCondition,
  consumeTaskResources,
  createResponderResource,
  createStockpile,
  freezeReplenishment,
  freezeResponderResource,
  freezeStockpile,
  freezeTaskResource,
  hasEssentialEquipment,
  isEquipmentCondition,
  releaseTaskResources,
  reserveTaskResources,
  transferFromStockpile,
  validateStockpileDefinition,
  validateTransferQuantities,
  type EquipmentCondition,
  type FatigueMode,
  type ReplenishmentSnapshot,
  type ResourceChange,
  type ResponderResourceSnapshot,
  type StockpileDefinition,
  type StockpileSnapshot,
  type TaskResourceSnapshot,
} from "./resources.js";

export type SimulationStatus = "READY" | "RUNNING" | "PAUSED" | "COMPLETED" | "FAILED";

export interface ProcessedEventRecord {
  readonly event: SimulationEvent;
  readonly processedAtMs: number;
  readonly change: Readonly<SimulationChange>;
}

export interface ReportCreatedChange {
  readonly kind: "REPORT_CREATED";
  readonly reportId: string;
  readonly internalIncidentId: string;
}
export interface EvolutionAppliedChange {
  readonly kind: "EVOLUTION_APPLIED";
  readonly incidentId: string;
  readonly ruleIds: readonly string[];
}

export type SimulationChange =
  | IncidentChange
  | ResponderChange
  | TaskChange
  | TravelChange
  | RoadStateChangedChange
  | CommunicationStateChangedChange
  | OperationalMessageChange
  | ResourceChange
  | ReportCreatedChange
  | EvolutionAppliedChange;

export interface SimulationFailure {
  readonly eventId: string;
  readonly message: string;
  readonly failedAtMs: number;
}

export interface SimulationSnapshot {
  readonly runId: string;
  readonly scenarioId: string;
  readonly status: SimulationStatus;
  readonly currentTimeMs: number;
  readonly startTimeMs: number;
  readonly maximumTimeMs: number;
  readonly pendingEventCount: number;
  /** Highest number of simultaneously queued events observed in this run. */
  readonly peakPendingEventCount: number;
  readonly processedEventCount: number;
  readonly incidents: readonly IncidentSnapshot[];
  readonly responders: readonly ResponderSnapshot[];
  readonly tasks: readonly TaskSnapshot[];
  readonly travels: readonly TravelSnapshot[];
  readonly roadNetwork: RoadNetworkSnapshot;
  readonly communications: readonly ResponderCommunicationSnapshot[];
  readonly publicOperationalObservations: readonly PublicOperationalObservation[];
  readonly commandCenterKnowledge: readonly CommandCenterKnowledge[];
  readonly responderResources: readonly ResponderResourceSnapshot[];
  readonly taskResources: readonly TaskResourceSnapshot[];
  readonly stockpiles: readonly StockpileSnapshot[];
  readonly replenishments: readonly ReplenishmentSnapshot[];
  readonly reports: readonly EmergencyReport[];
  readonly eventHistory: readonly ProcessedEventRecord[];
  readonly failure?: SimulationFailure;
}

export interface ResponderDepartureOptions {
  readonly responderSpeedUnitsPerSecond?: number;
  readonly progressIntervalMs?: number;
  readonly eventPriority?: number;
  readonly causeEventId?: string;
}

/** Deterministic, caller-driven orchestration for incident lifecycle events. */
export class SimulationEngine {
  readonly #config: ValidatedSimulationConfig;
  readonly #identityMaterial: string;

  #clock: VirtualClock;
  #queue: EventPriorityQueue<SimulationEvent>;
  #ids: DeterministicIds;
  #reportGenerator: ReportGenerator;
  #noiseProcessor: InformationNoiseProcessor;
  #runId: string;
  #status: SimulationStatus = "READY";
  #incidents = new Map<string, IncidentSnapshot>();
  #responders = new Map<string, ResponderSnapshot>();
  #tasks = new Map<string, TaskSnapshot>();
  #travels = new Map<string, TravelSnapshot>();
  #communications = new Map<string, ResponderCommunicationSnapshot>();
  #operationalMessages = new Map<string, OperationalMessageSnapshot>();
  #publicOperationalObservations: PublicOperationalObservation[] = [];
  #commandCenterKnowledge = new Map<string, CommandCenterKnowledge>();
  #responderResources = new Map<string, ResponderResourceSnapshot>();
  #taskResources = new Map<string, TaskResourceSnapshot>();
  #stockpiles = new Map<string, StockpileSnapshot>();
  #replenishments = new Map<string, ReplenishmentSnapshot>();
  #roadNetwork: RoadNetworkSnapshot;
  #reports = new Map<string, EmergencyReport>();
  #pendingReportEvaluations = new Map<string, PrivateReportEvaluation>();
  #reportEvaluations = new Map<string, PrivateReportEvaluation>();
  #environmentHistory: Array<Readonly<{ eventId: string; atMs: number; state: EnvironmentState; causeEventId?: string }>> = [];
  #infrastructure = new Map<string, InfrastructureEntity>();
  #cascadeApplications: CascadeApplication[] = [];
  #secondaryOrigins = new Map<string, string>();
  #reservedIncidentIds = new Set<string>();
  #reservedResponderIds = new Set<string>();
  #reservedResponderCallsigns = new Set<string>();
  #reservedTaskIds = new Set<string>();
  #reservedTaskAssignmentIds = new Set<string>();
  #reservedResponderAssignmentIds = new Set<string>();
  #reservedTravelIds = new Set<string>();
  #reservedTravelTaskIds = new Set<string>();
  #reservedTravelResponderIds = new Set<string>();
  #reservedTravelRerouteIds = new Set<string>();
  #reservedMessageIds = new Set<string>();
  #reservedStockpileIds = new Set<string>();
  #reservedReplenishmentIds = new Set<string>();
  #reservedStockpileQuantities = new Map<string, Map<string, number>>();
  #reservedResponderReplenishment = new Map<string, Map<string, number>>();
  #eventIds = new Set<string>();
  #reportIds = new Set<string>();
  #eventHistory: ProcessedEventRecord[] = [];
  #processedEventsById = new Map<string, ProcessedEventRecord>();
  #scheduledEventCount = 0;
  #reservedAutomaticAssignmentEventCount = 0;
  #reservedTravelChildEventCount = 0;
  #reservedCommunicationChildEventCount = 0;
  #reservedMessageAttemptEvents = new Map<string, number>();
  #scheduledCommunicationEventCount = 0;
  #scheduledResourceEventCount = 0;
  #reservedResourceChildEventCount = 0;
  #peakPendingEventCount = 0;
  #failure: SimulationFailure | undefined;
  #deliveryPlanner: CommunicationDeliveryPlanner;
  #initializing = false;

  public constructor(config: SimulationConfig) {
    this.#config = validateSimulationConfig(config);
    this.#identityMaterial = canonicalizeConfig(this.#config);
    this.#clock = new VirtualClock();
    this.#queue = new EventPriorityQueue<SimulationEvent>();
    this.#ids = new DeterministicIds(this.#identityMaterial);
    this.#runId = this.#ids.runId;
    this.#reportGenerator = new ReportGenerator(this.#identityMaterial, this.#runId);
    this.#noiseProcessor = new InformationNoiseProcessor(this.#identityMaterial);
    this.#deliveryPlanner = new CommunicationDeliveryPlanner(this.#identityMaterial);
    this.#roadNetwork = createRoadNetwork(this.#config.roadNetwork);
    this.#initialize();
  }

  public get runId(): string {
    return this.#runId;
  }

  public get status(): SimulationStatus {
    return this.#status;
  }

  public get config(): ValidatedSimulationConfig {
    return this.#config;
  }

  public start(): void {
    this.#assertNotFailed();
    this.#clock.resume();
    this.#status = "RUNNING";
  }

  public pause(): void {
    this.#assertNotFailed();
    this.#clock.pause();
    this.#status = "PAUSED";
  }

  public resume(): void {
    this.start();
  }

  public reset(): void {
    this.#initialize();
  }

  public scheduleEvent(request: SimulationEventRequest): SimulationEvent {
    this.#assertNotFailed();
    const event = this.#scheduleEvent(request);
    if (this.#status === "COMPLETED") {
      this.#status = "PAUSED";
    }
    return event;
  }

  public registerResponder(
    definition: InitialResponderDefinition,
    scheduledTimeMs = this.#clock.timeMs,
    priority = 0,
  ): SimulationEvent {
    return this.scheduleEvent({
      type: "RESPONDER_REGISTER",
      scheduledTimeMs,
      priority,
      payload: definition,
    });
  }

  public scheduleResponderStateTransition(
    responderId: string,
    targetState: ResponderAvailabilityState,
    scheduledTimeMs: number,
    priority = 0,
  ): SimulationEvent {
    return this.scheduleEvent({
      type: "RESPONDER_STATE_TRANSITION",
      scheduledTimeMs,
      priority,
      relatedResponderId: responderId,
      payload: { targetState },
    });
  }

  public createTask(
    definition: TaskDefinition,
    scheduledTimeMs = this.#clock.timeMs,
    eventPriority = 0,
    causeEventId?: string,
  ): SimulationEvent {
    return this.scheduleEvent({
      type: "TASK_CREATE",
      scheduledTimeMs,
      priority: eventPriority,
      ...(causeEventId === undefined ? {} : { causeEventId }),
      payload: definition,
    });
  }

  public assignTask(
    taskId: string,
    responderId: string,
    scheduledTimeMs = this.#clock.timeMs,
    eventPriority = 0,
    causeEventId?: string,
  ): SimulationEvent {
    return this.scheduleEvent({
      type: "TASK_ASSIGN",
      scheduledTimeMs,
      priority: eventPriority,
      ...(causeEventId === undefined ? {} : { causeEventId }),
      relatedTaskId: taskId,
      payload: {
        responderId,
        automatic: false,
        origin: "SIMULATION_BASELINE",
      },
    });
  }

  public requestAutomaticTaskAssignment(
    taskId: string,
    scheduledTimeMs = this.#clock.timeMs,
    eventPriority = 0,
    causeEventId?: string,
  ): SimulationEvent {
    return this.scheduleEvent({
      type: "TASK_ASSIGN",
      scheduledTimeMs,
      priority: eventPriority,
      ...(causeEventId === undefined ? {} : { causeEventId }),
      relatedTaskId: taskId,
      payload: {
        automatic: true,
        origin: "SIMULATION_BASELINE",
      },
    });
  }

  public scheduleTaskStateTransition(
    taskId: string,
    targetStatus: TaskStatus,
    scheduledTimeMs: number,
    eventPriority = 0,
    causeEventId?: string,
  ): SimulationEvent {
    return this.scheduleEvent({
      type: "TASK_STATE_TRANSITION",
      scheduledTimeMs,
      priority: eventPriority,
      ...(causeEventId === undefined ? {} : { causeEventId }),
      relatedTaskId: taskId,
      payload: { targetStatus },
    });
  }

  public departResponder(
    taskId: string,
    scheduledTimeMs = this.#clock.timeMs,
    options: ResponderDepartureOptions = {},
  ): SimulationEvent {
    const task = this.#requireExistingTask(taskId);
    const responder =
      task.assignedResponderId === undefined
        ? undefined
        : this.#responders.get(task.assignedResponderId);
    const speed =
      options.responderSpeedUnitsPerSecond ??
      (responder === undefined ? 10 : defaultResponderSpeed(responder.responderType));
    return this.scheduleEvent({
      type: "RESPONDER_DEPART",
      scheduledTimeMs,
      priority: options.eventPriority ?? 0,
      ...(options.causeEventId === undefined ? {} : { causeEventId: options.causeEventId }),
      relatedTaskId: taskId,
      payload: {
        responderSpeedUnitsPerSecond: speed,
        progressIntervalMs:
          options.progressIntervalMs ?? DEFAULT_TRAVEL_PROGRESS_INTERVAL_MS,
      },
    });
  }

  public retryTravel(
    travelId: string,
    scheduledTimeMs = this.#clock.timeMs,
    eventPriority = 0,
    causeEventId?: string,
  ): SimulationEvent {
    const travel = this.#requireExistingTravel(travelId);
    return this.scheduleEvent({
      type: "TRAVEL_REROUTE",
      scheduledTimeMs,
      priority: eventPriority,
      ...(causeEventId === undefined ? {} : { causeEventId }),
      relatedTravelId: travelId,
      payload: { routeVersion: travel.routeVersion, retry: true },
    });
  }

  public interruptTravel(
    travelId: string,
    scheduledTimeMs = this.#clock.timeMs,
    eventPriority = 0,
    causeEventId?: string,
  ): SimulationEvent {
    return this.scheduleEvent({
      type: "TRAVEL_INTERRUPT",
      scheduledTimeMs,
      priority: eventPriority,
      ...(causeEventId === undefined ? {} : { causeEventId }),
      relatedTravelId: travelId,
      payload: {},
    });
  }

  public scheduleRoadStateChange(
    segmentId: string,
    state: RoadAccessState,
    scheduledTimeMs = this.#clock.timeMs,
    eventPriority = -5,
    causeEventId?: string,
  ): SimulationEvent {
    return this.scheduleEvent({
      type: "ROAD_STATE_CHANGE",
      scheduledTimeMs,
      priority: eventPriority,
      ...(causeEventId === undefined ? {} : { causeEventId }),
      payload: { segmentId, state },
    });
  }

  public scheduleCommunicationStateChange(
    responderId: string,
    targetState: CommunicationState,
    scheduledTimeMs = this.#clock.timeMs,
    eventPriority = 0,
    causeEventId?: string,
  ): SimulationEvent {
    return this.scheduleEvent({
      type: "COMMUNICATION_STATE_CHANGE",
      scheduledTimeMs,
      priority: eventPriority,
      ...(causeEventId === undefined ? {} : { causeEventId }),
      relatedResponderId: responderId,
      payload: { targetState },
    });
  }

  public sendOperationalMessage(
    request: OperationalMessageRequest,
    scheduledTimeMs = this.#clock.timeMs,
    eventPriority = 0,
    causeEventId?: string,
  ): SimulationEvent {
    return this.scheduleEvent({
      type: "OPERATIONAL_MESSAGE_CREATE",
      scheduledTimeMs,
      priority: eventPriority,
      ...(causeEventId === undefined ? {} : { causeEventId }),
      payload: request,
    });
  }

  public scheduleFatigueUpdate(
    responderId: string,
    scheduledTimeMs = this.#clock.timeMs,
    targetMode?: FatigueMode,
    eventPriority = 0,
    causeEventId?: string,
  ): SimulationEvent {
    return this.scheduleEvent({ type: "FATIGUE_UPDATE", scheduledTimeMs, priority: eventPriority, ...(causeEventId === undefined ? {} : { causeEventId }), relatedResponderId: responderId, payload: { ...(targetMode === undefined ? {} : { targetMode }) } });
  }

  public scheduleEquipmentFailure(
    responderId: string,
    item: string,
    targetCondition: "DEGRADED" | "UNAVAILABLE",
    cause: string,
    scheduledTimeMs = this.#clock.timeMs,
    eventPriority = 0,
    causeEventId?: string,
  ): SimulationEvent {
    return this.scheduleEvent({ type: "EQUIPMENT_FAIL", scheduledTimeMs, priority: eventPriority, ...(causeEventId === undefined ? {} : { causeEventId }), relatedResponderId: responderId, payload: { item, targetCondition, cause } });
  }

  public scheduleEquipmentRepair(
    responderId: string,
    item: string,
    targetCondition: "UNDER_REPAIR" | "OPERATIONAL" | "DEGRADED",
    scheduledTimeMs = this.#clock.timeMs,
    eventPriority = 0,
    causeEventId?: string,
  ): SimulationEvent {
    return this.scheduleEvent({ type: "EQUIPMENT_REPAIR", scheduledTimeMs, priority: eventPriority, ...(causeEventId === undefined ? {} : { causeEventId }), relatedResponderId: responderId, payload: { item, targetCondition } });
  }

  public registerStockpile(
    definition: StockpileDefinition,
    scheduledTimeMs = this.#clock.timeMs,
    eventPriority = 0,
    causeEventId?: string,
  ): SimulationEvent {
    return this.scheduleEvent({ type: "STOCKPILE_REGISTER", scheduledTimeMs, priority: eventPriority, ...(causeEventId === undefined ? {} : { causeEventId }), payload: definition });
  }

  public requestReplenishment(
    stockpileId: string,
    responderId: string,
    quantities: Readonly<Record<string, number>>,
    scheduledTimeMs = this.#clock.timeMs,
    delayMs?: number,
    eventPriority = 0,
    causeEventId?: string,
  ): SimulationEvent {
    return this.scheduleEvent({ type: "REPLENISHMENT_REQUEST", scheduledTimeMs, priority: eventPriority, ...(causeEventId === undefined ? {} : { causeEventId }), relatedResponderId: responderId, payload: { stockpileId, quantities, ...(delayMs === undefined ? {} : { delayMs }) } });
  }

  public scheduleReports(config: ReportGenerationConfig): readonly SimulationEvent[] {
    this.#assertNotFailed();
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
    const noise = validateNoiseConfig(config.noise);
    const duplicatePossible =
      noise.maxDuplicatesPerOriginal > 0 &&
      noise.probabilityOverrides.duplicate !== false &&
      (noise.probabilityOverrides.duplicate === true || noise.duplicateProbability > 0);
    const maximumFinalReports =
      config.reportCount * (1 + (duplicatePossible ? noise.maxDuplicatesPerOriginal : 0));
    if (maximumFinalReports > noise.maxFinalReportCount) {
      throw new SimulationLimitError("Worst-case noise expansion exceeds maxFinalReportCount.");
    }
    if (maximumFinalReports > this.#remainingEventCapacity) {
      throw new SimulationLimitError("Worst-case report volume exceeds remaining event capacity.");
    }
    const incidents = this.#selectReportIncidents(config.incidentIds);
    const reportGenerationMaximum = this.#maximumTimeMs - noise.maxAdditionalDelayMs;
    if (reportGenerationMaximum < this.#clock.timeMs) {
      throw new SimulationLimitError("Noise delay allowance exceeds remaining simulation duration.");
    }
    const baseReports = this.#reportGenerator.generate(
      incidents,
      config,
      this.#clock.timeMs,
      reportGenerationMaximum,
    );
    const plans = this.#noiseProcessor.apply(
      baseReports,
      this.#incidents,
      noise,
      this.#maximumTimeMs,
    );
    const events = plans.map((plan) =>
      this.#scheduleReportEvent(plan.report, plan.evaluation),
    );
    if (this.#status === "COMPLETED") {
      this.#status = "PAUSED";
    }
    return Object.freeze(events);
  }

  public scheduleEvolution(config: EvolutionConfig): readonly SimulationEvent[] {
    this.#assertNotFailed();
    if (!this.#incidents.has(config.incidentId)) throw new SimulationEventError(`Incident ${config.incidentId} does not exist.`);
    const plan = planEvolution(config, this.#identityMaterial, this.#clock.timeMs);
    const observationCount = plan.mutations.filter((item) => item.observationCategory !== undefined).length;
    const required = plan.mutations.length + observationCount;
    if (required > this.#remainingEventCapacity) throw new SimulationLimitError("Evolution plan exceeds remaining event capacity.");
    if (this.#incidents.size + plan.maximumSecondaryEvents > this.#config.maxIncidentCount) throw new SimulationLimitError("Evolution plan exceeds incident capacity.");
    if ((plan.mutations.at(-1)?.scheduledAtMs ?? this.#clock.timeMs) > this.#maximumTimeMs) throw new SimulationLimitError("Evolution plan exceeds maximum duration.");
    const events: SimulationEvent[] = [];
    let causeEventId: string | undefined;
    for (const mutation of plan.mutations) {
      const id = this.#nextEventId();
      const event: SimulationEvent = Object.freeze({ id, scheduledTimeMs: mutation.scheduledAtMs, priority: -10, type: "EVOLUTION_APPLY", relatedIncidentId: config.incidentId, ...(causeEventId === undefined ? {} : { causeEventId }), payload: mutation });
      this.#queue.enqueue({ timestampMs: event.scheduledTimeMs, priority: event.priority, value: event });
      this.#recordQueueDepth();
      this.#eventIds.add(id);
      this.#scheduledEventCount += 1;
      events.push(event);
      causeEventId = id;
    }
    return Object.freeze(events);
  }

  public processNextEvent(): ProcessedEventRecord | undefined {
    this.#requireRunning();
    return this.#processNextEvent();
  }

  public advanceBy(simulatedDurationMs: number): SimulationSnapshot {
    this.#requireRunning();
    if (!Number.isSafeInteger(simulatedDurationMs) || simulatedDurationMs < 0) {
      throw new SimulationStateError("Advance duration must be a non-negative safe integer.");
    }
    const targetTimeMs = this.#clock.timeMs + simulatedDurationMs;
    if (!Number.isSafeInteger(targetTimeMs)) {
      throw new SimulationStateError("Advance target exceeds the safe integer range.");
    }
    return this.advanceUntil(targetTimeMs);
  }

  public advanceUntil(targetTimeMs: number): SimulationSnapshot {
    this.#requireRunning();
    if (!Number.isSafeInteger(targetTimeMs)) {
      throw new SimulationStateError("Advance target must be a safe integer timestamp.");
    }
    if (targetTimeMs < this.#clock.timeMs) {
      throw new SimulationStateError("Cannot advance to a timestamp before current simulation time.");
    }
    if (targetTimeMs > this.#maximumTimeMs) {
      throw new SimulationLimitError("Advance target exceeds maximum simulation duration.");
    }

    let next = this.#queue.peek();
    while (next !== undefined && next.value.scheduledTimeMs <= targetTimeMs) {
      this.#processNextEvent();
      next = this.#queue.peek();
    }

    this.#advanceClockTo(targetTimeMs);
    return this.getState();
  }

  public runUntilEmpty(): SimulationSnapshot {
    this.#requireRunning();
    while (!this.#queue.isEmpty) {
      this.#processNextEvent();
    }
    this.#clock.pause();
    this.#status = "COMPLETED";
    return this.getState();
  }

  public getIncident(incidentId: string): IncidentSnapshot | undefined {
    const incident = this.#incidents.get(incidentId);
    return incident === undefined ? undefined : freezeIncidentSnapshot(incident);
  }

  public getResponder(responderId: string): ResponderSnapshot | undefined {
    const responder = this.#responders.get(responderId);
    return responder === undefined ? undefined : freezeResponderSnapshot(responder);
  }

  public getResponders(): readonly ResponderSnapshot[] {
    return Object.freeze(
      Array.from(this.#responders.values(), (responder) => freezeResponderSnapshot(responder)),
    );
  }

  public getTask(taskId: string): TaskSnapshot | undefined {
    const task = this.#tasks.get(taskId);
    return task === undefined ? undefined : freezeTaskSnapshot(task);
  }

  public getTasks(): readonly TaskSnapshot[] {
    return Object.freeze(
      Array.from(this.#tasks.values(), (task) => freezeTaskSnapshot(task)),
    );
  }

  public getTasksForIncident(incidentId: string): readonly TaskSnapshot[] {
    this.#requireExistingIncident(incidentId);
    return Object.freeze(
      Array.from(this.#tasks.values())
        .filter((task) => task.relatedIncidentId === incidentId)
        .map((task) => freezeTaskSnapshot(task)),
    );
  }

  public getEligibleRespondersForTask(taskId: string): readonly ResponderSnapshot[] {
    const task = this.#tasks.get(taskId);
    if (task === undefined) {
      throw new SimulationEventError(`Task ${taskId} does not exist.`);
    }
    return Object.freeze(
      matchRespondersForTask(
        task,
        this.#respondersVisibleToAssignmentPolicy(),
        this.#activeAssignedResponderIds(),
      ).filter((responder) => this.#isResponderResourceQualified(task, responder)).map((responder) => freezeResponderSnapshot(responder)),
    );
  }

  public getTravel(travelId: string): TravelSnapshot | undefined {
    const travel = this.#travels.get(travelId);
    return travel === undefined
      ? undefined
      : projectTravel(travel, this.#clock.timeMs);
  }

  public getTravels(): readonly TravelSnapshot[] {
    return Object.freeze(
      Array.from(this.#travels.values(), (travel) =>
        projectTravel(travel, this.#clock.timeMs),
      ),
    );
  }

  public getRoadNetwork(): RoadNetworkSnapshot {
    return freezeRoadNetwork(this.#roadNetwork);
  }

  public getResponderCommunication(responderId: string): ResponderCommunicationSnapshot | undefined {
    const value = this.#communications.get(responderId);
    return value === undefined ? undefined : freezeCommunicationState(value);
  }

  public getResponderCommunications(): readonly ResponderCommunicationSnapshot[] {
    return Object.freeze([...this.#communications.values()].map(freezeCommunicationState));
  }

  public getPublicOperationalObservations(): readonly PublicOperationalObservation[] {
    return Object.freeze([...this.#publicOperationalObservations]);
  }

  public getCommandCenterKnowledge(responderId: string): CommandCenterKnowledge | undefined {
    const value = this.#commandCenterKnowledge.get(responderId);
    return value === undefined ? undefined : Object.freeze({ ...value });
  }

  public getAllCommandCenterKnowledge(): readonly CommandCenterKnowledge[] {
    return Object.freeze([...this.#commandCenterKnowledge.values()].map((value) => Object.freeze({ ...value })));
  }

  /** Privileged diagnostic data; pending and failed messages are never public observations. */
  public getHiddenOperationalMessages(): readonly OperationalMessageSnapshot[] {
    return Object.freeze([...this.#operationalMessages.values()].map(freezeOperationalMessage));
  }

  public getResponderResourceState(responderId: string): ResponderResourceSnapshot | undefined {
    const value = this.#responderResources.get(responderId);
    return value === undefined ? undefined : freezeResponderResource(value);
  }

  public getResponderResourceStates(): readonly ResponderResourceSnapshot[] {
    return Object.freeze([...this.#responderResources.values()].map(freezeResponderResource));
  }

  public getTaskResourceState(taskId: string): TaskResourceSnapshot | undefined {
    const value = this.#taskResources.get(taskId);
    return value === undefined ? undefined : freezeTaskResource(value);
  }

  public getStockpiles(): readonly StockpileSnapshot[] {
    return Object.freeze([...this.#stockpiles.values()].map(freezeStockpile));
  }

  public getReplenishments(): readonly ReplenishmentSnapshot[] {
    return Object.freeze([...this.#replenishments.values()].map(freezeReplenishment));
  }

  public getReports(): readonly EmergencyReport[] {
    return Object.freeze([...this.#reports.values()]);
  }

  public getReportsForIncident(incidentId: string): readonly EmergencyReport[] {
    if (!this.#incidents.has(incidentId)) {
      throw new SimulationEventError(`Incident ${incidentId} does not exist.`);
    }
    return Object.freeze(
      Array.from(this.#reports.values()).filter(
        (report) => report.internalIncidentId === incidentId,
      ),
    );
  }

  public getPublicObservations(): readonly PublicEmergencyObservation[] {
    return Object.freeze(
      Array.from(this.#reports.values(), (report) => projectPublicObservation(report)),
    );
  }

  /** Privileged evaluation data for simulation tests and future scoring only. */
  public getPrivateReportEvaluations(): readonly PrivateReportEvaluation[] {
    return Object.freeze([...this.#reportEvaluations.values()]);
  }

  /** Privileged evaluation lookup; never use this as a public observation projection. */
  public getPrivateReportEvaluation(reportId: string): PrivateReportEvaluation | undefined {
    return this.#reportEvaluations.get(reportId);
  }
  public getHiddenEnvironmentHistory() { return Object.freeze(this.#environmentHistory.map((item) => Object.freeze({ ...item, state: Object.freeze({ ...item.state }) }))); }
  public getHiddenInfrastructure(): readonly InfrastructureEntity[] { return Object.freeze([...this.#infrastructure.values()]); }
  public getHiddenCascadeApplications(): readonly CascadeApplication[] { return Object.freeze([...this.#cascadeApplications]); }
  public getHiddenSecondaryOrigins(): Readonly<Record<string, string>> { return Object.freeze(Object.fromEntries(this.#secondaryOrigins)); }

  public getState(): SimulationSnapshot {
    const incidents = Object.freeze(
      Array.from(this.#incidents.values(), (incident) => freezeIncidentSnapshot(incident)),
    );
    const eventHistory = Object.freeze([...this.#eventHistory]);
    const reports = Object.freeze([...this.#reports.values()]);
    const responders = Object.freeze(
      Array.from(this.#responders.values(), (responder) => freezeResponderSnapshot(responder)),
    );
    const tasks = Object.freeze(
      Array.from(this.#tasks.values(), (task) => freezeTaskSnapshot(task)),
    );
    const travels = Object.freeze(
      Array.from(this.#travels.values(), (travel) =>
        projectTravel(travel, this.#clock.timeMs),
      ),
    );
    return Object.freeze({
      runId: this.#runId,
      scenarioId: this.#config.scenarioId,
      status: this.#status,
      currentTimeMs: this.#clock.timeMs,
      startTimeMs: this.#config.startTimeMs,
      maximumTimeMs: this.#maximumTimeMs,
      pendingEventCount: this.#queue.size,
      peakPendingEventCount: this.#peakPendingEventCount,
      processedEventCount: this.#eventHistory.length,
      incidents,
      responders,
      tasks,
      travels,
      roadNetwork: freezeRoadNetwork(this.#roadNetwork),
      communications: this.getResponderCommunications(),
      publicOperationalObservations: this.getPublicOperationalObservations(),
      commandCenterKnowledge: this.getAllCommandCenterKnowledge(),
      responderResources: this.getResponderResourceStates(),
      taskResources: Object.freeze([...this.#taskResources.values()].map(freezeTaskResource)),
      stockpiles: this.getStockpiles(),
      replenishments: this.getReplenishments(),
      reports,
      eventHistory,
      ...(this.#failure === undefined ? {} : { failure: this.#failure }),
    });
  }

  get #maximumTimeMs(): number {
    return this.#config.startTimeMs + this.#config.maxDurationMs;
  }

  get #remainingEventCapacity(): number {
    return (
      this.#config.maxEventCount -
      this.#scheduledEventCount -
      this.#reservedAutomaticAssignmentEventCount -
      this.#reservedTravelChildEventCount -
      this.#reservedCommunicationChildEventCount -
      this.#reservedResourceChildEventCount
    );
  }

  #initialize(): void {
    this.#clock = new VirtualClock({ startTimeMs: this.#config.startTimeMs });
    this.#queue = new EventPriorityQueue<SimulationEvent>();
    this.#peakPendingEventCount = 0;
    this.#ids = new DeterministicIds(this.#identityMaterial);
    this.#runId = this.#ids.runId;
    this.#reportGenerator = new ReportGenerator(this.#identityMaterial, this.#runId);
    this.#noiseProcessor = new InformationNoiseProcessor(this.#identityMaterial);
    this.#status = "READY";
    this.#incidents = new Map<string, IncidentSnapshot>();
    this.#responders = new Map<string, ResponderSnapshot>();
    this.#tasks = new Map<string, TaskSnapshot>();
    this.#travels = new Map<string, TravelSnapshot>();
    this.#communications = new Map<string, ResponderCommunicationSnapshot>();
    this.#operationalMessages = new Map<string, OperationalMessageSnapshot>();
    this.#publicOperationalObservations = [];
    this.#commandCenterKnowledge = new Map<string, CommandCenterKnowledge>();
    this.#responderResources = new Map<string, ResponderResourceSnapshot>();
    this.#taskResources = new Map<string, TaskResourceSnapshot>();
    this.#stockpiles = new Map<string, StockpileSnapshot>();
    this.#replenishments = new Map<string, ReplenishmentSnapshot>();
    this.#roadNetwork = createRoadNetwork(this.#config.roadNetwork);
    this.#reports = new Map<string, EmergencyReport>();
    this.#pendingReportEvaluations = new Map<string, PrivateReportEvaluation>();
    this.#reportEvaluations = new Map<string, PrivateReportEvaluation>();
    this.#environmentHistory = [];
    this.#infrastructure = new Map(createInitialInfrastructure(this.#runId).map((item) => [item.id, item]));
    this.#cascadeApplications = [];
    this.#secondaryOrigins = new Map<string, string>();
    this.#reservedIncidentIds = new Set<string>();
    this.#reservedResponderIds = new Set<string>();
    this.#reservedResponderCallsigns = new Set<string>();
    this.#reservedTaskIds = new Set<string>();
    this.#reservedTaskAssignmentIds = new Set<string>();
    this.#reservedResponderAssignmentIds = new Set<string>();
    this.#reservedTravelIds = new Set<string>();
    this.#reservedTravelTaskIds = new Set<string>();
    this.#reservedTravelResponderIds = new Set<string>();
    this.#reservedTravelRerouteIds = new Set<string>();
    this.#reservedMessageIds = new Set<string>();
    this.#reservedStockpileIds = new Set<string>();
    this.#reservedReplenishmentIds = new Set<string>();
    this.#reservedStockpileQuantities = new Map<string, Map<string, number>>();
    this.#reservedResponderReplenishment = new Map<string, Map<string, number>>();
    this.#eventIds = new Set<string>();
    this.#reportIds = new Set<string>();
    this.#eventHistory = [];
    this.#processedEventsById = new Map<string, ProcessedEventRecord>();
    this.#scheduledEventCount = 0;
    this.#reservedAutomaticAssignmentEventCount = 0;
    this.#reservedTravelChildEventCount = 0;
    this.#reservedCommunicationChildEventCount = 0;
    this.#reservedMessageAttemptEvents = new Map<string, number>();
    this.#scheduledCommunicationEventCount = 0;
    this.#scheduledResourceEventCount = 0;
    this.#reservedResourceChildEventCount = 0;
    this.#deliveryPlanner = new CommunicationDeliveryPlanner(this.#identityMaterial);
    this.#failure = undefined;
    this.#initializing = true;

    for (const incident of this.#config.initialIncidents) {
      this.#scheduleEvent({
        type: "INCIDENT_CREATE",
        scheduledTimeMs: this.#config.startTimeMs,
        priority: 0,
        payload: incident,
      });
    }
    for (const responder of this.#config.initialResponders) {
      this.#scheduleEvent({
        type: "RESPONDER_REGISTER",
        scheduledTimeMs: this.#config.startTimeMs,
        priority: 0,
        payload: responder,
      });
    }
    if (this.#config.resources.enabled) {
      for (const stockpile of this.#config.resources.initialStockpiles) {
        this.#scheduleEvent({ type: "STOCKPILE_REGISTER", scheduledTimeMs: this.#config.startTimeMs, priority: 0, payload: stockpile });
      }
    }
    while (!this.#queue.isEmpty) {
      this.#processNextEvent();
    }

    this.#initializing = false;
    if (this.#config.communication.enabled) {
      for (const record of this.#eventHistory) {
        if (record.event.type === "RESPONDER_REGISTER") {
          this.#scheduleOperationalMessageForChange(record.event, record.change);
        }
      }
    }

    this.#clock.pause();
    this.#status = "READY";
  }

  #scheduleEvent(request: SimulationEventRequest): SimulationEvent {
    if (typeof request !== "object" || request === null) {
      throw new SimulationEventError("Event request must be an object.");
    }
    if (
      this.#scheduledEventCount + this.#reservedAutomaticAssignmentEventCount >=
      this.#config.maxEventCount - this.#reservedTravelChildEventCount - this.#reservedCommunicationChildEventCount - this.#reservedResourceChildEventCount
    ) {
      throw new SimulationLimitError("Maximum event count has been reached.");
    }

    const scheduledTimeMs = request.scheduledTimeMs;
    const priority = request.priority ?? 0;
    if (!Number.isSafeInteger(scheduledTimeMs)) {
      throw new SimulationEventError("Event timestamp must be a safe integer.");
    }
    if (!Number.isSafeInteger(priority)) {
      throw new SimulationEventError("Event priority must be a safe integer.");
    }
    if (scheduledTimeMs < this.#clock.timeMs) {
      throw new SimulationEventError("Cannot schedule an event before current simulation time.");
    }
    if (scheduledTimeMs > this.#maximumTimeMs) {
      throw new SimulationLimitError("Event exceeds maximum simulation duration.");
    }

    const causeEventId = request.causeEventId;
    if (causeEventId !== undefined) {
      if (typeof causeEventId !== "string" || causeEventId.length === 0) {
        throw new SimulationEventError("causeEventId must be a non-empty string.");
      }
      const cause = this.#processedEventsById.get(causeEventId);
      if (cause === undefined) {
        throw new SimulationEventError("Causal references must identify a processed event.");
      }
      if (cause.event.scheduledTimeMs > scheduledTimeMs) {
        throw new SimulationEventError("An event cannot precede its causal event.");
      }
    }

    let event: SimulationEvent;

    switch (request.type) {
      case "INCIDENT_CREATE": {
        if (this.#reservedIncidentIds.size >= this.#config.maxIncidentCount) {
          throw new SimulationLimitError("Maximum incident count has been reached.");
        }
        const definition = validateIncidentDefinition(request.payload, "event.payload");
        const incidentId =
          definition.id ??
          this.#ids.nextIncidentId((candidate) => this.#reservedIncidentIds.has(candidate));
        if (this.#reservedIncidentIds.has(incidentId)) {
          throw new SimulationEventError(`Duplicate incident ID: ${incidentId}.`);
        }
        const id = this.#nextEventId();
        event = Object.freeze({
          id,
          scheduledTimeMs,
          priority,
          ...(causeEventId === undefined ? {} : { causeEventId }),
          type: request.type,
          relatedIncidentId: incidentId,
          payload: definition,
        });
        this.#reservedIncidentIds.add(incidentId);
        break;
      }
      case "INCIDENT_ACTIVATE":
      case "INCIDENT_STABILIZE":
      case "INCIDENT_RESOLVE": {
        const relatedIncidentId = this.#requireExistingIncident(request.relatedIncidentId);
        const id = this.#nextEventId();
        event = Object.freeze({
          id,
          scheduledTimeMs,
          priority,
          ...(causeEventId === undefined ? {} : { causeEventId }),
          type: request.type,
          relatedIncidentId,
          payload: Object.freeze({}),
        });
        break;
      }
      case "INCIDENT_SEVERITY_INCREASE":
      case "INCIDENT_SEVERITY_DECREASE": {
        const relatedIncidentId = this.#requireExistingIncident(request.relatedIncidentId);
        const amount = request.payload?.amount;
        if (!Number.isSafeInteger(amount) || amount <= 0) {
          throw new SimulationEventError("Severity change amount must be a positive safe integer.");
        }
        const id = this.#nextEventId();
        event = Object.freeze({
          id,
          scheduledTimeMs,
          priority,
          ...(causeEventId === undefined ? {} : { causeEventId }),
          type: request.type,
          relatedIncidentId,
          payload: Object.freeze({ amount }),
        });
        break;
      }
      case "RESPONDER_REGISTER": {
        if (this.#reservedResponderIds.size >= this.#config.maxResponderCount) {
          throw new SimulationLimitError("Maximum responder count has been reached.");
        }
        const definition = validateResponderDefinition(request.payload, "event.payload");
        if (definition.id !== undefined && this.#reservedResponderIds.has(definition.id)) {
          throw new SimulationEventError(`Duplicate responder ID: ${definition.id}.`);
        }
        if (
          definition.callsign !== undefined &&
          this.#reservedResponderCallsigns.has(definition.callsign)
        ) {
          throw new SimulationEventError(`Duplicate responder callsign: ${definition.callsign}.`);
        }
        const responderId =
          definition.id ??
          this.#ids.nextResponderId((candidate) => this.#reservedResponderIds.has(candidate));
        const callsign =
          definition.callsign ??
          this.#ids.nextResponderCallsign(
            definition.responderType,
            (candidate) => this.#reservedResponderCallsigns.has(candidate),
          );
        const id = this.#nextEventId();
        event = Object.freeze({
          id,
          scheduledTimeMs,
          priority,
          ...(causeEventId === undefined ? {} : { causeEventId }),
          type: request.type,
          relatedIncidentId: responderId,
          relatedResponderId: responderId,
          payload: Object.freeze({ ...definition, id: responderId, callsign }),
        });
        this.#reservedResponderIds.add(responderId);
        this.#reservedResponderCallsigns.add(callsign);
        break;
      }
      case "RESPONDER_STATE_TRANSITION": {
        const relatedResponderId = this.#requireExistingResponder(request.relatedResponderId);
        const targetState = request.payload?.targetState;
        if (!isResponderAvailabilityState(targetState)) {
          throw new SimulationEventError("Responder target state is not supported.");
        }
        if (this.#findOpenTravelForResponder(relatedResponderId) !== undefined) {
          throw new SimulationEventError(
            `Responder ${relatedResponderId} has active travel; interrupt or cancel it first.`,
          );
        }
        const id = this.#nextEventId();
        event = Object.freeze({
          id,
          scheduledTimeMs,
          priority,
          ...(causeEventId === undefined ? {} : { causeEventId }),
          type: request.type,
          relatedIncidentId: relatedResponderId,
          relatedResponderId,
          payload: Object.freeze({ targetState }),
        });
        break;
      }
      case "TASK_CREATE": {
        if (this.#reservedTaskIds.size >= this.#config.maxTaskCount) {
          throw new SimulationLimitError("Maximum task count has been reached.");
        }
        if (
          this.#config.automaticTaskAssignment &&
          this.#scheduledEventCount +
            this.#reservedAutomaticAssignmentEventCount +
            this.#reservedTravelChildEventCount +
            this.#reservedCommunicationChildEventCount +
            this.#reservedResourceChildEventCount +
            2 >
            this.#config.maxEventCount
        ) {
          throw new SimulationLimitError(
            "Automatic task assignment exceeds remaining event capacity.",
          );
        }
        const definition = validateTaskDefinition(request.payload, "event.payload");
        if (this.#config.resources.enabled) {
          for (const item of Object.keys(definition.requiredEquipment)) {
            if (this.#config.resources.resourceDefinitions[item] === undefined) throw new SimulationEventError(`Task resource ${item} has no configured resource definition.`);
          }
        }
        const relatedIncidentId = this.#requireExistingIncident(
          definition.relatedIncidentId,
        );
        if (definition.id !== undefined && this.#reservedTaskIds.has(definition.id)) {
          throw new SimulationEventError(`Duplicate task ID: ${definition.id}.`);
        }
        const taskId =
          definition.id ??
          this.#ids.nextTaskId((candidate) => this.#reservedTaskIds.has(candidate));
        const id = this.#nextEventId();
        event = Object.freeze({
          id,
          scheduledTimeMs,
          priority,
          ...(causeEventId === undefined ? {} : { causeEventId }),
          type: request.type,
          relatedIncidentId,
          relatedTaskId: taskId,
          payload: Object.freeze({ ...definition, id: taskId }),
        });
        this.#reservedTaskIds.add(taskId);
        break;
      }
      case "TASK_ASSIGN": {
        const task = this.#requireExistingTask(request.relatedTaskId);
        if (request.payload?.origin !== "SIMULATION_BASELINE") {
          throw new SimulationEventError(
            "Task assignments must use SIMULATION_BASELINE origin.",
          );
        }
        if (typeof request.payload.automatic !== "boolean") {
          throw new SimulationEventError("Task assignment mode must be specified.");
        }
        if (task.status !== "PENDING" || task.assignedResponderId !== undefined) {
          throw new SimulationEventError(`Task ${task.id} is not pending assignment.`);
        }
        if (this.#reservedTaskAssignmentIds.has(task.id)) {
          throw new SimulationEventError(`Task ${task.id} already has a pending assignment.`);
        }
        let responderId: string | undefined;
        if (request.payload.automatic) {
          if (request.payload.responderId !== undefined) {
            throw new SimulationEventError(
              "Automatic assignment cannot preselect a responder.",
            );
          }
        } else {
          responderId = this.#requireExistingResponder(request.payload.responderId);
          const unavailableIds = this.#activeAssignedResponderIds();
          for (const reservedId of this.#reservedResponderAssignmentIds) {
            unavailableIds.add(reservedId);
          }
          const responder = this.#responders.get(responderId)!;
          if (!isResponderQualifiedForTask(task, responder, unavailableIds)) {
            throw new SimulationEventError(
              `Responder ${responderId} is not eligible for task ${task.id}.`,
            );
          }
          if (!this.#isResponderResourceQualified(task, responder)) {
            throw new SimulationEventError(`Responder ${responderId} does not meet fatigue or equipment requirements for task ${task.id}.`);
          }
        }
        const id = this.#nextEventId();
        event = Object.freeze({
          id,
          scheduledTimeMs,
          priority,
          ...(causeEventId === undefined ? {} : { causeEventId }),
          type: request.type,
          relatedIncidentId: task.relatedIncidentId,
          relatedTaskId: task.id,
          payload: Object.freeze({
            ...(responderId === undefined ? {} : { responderId }),
            automatic: request.payload.automatic,
            origin: "SIMULATION_BASELINE" as const,
          }),
        });
        this.#reservedTaskAssignmentIds.add(task.id);
        if (responderId !== undefined) {
          this.#reservedResponderAssignmentIds.add(responderId);
        }
        break;
      }
      case "TASK_STATE_TRANSITION": {
        const task = this.#requireExistingTask(request.relatedTaskId);
        const targetStatus = request.payload?.targetStatus;
        if (!isTaskStatus(targetStatus) || targetStatus === "ASSIGNED") {
          throw new SimulationEventError(
            "Task target status is unsupported or requires an assignment event.",
          );
        }
        if (this.#config.resources.enabled && targetStatus === "IN_PROGRESS") {
          const reservation = this.#taskResources.get(task.id);
          if (reservation === undefined || reservation.status !== "RESERVED") throw new SimulationEventError(`Task ${task.id} has no active resource reservation.`);
        }
        if (
          this.#config.resources.enabled &&
          (targetStatus === "COMPLETED" || targetStatus === "FAILED" || targetStatus === "CANCELLED") &&
          task.assignedResponderId !== undefined
        ) {
          if (scheduledTimeMs + this.#config.resources.recoveryDurationMs > this.#maximumTimeMs) throw new SimulationLimitError("Recovery completion exceeds maximum simulation duration.");
          if (3 > this.#remainingEventCapacity) throw new SimulationLimitError("Task recovery exceeds remaining event capacity.");
          if (this.#scheduledResourceEventCount + this.#reservedResourceChildEventCount + 3 > this.#config.resources.maxResourceEvents) throw new SimulationLimitError("Task recovery exceeds remaining resource event capacity.");
          this.#reservedResourceChildEventCount += 3;
        }
        const id = this.#nextEventId();
        event = Object.freeze({
          id,
          scheduledTimeMs,
          priority,
          ...(causeEventId === undefined ? {} : { causeEventId }),
          type: request.type,
          relatedIncidentId: task.relatedIncidentId,
          relatedTaskId: task.id,
          payload: Object.freeze({ targetStatus }),
        });
        break;
      }
      case "RESPONDER_DEPART": {
        const task = this.#requireExistingTask(request.relatedTaskId);
        if (task.status !== "ASSIGNED" || task.assignedResponderId === undefined) {
          throw new SimulationEventError(`Task ${task.id} is not ready for departure.`);
        }
        const responder = this.#responders.get(task.assignedResponderId);
        if (responder === undefined || responder.availabilityState !== "RESERVED") {
          throw new SimulationEventError(
            `Responder ${task.assignedResponderId} is unavailable for departure.`,
          );
        }
        if (this.#findOpenTravelForTask(task.id) !== undefined) {
          throw new SimulationEventError(`Task ${task.id} already has an active travel attempt.`);
        }
        if (this.#reservedTravelTaskIds.has(task.id)) {
          throw new SimulationEventError(`Task ${task.id} already has a pending departure.`);
        }
        if (this.#findOpenTravelForResponder(responder.id) !== undefined) {
          throw new SimulationEventError(
            `Responder ${responder.id} already has an active travel attempt.`,
          );
        }
        if (this.#reservedTravelResponderIds.has(responder.id)) {
          throw new SimulationEventError(
            `Responder ${responder.id} already has a pending departure.`,
          );
        }
        if (this.#reservedTravelIds.size >= this.#config.maxTravelAttemptCount) {
          throw new SimulationLimitError("Maximum travel attempt count has been reached.");
        }
        const speed = request.payload?.responderSpeedUnitsPerSecond;
        const interval = request.payload?.progressIntervalMs;
        if (!Number.isSafeInteger(speed) || speed <= 0 || speed > 10_000) {
          throw new SimulationEventError(
            "Responder travel speed must be an integer from 1 to 10000.",
          );
        }
        if (!Number.isSafeInteger(interval) || interval <= 0) {
          throw new SimulationEventError(
            "Travel progress interval must be a positive safe integer.",
          );
        }
        if (
          this.#scheduledEventCount +
            this.#reservedAutomaticAssignmentEventCount +
            this.#reservedTravelChildEventCount +
            this.#reservedCommunicationChildEventCount +
            this.#reservedResourceChildEventCount +
            1 +
            MAX_TRAVEL_PROGRESS_EVENTS +
            1 >
          this.#config.maxEventCount
        ) {
          throw new SimulationLimitError(
            "Travel departure exceeds remaining event capacity.",
          );
        }
        const travelId = this.#ids.nextTravelId((candidate) =>
          this.#reservedTravelIds.has(candidate),
        );
        const id = this.#nextEventId();
        event = Object.freeze({
          id,
          scheduledTimeMs,
          priority,
          ...(causeEventId === undefined ? {} : { causeEventId }),
          type: request.type,
          relatedIncidentId: task.relatedIncidentId,
          relatedTaskId: task.id,
          relatedResponderId: responder.id,
          relatedTravelId: travelId,
          payload: Object.freeze({
            travelId,
            responderSpeedUnitsPerSecond: speed,
            progressIntervalMs: interval,
          }),
        });
        this.#reservedTravelIds.add(travelId);
        this.#reservedTravelTaskIds.add(task.id);
        this.#reservedTravelResponderIds.add(responder.id);
        this.#reservedTravelChildEventCount += MAX_TRAVEL_PROGRESS_EVENTS + 1;
        break;
      }
      case "TRAVEL_PROGRESS":
      case "RESPONDER_ARRIVE": {
        const travel = this.#requireExistingTravel(request.relatedTravelId);
        const routeVersion = request.payload?.routeVersion;
        if (!Number.isSafeInteger(routeVersion) || routeVersion < 1) {
          throw new SimulationEventError("Travel route version must be positive.");
        }
        const id = this.#nextEventId();
        event = Object.freeze({
          id,
          scheduledTimeMs,
          priority,
          ...(causeEventId === undefined ? {} : { causeEventId }),
          type: request.type,
          relatedIncidentId: this.#tasks.get(travel.taskId)!.relatedIncidentId,
          relatedTaskId: travel.taskId,
          relatedResponderId: travel.responderId,
          relatedTravelId: travel.id,
          payload: Object.freeze({ routeVersion }),
        });
        break;
      }
      case "TRAVEL_REROUTE": {
        const travel = this.#requireExistingTravel(request.relatedTravelId);
        const routeVersion = request.payload?.routeVersion;
        const retry = request.payload?.retry;
        if (!Number.isSafeInteger(routeVersion) || routeVersion < 1 || typeof retry !== "boolean") {
          throw new SimulationEventError("Travel reroute request is invalid.");
        }
        if (retry) {
          if (travel.status !== "BLOCKED" && travel.status !== "INTERRUPTED") {
            throw new SimulationEventError(`Travel ${travel.id} is not retryable.`);
          }
          if (travel.retryCount >= MAX_TRAVEL_RETRIES) {
            throw new SimulationLimitError("Maximum travel retry count has been reached.");
          }
        } else if (travel.rerouteCount >= MAX_TRAVEL_REROUTES) {
          throw new SimulationLimitError("Maximum travel reroute count has been reached.");
        }
        if (this.#reservedTravelRerouteIds.has(travel.id)) {
          throw new SimulationEventError(`Travel ${travel.id} already has a pending reroute.`);
        }
        if (
          this.#scheduledEventCount +
            this.#reservedAutomaticAssignmentEventCount +
            this.#reservedTravelChildEventCount +
            this.#reservedCommunicationChildEventCount +
            this.#reservedResourceChildEventCount +
            2 >
          this.#config.maxEventCount
        ) {
          throw new SimulationLimitError("Travel reroute exceeds remaining event capacity.");
        }
        const id = this.#nextEventId();
        event = Object.freeze({
          id,
          scheduledTimeMs,
          priority,
          ...(causeEventId === undefined ? {} : { causeEventId }),
          type: request.type,
          relatedIncidentId: this.#tasks.get(travel.taskId)!.relatedIncidentId,
          relatedTaskId: travel.taskId,
          relatedResponderId: travel.responderId,
          relatedTravelId: travel.id,
          payload: Object.freeze({ routeVersion, retry }),
        });
        this.#reservedTravelRerouteIds.add(travel.id);
        this.#reservedTravelChildEventCount += 1;
        break;
      }
      case "TRAVEL_BLOCKED": {
        const travel = this.#requireExistingTravel(request.relatedTravelId);
        const routeVersion = request.payload?.routeVersion;
        const retry = request.payload?.retry;
        if (!Number.isSafeInteger(routeVersion) || routeVersion < 1 || typeof retry !== "boolean") {
          throw new SimulationEventError("Travel blocked request is invalid.");
        }
        const id = this.#nextEventId();
        event = Object.freeze({
          id,
          scheduledTimeMs,
          priority,
          ...(causeEventId === undefined ? {} : { causeEventId }),
          type: request.type,
          relatedIncidentId: this.#tasks.get(travel.taskId)!.relatedIncidentId,
          relatedTaskId: travel.taskId,
          relatedResponderId: travel.responderId,
          relatedTravelId: travel.id,
          payload: Object.freeze({ routeVersion, retry }),
        });
        break;
      }
      case "TRAVEL_INTERRUPT": {
        const travel = this.#requireExistingTravel(request.relatedTravelId);
        if (travel.status !== "EN_ROUTE" && travel.status !== "BLOCKED") {
          throw new SimulationEventError(`Travel ${travel.id} cannot be interrupted.`);
        }
        const id = this.#nextEventId();
        event = Object.freeze({
          id,
          scheduledTimeMs,
          priority,
          ...(causeEventId === undefined ? {} : { causeEventId }),
          type: request.type,
          relatedIncidentId: this.#tasks.get(travel.taskId)!.relatedIncidentId,
          relatedTaskId: travel.taskId,
          relatedResponderId: travel.responderId,
          relatedTravelId: travel.id,
          payload: Object.freeze({}),
        });
        break;
      }
      case "ROAD_STATE_CHANGE": {
        const segmentId = request.payload?.segmentId;
        const state = request.payload?.state;
        if (
          typeof segmentId !== "string" ||
          !this.#roadNetwork.segments.some((segment) => segment.id === segmentId)
        ) {
          throw new SimulationEventError(`Road segment ${String(segmentId)} does not exist.`);
        }
        if (!isRoadAccessState(state)) {
          throw new SimulationEventError("Road access state is unsupported.");
        }
        const id = this.#nextEventId();
        event = Object.freeze({
          id,
          scheduledTimeMs,
          priority,
          ...(causeEventId === undefined ? {} : { causeEventId }),
          type: request.type,
          relatedIncidentId: "road_network",
          payload: Object.freeze({ segmentId, state }),
        });
        break;
      }
      case "COMMUNICATION_STATE_CHANGE": {
        if (!this.#config.communication.enabled) {
          throw new SimulationEventError("Communication simulation is disabled.");
        }
        if (this.#scheduledCommunicationEventCount + this.#reservedCommunicationChildEventCount >= this.#config.communication.maxCommunicationEvents) {
          throw new SimulationLimitError("Maximum communication event count has been reached.");
        }
        const relatedResponderId = this.#requireExistingResponder(request.relatedResponderId);
        const targetState = request.payload?.targetState;
        if (!isCommunicationState(targetState)) {
          throw new SimulationEventError("Communication target state is unsupported.");
        }
        const id = this.#nextEventId();
        event = Object.freeze({
          id, scheduledTimeMs, priority,
          ...(causeEventId === undefined ? {} : { causeEventId }),
          type: request.type,
          relatedIncidentId: relatedResponderId,
          relatedResponderId,
          payload: Object.freeze({ targetState }),
        });
        break;
      }
      case "OPERATIONAL_MESSAGE_CREATE": {
        if (!this.#config.communication.enabled) {
          throw new SimulationEventError("Communication simulation is disabled.");
        }
        if (this.#scheduledCommunicationEventCount + this.#reservedCommunicationChildEventCount >= this.#config.communication.maxCommunicationEvents) {
          throw new SimulationLimitError("Maximum communication event count has been reached.");
        }
        if (this.#config.communication.maxRetriesPerMessage + 2 > this.#remainingEventCapacity) {
          throw new SimulationLimitError("Operational message exceeds remaining event capacity.");
        }
        if (this.#scheduledCommunicationEventCount + this.#reservedCommunicationChildEventCount + this.#config.communication.maxRetriesPerMessage + 2 > this.#config.communication.maxCommunicationEvents) {
          throw new SimulationLimitError("Operational message exceeds remaining communication event capacity.");
        }
        const pendingCount = [...this.#operationalMessages.values()].filter((item) => item.deliveryStatus === "PENDING").length;
        if (pendingCount >= this.#config.communication.maxPendingMessages) {
          throw new SimulationLimitError("Maximum pending operational message count has been reached.");
        }
        const messageRequest = validateOperationalMessageRequest(request.payload);
        const relatedResponderId = this.#requireExistingResponder(messageRequest.responderId);
        if (messageRequest.relatedTaskId !== undefined) {
          const relatedTask = this.#requireExistingTask(messageRequest.relatedTaskId);
          if (relatedTask.assignedResponderId !== relatedResponderId) {
            throw new SimulationEventError(`Task ${relatedTask.id} is not assigned to responder ${relatedResponderId}.`);
          }
        }
        if ((messageRequest.submittedAtMs ?? messageRequest.observedAtMs) > scheduledTimeMs) {
          throw new SimulationEventError("Message creation cannot precede submission.");
        }
        const messageId = this.#ids.nextMessageId((candidate) => this.#reservedMessageIds.has(candidate));
        const id = this.#nextEventId();
        event = Object.freeze({
          id, scheduledTimeMs, priority,
          ...(causeEventId === undefined ? {} : { causeEventId }),
          type: request.type,
          relatedIncidentId: relatedResponderId,
          relatedResponderId,
          relatedMessageId: messageId,
          ...(messageRequest.relatedTaskId === undefined ? {} : { relatedTaskId: messageRequest.relatedTaskId }),
          payload: Object.freeze({ messageId, request: messageRequest }),
        });
        this.#reservedMessageIds.add(messageId);
        const reservedAttempts = this.#config.communication.maxRetriesPerMessage + 1;
        this.#reservedMessageAttemptEvents.set(messageId, reservedAttempts);
        this.#reservedCommunicationChildEventCount += reservedAttempts;
        break;
      }
      case "OPERATIONAL_MESSAGE_DELIVER":
      case "OPERATIONAL_MESSAGE_RETRY": {
        if (!this.#config.communication.enabled) throw new SimulationEventError("Communication simulation is disabled.");
        if (this.#scheduledCommunicationEventCount + this.#reservedCommunicationChildEventCount >= this.#config.communication.maxCommunicationEvents) throw new SimulationLimitError("Maximum communication event count has been reached.");
        const message = this.#operationalMessages.get(request.relatedMessageId);
        const attemptNumber = request.payload?.attemptNumber;
        if (message === undefined) throw new SimulationEventError(`Operational message ${String(request.relatedMessageId)} does not exist.`);
        if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1) throw new SimulationEventError("Message attempt number must be positive.");
        const id = this.#nextEventId();
        event = Object.freeze({
          id, scheduledTimeMs, priority,
          ...(causeEventId === undefined ? {} : { causeEventId }),
          type: request.type,
          relatedIncidentId: message.responderId,
          relatedResponderId: message.responderId,
          relatedMessageId: message.id,
          ...(message.relatedTaskId === undefined ? {} : { relatedTaskId: message.relatedTaskId }),
          payload: Object.freeze({ attemptNumber }),
        });
        break;
      }
      case "FATIGUE_UPDATE": {
        this.#assertResourceEventCapacity();
        const relatedResponderId = this.#requireExistingResponder(request.relatedResponderId);
        const targetMode = request.payload?.targetMode;
        if (targetMode !== undefined && !["INACTIVE", "TRAVEL", "WORK", "RECOVERY"].includes(targetMode)) throw new SimulationEventError("Fatigue target mode is unsupported.");
        const id = this.#nextEventId();
        event = Object.freeze({ id, scheduledTimeMs, priority, ...(causeEventId === undefined ? {} : { causeEventId }), type: request.type, relatedIncidentId: relatedResponderId, relatedResponderId, payload: Object.freeze({ ...(targetMode === undefined ? {} : { targetMode }) }) });
        break;
      }
      case "EQUIPMENT_FAIL":
      case "EQUIPMENT_REPAIR": {
        this.#assertResourceEventCapacity();
        const relatedResponderId = this.#requireExistingResponder(request.relatedResponderId);
        const item = request.payload?.item;
        const targetCondition = request.payload?.targetCondition;
        if (typeof item !== "string" || item.length === 0 || !isEquipmentCondition(targetCondition)) throw new SimulationEventError("Equipment event payload is invalid.");
        if (request.type === "EQUIPMENT_FAIL" && targetCondition !== "DEGRADED" && targetCondition !== "UNAVAILABLE") throw new SimulationEventError("Equipment failure target is invalid.");
        if (request.type === "EQUIPMENT_REPAIR" && targetCondition === "UNAVAILABLE") throw new SimulationEventError("Equipment repair target is invalid.");
        const cause = request.type === "EQUIPMENT_FAIL" ? request.payload.cause : undefined;
        if (request.type === "EQUIPMENT_FAIL" && (typeof cause !== "string" || cause.length === 0 || cause.length > 128)) throw new SimulationEventError("Equipment failure requires a simulated cause.");
        const resource = this.#responderResources.get(relatedResponderId);
        if (resource === undefined || !(item in resource.inventory)) throw new SimulationEventError(`Equipment ${item} does not exist for responder ${relatedResponderId}.`);
        const id = this.#nextEventId();
        event = Object.freeze({ id, scheduledTimeMs, priority, ...(causeEventId === undefined ? {} : { causeEventId }), type: request.type, relatedIncidentId: relatedResponderId, relatedResponderId, payload: Object.freeze({ item, targetCondition, ...(cause === undefined ? {} : { cause }) }) } as SimulationEvent);
        break;
      }
      case "TASK_RELEASE": {
        this.#assertResourceEventCapacity();
        const task = this.#requireExistingTask(request.relatedTaskId);
        if (!isTerminalTaskStatus(task.status) || task.assignedResponderId === undefined) throw new SimulationEventError(`Task ${task.id} is not ready for release.`);
        const id = this.#nextEventId();
        event = Object.freeze({ id, scheduledTimeMs, priority, ...(causeEventId === undefined ? {} : { causeEventId }), type: request.type, relatedIncidentId: task.relatedIncidentId, relatedTaskId: task.id, relatedResponderId: task.assignedResponderId, payload: Object.freeze({}) });
        break;
      }
      case "RECOVERY_START": {
        this.#assertResourceEventCapacity();
        const task = this.#requireExistingTask(request.relatedTaskId);
        const relatedResponderId = this.#requireExistingResponder(request.relatedResponderId);
        if (!isTerminalTaskStatus(task.status) || task.assignedResponderId !== relatedResponderId) throw new SimulationEventError("Recovery start prerequisites are invalid.");
        const id = this.#nextEventId();
        event = Object.freeze({ id, scheduledTimeMs, priority, ...(causeEventId === undefined ? {} : { causeEventId }), type: request.type, relatedIncidentId: task.relatedIncidentId, relatedTaskId: task.id, relatedResponderId, payload: Object.freeze({}) });
        break;
      }
      case "RECOVERY_COMPLETE": {
        this.#assertResourceEventCapacity();
        const relatedResponderId = this.#requireExistingResponder(request.relatedResponderId);
        const recoveryStartedEventId = request.payload?.recoveryStartedEventId;
        if (typeof recoveryStartedEventId !== "string" || recoveryStartedEventId.length === 0) throw new SimulationEventError("Recovery completion requires its start event ID.");
        const id = this.#nextEventId();
        event = Object.freeze({ id, scheduledTimeMs, priority, ...(causeEventId === undefined ? {} : { causeEventId }), type: request.type, relatedIncidentId: relatedResponderId, relatedResponderId, payload: Object.freeze({ recoveryStartedEventId }) });
        break;
      }
      case "STOCKPILE_REGISTER": {
        this.#assertResourceEventCapacity();
        if (this.#reservedStockpileIds.size >= this.#config.resources.maxStockpileCount) throw new SimulationLimitError("Maximum stockpile count has been reached.");
        const definition = validateStockpileDefinition(request.payload, "event.payload");
        if (this.#reservedStockpileIds.has(definition.id)) throw new SimulationEventError(`Duplicate stockpile ID: ${definition.id}.`);
        const id = this.#nextEventId();
        event = Object.freeze({ id, scheduledTimeMs, priority, ...(causeEventId === undefined ? {} : { causeEventId }), type: request.type, relatedIncidentId: definition.id, payload: definition });
        this.#reservedStockpileIds.add(definition.id);
        break;
      }
      case "REPLENISHMENT_REQUEST": {
        const relatedResponderId = this.#requireExistingResponder(request.relatedResponderId);
        const stockpileId = request.payload?.stockpileId;
        const stockpile = typeof stockpileId === "string" ? this.#stockpiles.get(stockpileId) : undefined;
        if (stockpile === undefined) throw new SimulationEventError(`Stockpile ${String(stockpileId)} does not exist.`);
        const quantities = validateTransferQuantities(request.payload.quantities, this.#config.resources.maxReplenishmentAmount);
        const delayMs = request.payload.delayMs ?? this.#config.resources.defaultReplenishmentDelayMs;
        if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > this.#config.resources.maxReplenishmentDelayMs) throw new SimulationEventError("Replenishment delay is out of bounds.");
        if (scheduledTimeMs + delayMs > this.#maximumTimeMs) throw new SimulationLimitError("Replenishment completion exceeds maximum duration.");
        const failureReason = this.#replenishmentFailureReason(stockpile, relatedResponderId, quantities);
        this.#assertResourceEventCapacity(failureReason === undefined ? 2 : 1);
        const replenishmentId = this.#ids.nextReplenishmentId((candidate) => this.#reservedReplenishmentIds.has(candidate));
        const id = this.#nextEventId();
        event = Object.freeze({ id, scheduledTimeMs, priority, ...(causeEventId === undefined ? {} : { causeEventId }), type: request.type, relatedIncidentId: relatedResponderId, relatedResponderId, relatedReplenishmentId: replenishmentId, payload: Object.freeze({ stockpileId, quantities, delayMs, ...(failureReason === undefined ? {} : { failureReason }) }) });
        this.#reservedReplenishmentIds.add(replenishmentId);
        if (failureReason === undefined) {
          this.#reserveReplenishment(stockpileId, relatedResponderId, quantities);
          this.#reservedResourceChildEventCount += 1;
        }
        break;
      }
      case "REPLENISHMENT_COMPLETE": {
        this.#assertResourceEventCapacity();
        const replenishment = this.#replenishments.get(request.relatedReplenishmentId);
        if (replenishment === undefined) throw new SimulationEventError(`Replenishment ${String(request.relatedReplenishmentId)} does not exist.`);
        const id = this.#nextEventId();
        event = Object.freeze({ id, scheduledTimeMs, priority, ...(causeEventId === undefined ? {} : { causeEventId }), type: request.type, relatedIncidentId: replenishment.responderId, relatedResponderId: replenishment.responderId, relatedReplenishmentId: replenishment.id, payload: Object.freeze({}) });
        break;
      }
      default:
        throw new SimulationEventError("Unknown event type.");
    }

    this.#queue.enqueue({ timestampMs: scheduledTimeMs, priority, value: event });
    this.#recordQueueDepth();
    this.#eventIds.add(event.id);
    this.#scheduledEventCount += 1;
    if (
      event.type === "COMMUNICATION_STATE_CHANGE" ||
      event.type === "OPERATIONAL_MESSAGE_CREATE" ||
      event.type === "OPERATIONAL_MESSAGE_DELIVER" ||
      event.type === "OPERATIONAL_MESSAGE_RETRY"
    ) this.#scheduledCommunicationEventCount += 1;
    if (isResourceEventType(event.type)) this.#scheduledResourceEventCount += 1;
    if (event.type === "TASK_CREATE" && this.#config.automaticTaskAssignment) {
      this.#reservedAutomaticAssignmentEventCount += 1;
    }
    return event;
  }

  #nextEventId(): string {
    const id = this.#ids.nextEventId();
    if (this.#eventIds.has(id)) {
      throw new SimulationEventError(`Duplicate generated event ID: ${id}.`);
    }
    return id;
  }

  #scheduleReportEvent(
    report: EmergencyReport,
    evaluation: PrivateReportEvaluation,
  ): SimulationEvent {
    if (this.#reportIds.has(report.id)) {
      throw new SimulationEventError(`Duplicate report ID: ${report.id}.`);
    }
    if (!this.#incidents.has(report.internalIncidentId)) {
      throw new SimulationEventError(`Incident ${report.internalIncidentId} does not exist.`);
    }
    const id = this.#nextEventId();
    const event: SimulationEvent = Object.freeze({
      id,
      scheduledTimeMs: report.receivedAtMs,
      priority: 0,
      type: "REPORT_CREATE",
      relatedIncidentId: report.internalIncidentId,
      payload: report,
    });
    this.#queue.enqueue({
      timestampMs: event.scheduledTimeMs,
      priority: event.priority,
      value: event,
    });
    this.#recordQueueDepth();
    this.#eventIds.add(event.id);
    this.#reportIds.add(report.id);
    this.#pendingReportEvaluations.set(report.id, evaluation);
    this.#scheduledEventCount += 1;
    return event;
  }

  #recordQueueDepth(): void {
    this.#peakPendingEventCount = Math.max(this.#peakPendingEventCount, this.#queue.size);
  }

  #processNextEvent(): ProcessedEventRecord | undefined {
    const queued = this.#queue.dequeue();
    if (queued === undefined) {
      return undefined;
    }
    const event = queued.value;

    try {
      if (event.scheduledTimeMs < this.#clock.timeMs) {
        throw new SimulationEventError("Queued event timestamp is before current simulation time.");
      }
      if (
        event.causeEventId !== undefined &&
        !this.#processedEventsById.has(event.causeEventId)
      ) {
        throw new SimulationEventError("Event causal reference is no longer valid.");
      }

      this.#advanceClockTo(event.scheduledTimeMs);

      let incident: IncidentSnapshot | undefined;
      let responder: ResponderSnapshot | undefined;
      let task: TaskSnapshot | undefined;
      let travel: TravelSnapshot | undefined;
      let communication: ResponderCommunicationSnapshot | undefined;
      let operationalMessage: OperationalMessageSnapshot | undefined;
      let operationalObservation: PublicOperationalObservation | undefined;
      let responderResource: ResponderResourceSnapshot | undefined;
      let taskResource: TaskResourceSnapshot | undefined;
      let stockpile: StockpileSnapshot | undefined;
      let replenishment: ReplenishmentSnapshot | undefined;
      let scheduleMessageAttempt = false;
      let retryMessageAttempt = false;
      let roadNetwork: RoadNetworkSnapshot | undefined;
      let changedRoadSegmentIds: readonly string[] = [];
      let scheduleDepartureChildren = false;
      let rerouteOutcome: "ARRIVE" | "BLOCK" | undefined;
      let rerouteRetry = false;
      let report: EmergencyReport | undefined;
      let reportEvaluation: PrivateReportEvaluation | undefined;
      let change: Readonly<SimulationChange>;
      if (event.type === "INCIDENT_CREATE") {
        const result = this.#applyCreation(event);
        incident = freezeIncidentSnapshot(result.incident);
        change = Object.freeze({ ...result.change });
      } else if (event.type === "RESPONDER_REGISTER") {
        const result = this.#applyResponderRegistration(event);
        responder = freezeResponderSnapshot(result.responder);
        communication = initialCommunicationState(responder, this.#config.communication, event.id, event.scheduledTimeMs);
        if (this.#config.resources.enabled) responderResource = createResponderResource(responder, this.#config.resources, event.id, event.scheduledTimeMs);
        change = result.change;
      } else if (event.type === "RESPONDER_STATE_TRANSITION") {
        const result = this.#applyResponderStateTransition(event);
        responder = freezeResponderSnapshot(result.responder);
        change = result.change;
      } else if (event.type === "TASK_CREATE") {
        const result = this.#applyTaskCreation(event);
        task = freezeTaskSnapshot(result.task);
        change = result.change;
      } else if (event.type === "TASK_ASSIGN") {
        const result = this.#applyTaskAssignment(event);
        task = freezeTaskSnapshot(result.task);
        responder =
          result.responder === undefined
            ? undefined
            : freezeResponderSnapshot(result.responder);
        change = result.change;
        if (this.#config.resources.enabled && result.responder !== undefined && result.task.assignedResponderId === result.responder.id) {
          const currentResource = this.#requireResponderResource(result.responder.id);
          const reserved = reserveTaskResources(result.task, currentResource, this.#config.resources, event.id, event.scheduledTimeMs);
          responderResource = reserved.responder;
          taskResource = reserved.reservation;
        }
      } else if (event.type === "TASK_STATE_TRANSITION") {
        const result = this.#applyTaskStateTransition(event);
        task = freezeTaskSnapshot(result.task);
        responder = result.responder;
        travel = result.travel;
        change = result.change;
        if (this.#config.resources.enabled && task.assignedResponderId !== undefined) {
          const currentResource = this.#requireResponderResource(task.assignedResponderId);
          if (task.status === "IN_PROGRESS") {
            const reservation = this.#taskResources.get(task.id);
            if (reservation === undefined) throw new SimulationEventError(`Task ${task.id} resource reservation is missing.`);
            if (!this.#taskResourcesExecutable(task, currentResource)) throw new SimulationEventError(`Task ${task.id} cannot start with unavailable equipment or supplies.`);
            const consumed = consumeTaskResources(currentResource, reservation, event.id, event.scheduledTimeMs);
            responderResource = advanceResponderFatigue(consumed.responder, event.scheduledTimeMs, event.id, this.#config.resources, "WORK", event.causeEventId);
            taskResource = consumed.reservation;
            if (responder !== undefined) responder = this.#withResourceInventory(responder, responderResource.inventory);
          } else if (isTerminalTaskStatus(task.status)) {
            responderResource = advanceResponderFatigue(currentResource, event.scheduledTimeMs, event.id, this.#config.resources, currentResource.fatigueMode, event.causeEventId);
          }
        }
      } else if (event.type === "RESPONDER_DEPART") {
        const result = this.#applyResponderDeparture(event);
        task = result.task;
        responder = result.responder;
        travel = result.travel;
        scheduleDepartureChildren = travel.status === "EN_ROUTE";
        change = result.change;
        if (this.#config.resources.enabled && travel.status === "EN_ROUTE") responderResource = advanceResponderFatigue(this.#requireResponderResource(event.relatedResponderId), event.scheduledTimeMs, event.id, this.#config.resources, "TRAVEL", event.causeEventId);
      } else if (event.type === "TRAVEL_PROGRESS") {
        const result = this.#applyTravelProgress(event);
        travel = result.travel;
        change = result.change;
        if (this.#config.resources.enabled && "kind" in result.change && result.change.kind === "TRAVEL_PROGRESSED") responderResource = advanceResponderFatigue(this.#requireResponderResource(event.relatedResponderId), event.scheduledTimeMs, event.id, this.#config.resources);
      } else if (event.type === "TRAVEL_REROUTE") {
        const result = this.#applyTravelReroute(event);
        travel = result.travel;
        task = result.task;
        responder = result.responder;
        rerouteOutcome = result.outcome;
        rerouteRetry = event.payload.retry;
        change = result.change;
        if (this.#config.resources.enabled && "kind" in result.change && result.change.kind === "TRAVEL_REROUTED") responderResource = advanceResponderFatigue(this.#requireResponderResource(event.relatedResponderId), event.scheduledTimeMs, event.id, this.#config.resources, "TRAVEL", event.causeEventId);
      } else if (event.type === "RESPONDER_ARRIVE") {
        const result = this.#applyResponderArrival(event);
        travel = result.travel;
        responder = result.responder;
        change = result.change;
        if (this.#config.resources.enabled && travel.status === "ARRIVED") responderResource = advanceResponderFatigue(this.#requireResponderResource(event.relatedResponderId), event.scheduledTimeMs, event.id, this.#config.resources, "INACTIVE", event.causeEventId);
      } else if (event.type === "TRAVEL_BLOCKED") {
        const result = this.#applyTravelBlocked(event);
        travel = result.travel;
        change = result.change;
        if (this.#config.resources.enabled && travel.status === "BLOCKED") responderResource = advanceResponderFatigue(this.#requireResponderResource(event.relatedResponderId), event.scheduledTimeMs, event.id, this.#config.resources, "INACTIVE", event.causeEventId);
      } else if (event.type === "TRAVEL_INTERRUPT") {
        const result = this.#applyTravelInterruption(event);
        travel = result.travel;
        change = result.change;
        if (this.#config.resources.enabled) responderResource = advanceResponderFatigue(this.#requireResponderResource(event.relatedResponderId), event.scheduledTimeMs, event.id, this.#config.resources, "INACTIVE", event.causeEventId);
      } else if (event.type === "ROAD_STATE_CHANGE") {
        this.#assertRoadRerouteCapacity([event.payload.segmentId], event.scheduledTimeMs);
        const result = updateRoadSegmentState(
          this.#roadNetwork,
          event.payload.segmentId,
          event.payload.state,
          event.id,
          event.scheduledTimeMs,
          event.causeEventId,
        );
        roadNetwork = result.network;
        changedRoadSegmentIds = Object.freeze([event.payload.segmentId]);
        change = result.change;
      } else if (event.type === "COMMUNICATION_STATE_CHANGE") {
        const current = this.#communications.get(event.relatedResponderId);
        if (current === undefined) throw new SimulationEventError(`Communication state for responder ${event.relatedResponderId} does not exist.`);
        const result = transitionCommunicationState(current, event.payload.targetState, event.id, event.scheduledTimeMs, event.causeEventId);
        communication = result.communication;
        change = result.change;
      } else if (event.type === "OPERATIONAL_MESSAGE_CREATE") {
        if (this.#operationalMessages.has(event.relatedMessageId)) throw new SimulationEventError(`Operational message ${event.relatedMessageId} already exists.`);
        operationalMessage = createOperationalMessage(event.relatedMessageId, event.payload.request, event.causeEventId);
        scheduleMessageAttempt = true;
        change = this.#messageChange("OPERATIONAL_MESSAGE_CREATED", operationalMessage);
      } else if (event.type === "OPERATIONAL_MESSAGE_DELIVER" || event.type === "OPERATIONAL_MESSAGE_RETRY") {
        const result = this.#applyOperationalMessageAttempt(event);
        operationalMessage = result.message;
        operationalObservation = result.observation;
        retryMessageAttempt = result.retry;
        if (!result.retry) this.#releaseReservedMessageAttempts(event.relatedMessageId);
        change = result.change;
      } else if (event.type === "FATIGUE_UPDATE") {
        responderResource = advanceResponderFatigue(this.#requireResponderResource(event.relatedResponderId), event.scheduledTimeMs, event.id, this.#config.resources, event.payload.targetMode, event.causeEventId);
        change = resourceChange("FATIGUE_UPDATED", { responderId: event.relatedResponderId });
      } else if (event.type === "EQUIPMENT_FAIL" || event.type === "EQUIPMENT_REPAIR") {
        responderResource = changeEquipmentCondition(this.#requireResponderResource(event.relatedResponderId), event.payload.item, event.payload.targetCondition, event.id, event.scheduledTimeMs, event.causeEventId, event.type === "EQUIPMENT_FAIL" ? event.payload.cause : undefined);
        change = resourceChange("EQUIPMENT_CHANGED", { responderId: event.relatedResponderId, reason: event.type === "EQUIPMENT_FAIL" ? event.payload.cause : event.payload.targetCondition });
      } else if (event.type === "TASK_RELEASE") {
        const result = this.#applyTaskRelease(event);
        responderResource = result.responderResource;
        taskResource = result.taskResource;
        change = result.change;
      } else if (event.type === "RECOVERY_START") {
        const result = this.#applyRecoveryStart(event);
        responder = result.responder;
        responderResource = result.responderResource;
        change = result.change;
      } else if (event.type === "RECOVERY_COMPLETE") {
        const result = this.#applyRecoveryComplete(event);
        responder = result.responder;
        responderResource = result.responderResource;
        change = result.change;
      } else if (event.type === "STOCKPILE_REGISTER") {
        if (this.#stockpiles.has(event.payload.id)) throw new SimulationEventError(`Stockpile ${event.payload.id} already exists.`);
        stockpile = createStockpile(event.payload, event.id, event.scheduledTimeMs, event.causeEventId);
        change = resourceChange("STOCKPILE_REGISTERED", { stockpileId: stockpile.id });
      } else if (event.type === "REPLENISHMENT_REQUEST") {
        replenishment = freezeReplenishment({ id: event.relatedReplenishmentId, stockpileId: event.payload.stockpileId, responderId: event.relatedResponderId, quantities: event.payload.quantities, requestedAtMs: event.scheduledTimeMs, scheduledCompletionAtMs: event.scheduledTimeMs + event.payload.delayMs, status: event.payload.failureReason === undefined ? "PENDING" : "FAILED", eventHistoryIds: [event.id], ...(event.payload.failureReason === undefined ? {} : { failureReason: event.payload.failureReason }) });
        change = resourceChange("REPLENISHMENT_REQUESTED", { responderId: event.relatedResponderId, stockpileId: event.payload.stockpileId, replenishmentId: event.relatedReplenishmentId, ...(event.payload.failureReason === undefined ? {} : { reason: event.payload.failureReason }) });
      } else if (event.type === "REPLENISHMENT_COMPLETE") {
        const result = this.#applyReplenishmentComplete(event);
        responder = result.responder;
        responderResource = result.responderResource;
        stockpile = result.stockpile;
        replenishment = result.replenishment;
        change = result.change;
      } else if (event.type === "REPORT_CREATE") {
        const result = this.#applyReport(event);
        report = result.report;
        reportEvaluation = result.evaluation;
        change = Object.freeze({
          kind: "REPORT_CREATED",
          reportId: report.id,
          internalIncidentId: report.internalIncidentId,
        });
      } else if (event.type === "EVOLUTION_APPLY") {
        changedRoadSegmentIds = this.#linkedRoadSegmentIdsForEvolution(event);
        this.#assertRoadRerouteCapacity(changedRoadSegmentIds, event.scheduledTimeMs);
        this.#applyEvolution(event);
        roadNetwork = this.#applyEvolutionRoadChanges(event);
        change = Object.freeze({ kind: "EVOLUTION_APPLIED", incidentId: event.relatedIncidentId, ruleIds: event.payload.ruleIds });
      } else {
        const result = this.#applyTransition(event);
        incident = freezeIncidentSnapshot(result.incident);
        change = Object.freeze({ ...result.change });
      }
      const record = Object.freeze({
        event,
        processedAtMs: this.#clock.timeMs,
        change,
      });

      if (incident !== undefined) {
        this.#incidents.set(incident.id, incident);
      }
      if (responder !== undefined) {
        this.#responders.set(responder.id, responder);
      }
      if (task !== undefined) {
        this.#tasks.set(task.id, task);
      }
      if (travel !== undefined) {
        this.#travels.set(travel.id, freezeTravelSnapshot(travel));
      }
      if (communication !== undefined) this.#communications.set(communication.responderId, freezeCommunicationState(communication));
      if (operationalMessage !== undefined) this.#operationalMessages.set(operationalMessage.id, freezeOperationalMessage(operationalMessage));
      if (operationalObservation !== undefined) {
        this.#publicOperationalObservations.push(operationalObservation);
        this.#commandCenterKnowledge.set(
          operationalObservation.responderId,
          updateCommandCenterKnowledge(this.#commandCenterKnowledge.get(operationalObservation.responderId), operationalObservation),
        );
      }
      if (responderResource !== undefined) this.#responderResources.set(responderResource.responderId, freezeResponderResource(responderResource));
      if (taskResource !== undefined) this.#taskResources.set(taskResource.taskId, freezeTaskResource(taskResource));
      if (stockpile !== undefined) this.#stockpiles.set(stockpile.id, freezeStockpile(stockpile));
      if (replenishment !== undefined) this.#replenishments.set(replenishment.id, freezeReplenishment(replenishment));
      if (roadNetwork !== undefined) {
        this.#roadNetwork = roadNetwork;
      }
      if (report !== undefined) {
        this.#reports.set(report.id, report);
      }
      if (reportEvaluation !== undefined) {
        this.#pendingReportEvaluations.delete(reportEvaluation.reportId);
        this.#reportEvaluations.set(reportEvaluation.reportId, reportEvaluation);
      }
      this.#eventHistory.push(record);
      this.#processedEventsById.set(event.id, record);
      if (scheduleMessageAttempt && operationalMessage !== undefined) {
        this.#scheduleNextMessageAttempt(operationalMessage, event.id, false);
      }
      if (retryMessageAttempt && operationalMessage !== undefined) {
        this.#scheduleNextMessageAttempt(operationalMessage, event.id, true);
      }
      if (event.type === "TASK_CREATE" && this.#config.automaticTaskAssignment) {
        this.#reservedAutomaticAssignmentEventCount -= 1;
        this.#scheduleEvent({
          type: "TASK_ASSIGN",
          scheduledTimeMs: event.scheduledTimeMs,
          priority: taskAssignmentEventPriority(event.payload.priority),
          causeEventId: event.id,
          relatedTaskId: event.relatedTaskId,
          payload: {
            automatic: true,
            origin: "SIMULATION_BASELINE",
          },
        });
      }
      if (event.type === "RESPONDER_DEPART") {
        this.#reservedTravelTaskIds.delete(event.relatedTaskId);
        this.#reservedTravelResponderIds.delete(event.relatedResponderId);
        this.#reservedTravelChildEventCount -= MAX_TRAVEL_PROGRESS_EVENTS + 1;
        if (scheduleDepartureChildren && travel !== undefined) {
          this.#scheduleTravelChildren(travel, event.id, true);
        }
      }
      if (event.type === "TRAVEL_REROUTE") {
        this.#reservedTravelRerouteIds.delete(event.relatedTravelId);
        this.#reservedTravelChildEventCount -= 1;
        if (rerouteOutcome !== undefined && travel !== undefined) {
          if (rerouteOutcome === "ARRIVE") {
            this.#scheduleTravelArrival(travel, event.id);
          } else {
            this.#scheduleEvent({
              type: "TRAVEL_BLOCKED",
              scheduledTimeMs: event.scheduledTimeMs,
              priority: event.priority,
              causeEventId: event.id,
              relatedTravelId: event.relatedTravelId,
              payload: { routeVersion: event.payload.routeVersion, retry: rerouteRetry },
            });
          }
        }
      }
      if (
        event.type === "TASK_STATE_TRANSITION" &&
        this.#config.resources.enabled &&
        isTerminalTaskStatus(event.payload.targetStatus) &&
        task?.assignedResponderId !== undefined
      ) {
        this.#reservedResourceChildEventCount -= 1;
        this.#scheduleEvent({ type: "TASK_RELEASE", scheduledTimeMs: event.scheduledTimeMs, priority: 15, causeEventId: event.id, relatedTaskId: task.id, payload: {} });
      }
      if (event.type === "TASK_RELEASE") {
        this.#reservedResourceChildEventCount -= 1;
        this.#scheduleEvent({ type: "RECOVERY_START", scheduledTimeMs: event.scheduledTimeMs, priority: 16, causeEventId: event.id, relatedTaskId: event.relatedTaskId, relatedResponderId: event.relatedResponderId, payload: {} });
      }
      if (event.type === "RECOVERY_START") {
        this.#reservedResourceChildEventCount -= 1;
        const completionAt = event.scheduledTimeMs + this.#config.resources.recoveryDurationMs;
        if (completionAt > this.#maximumTimeMs) throw new SimulationLimitError("Recovery completion exceeds maximum simulation duration.");
        this.#scheduleEvent({ type: "RECOVERY_COMPLETE", scheduledTimeMs: completionAt, priority: 16, causeEventId: event.id, relatedResponderId: event.relatedResponderId, payload: { recoveryStartedEventId: event.id } });
      }
      if (event.type === "REPLENISHMENT_REQUEST" && replenishment?.status === "PENDING") {
        this.#reservedResourceChildEventCount -= 1;
        this.#scheduleEvent({ type: "REPLENISHMENT_COMPLETE", scheduledTimeMs: replenishment.scheduledCompletionAtMs, priority: 10, causeEventId: event.id, relatedReplenishmentId: replenishment.id, payload: {} });
      }
      if (event.type === "REPLENISHMENT_COMPLETE") this.#releaseReplenishmentReservation(event.relatedReplenishmentId);
      if (changedRoadSegmentIds.length > 0) {
        this.#scheduleAffectedTravelReroutes(
          changedRoadSegmentIds,
          event.scheduledTimeMs,
          event.id,
        );
      }
      if (event.type === "EVOLUTION_APPLY") this.#scheduleCommunicationInfrastructureChanges(event);
      this.#scheduleOperationalMessageForChange(event, change);
      return record;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#clock.pause();
      this.#status = "FAILED";
      this.#failure = Object.freeze({
        eventId: event.id,
        message,
        failedAtMs: this.#clock.timeMs,
      });
      throw new SimulationEventError(`Event ${event.id} failed: ${message}`);
    }
  }

  #applyCreation(event: Extract<SimulationEvent, { type: "INCIDENT_CREATE" }>): {
    incident: IncidentSnapshot;
    change: IncidentChange;
  } {
    if (this.#incidents.has(event.relatedIncidentId)) {
      throw new SimulationEventError(`Incident ${event.relatedIncidentId} already exists.`);
    }
    return createIncident(
      event.relatedIncidentId,
      event.payload,
      event.id,
      event.scheduledTimeMs,
    );
  }

  #messageChange(
    kind: OperationalMessageChange["kind"],
    message: OperationalMessageSnapshot,
    reason?: string,
  ): OperationalMessageChange {
    return Object.freeze({
      kind,
      messageId: message.id,
      responderId: message.responderId,
      deliveryStatus: message.deliveryStatus,
      attemptCount: message.attemptCount,
      ...(reason === undefined ? {} : { reason }),
    });
  }

  #assertResourceEventCapacity(required = 1): void {
    if (!this.#config.resources.enabled) throw new SimulationEventError("Resource simulation is disabled.");
    if (this.#scheduledResourceEventCount + this.#reservedResourceChildEventCount + required > this.#config.resources.maxResourceEvents) throw new SimulationLimitError("Maximum resource event count has been reached.");
    if (required > this.#remainingEventCapacity) throw new SimulationLimitError("Resource event exceeds remaining event capacity.");
  }

  #requireResponderResource(responderId: string): ResponderResourceSnapshot {
    const resource = this.#responderResources.get(responderId);
    if (resource === undefined) throw new SimulationEventError(`Resource state for responder ${responderId} does not exist.`);
    return resource;
  }

  #isResponderResourceQualified(task: TaskSnapshot, responder: ResponderSnapshot): boolean {
    if (!this.#config.resources.enabled) return true;
    const resource = this.#responderResources.get(responder.id);
    if (resource === undefined || resource.fatigue >= this.#config.resources.assignmentFatigueThreshold) return false;
    return Object.entries(task.requiredEquipment).every(([item, quantity]) => {
      const condition = resource.equipmentConditions[item] ?? "OPERATIONAL";
      return (resource.inventory[item] ?? 0) >= quantity && condition !== "UNAVAILABLE" && condition !== "UNDER_REPAIR";
    });
  }

  #taskResourcesExecutable(task: TaskSnapshot, resource: ResponderResourceSnapshot): boolean {
    return Object.entries(task.requiredEquipment).every(([item, quantity]) => {
      const condition = resource.equipmentConditions[item] ?? "OPERATIONAL";
      return (resource.inventory[item] ?? 0) >= quantity && condition !== "UNAVAILABLE" && condition !== "UNDER_REPAIR";
    });
  }

  #withResourceInventory(responder: ResponderSnapshot, inventory: Readonly<Record<string, number>>): ResponderSnapshot {
    return freezeResponderSnapshot({ ...responder, equipmentInventory: Object.freeze({ ...inventory }) });
  }

  #applyTaskRelease(event: Extract<SimulationEvent, { type: "TASK_RELEASE" }>): { responderResource: ResponderResourceSnapshot; taskResource?: TaskResourceSnapshot; change: ResourceChange } {
    const current = this.#requireResponderResource(event.relatedResponderId);
    const reservation = this.#taskResources.get(event.relatedTaskId);
    if (reservation === undefined) return { responderResource: current, change: resourceChange("TASK_RELEASED", { responderId: event.relatedResponderId, taskId: event.relatedTaskId, reason: "NO_RESERVATION" }) };
    const released = releaseTaskResources(current, reservation, event.id, event.scheduledTimeMs);
    return { responderResource: released.responder, taskResource: released.reservation, change: resourceChange("TASK_RELEASED", { responderId: event.relatedResponderId, taskId: event.relatedTaskId }) };
  }

  #applyRecoveryStart(event: Extract<SimulationEvent, { type: "RECOVERY_START" }>): { responder: ResponderSnapshot; responderResource: ResponderResourceSnapshot; change: ResourceChange } {
    const responder = this.#responders.get(event.relatedResponderId);
    if (responder === undefined) throw new SimulationEventError(`Responder ${event.relatedResponderId} does not exist.`);
    if (responder.availabilityState === "RECOVERING") return { responder, responderResource: this.#requireResponderResource(responder.id), change: resourceChange("RESOURCE_EVENT_IGNORED", { responderId: responder.id, taskId: event.relatedTaskId, reason: "ALREADY_RECOVERING" }) };
    if (!["RESERVED", "EN_ROUTE", "ON_SCENE", "BUSY"].includes(responder.availabilityState)) return { responder, responderResource: this.#requireResponderResource(responder.id), change: resourceChange("RESOURCE_EVENT_IGNORED", { responderId: responder.id, taskId: event.relatedTaskId, reason: "RECOVERY_SUPERSEDED" }) };
    const transitioned = applyResponderTransition(responder, "RECOVERING", event.id, event.scheduledTimeMs).responder;
    const resource = advanceResponderFatigue(this.#requireResponderResource(responder.id), event.scheduledTimeMs, event.id, this.#config.resources, "RECOVERY", event.causeEventId);
    return { responder: transitioned, responderResource: resource, change: resourceChange("RECOVERY_STARTED", { responderId: responder.id, taskId: event.relatedTaskId }) };
  }

  #applyRecoveryComplete(event: Extract<SimulationEvent, { type: "RECOVERY_COMPLETE" }>): { responder: ResponderSnapshot; responderResource: ResponderResourceSnapshot; change: ResourceChange } {
    const responder = this.#responders.get(event.relatedResponderId);
    if (responder === undefined) throw new SimulationEventError(`Responder ${event.relatedResponderId} does not exist.`);
    const current = this.#requireResponderResource(responder.id);
    if (responder.availabilityState !== "RECOVERING" || current.fatigueMode !== "RECOVERY") return { responder, responderResource: current, change: resourceChange("RESOURCE_EVENT_IGNORED", { responderId: responder.id, reason: "RECOVERY_SUPERSEDED" }) };
    const recovered = advanceResponderFatigue(current, event.scheduledTimeMs, event.id, this.#config.resources, "INACTIVE", event.causeEventId);
    const eligible = recovered.fatigue <= this.#config.resources.recoveryCompletionThreshold && hasEssentialEquipment(recovered, this.#config.resources);
    const transitioned = applyResponderTransition(responder, eligible ? "AVAILABLE" : "OFFLINE", event.id, event.scheduledTimeMs).responder;
    return { responder: transitioned, responderResource: recovered, change: resourceChange("RECOVERY_COMPLETED", { responderId: responder.id, reason: eligible ? "AVAILABLE" : "OFFLINE_REQUIREMENTS" }) };
  }

  #replenishmentFailureReason(stockpile: StockpileSnapshot, responderId: string, quantities: Readonly<Record<string, number>>): ReplenishmentSnapshot["failureReason"] | undefined {
    const responder = this.#requireResponderResource(responderId);
    const sourceReserved = this.#reservedStockpileQuantities.get(stockpile.id);
    const destinationReserved = this.#reservedResponderReplenishment.get(responderId);
    for (const [item, quantity] of Object.entries(quantities)) {
      if ((stockpile.inventory[item] ?? 0) - (sourceReserved?.get(item) ?? 0) < quantity) return "INSUFFICIENT_STOCK";
      if ((responder.inventory[item] ?? 0) + (destinationReserved?.get(item) ?? 0) + quantity > 10_000) return "DESTINATION_CAPACITY";
    }
    const currentTotal = Object.values(responder.inventory).reduce((sum, value) => sum + value, 0);
    const reservedTotal = [...(destinationReserved?.values() ?? [])].reduce((sum, value) => sum + value, 0);
    const requestedTotal = Object.values(quantities).reduce((sum, value) => sum + value, 0);
    if (currentTotal + reservedTotal + requestedTotal > 100_000) return "DESTINATION_CAPACITY";
    return undefined;
  }

  #reserveReplenishment(stockpileId: string, responderId: string, quantities: Readonly<Record<string, number>>): void {
    const source = this.#reservedStockpileQuantities.get(stockpileId) ?? new Map<string, number>();
    const destination = this.#reservedResponderReplenishment.get(responderId) ?? new Map<string, number>();
    for (const [item, quantity] of Object.entries(quantities)) {
      source.set(item, (source.get(item) ?? 0) + quantity);
      destination.set(item, (destination.get(item) ?? 0) + quantity);
    }
    this.#reservedStockpileQuantities.set(stockpileId, source);
    this.#reservedResponderReplenishment.set(responderId, destination);
  }

  #releaseReplenishmentReservation(replenishmentId: string): void {
    const value = this.#replenishments.get(replenishmentId);
    if (value === undefined) return;
    const source = this.#reservedStockpileQuantities.get(value.stockpileId);
    const destination = this.#reservedResponderReplenishment.get(value.responderId);
    for (const [item, quantity] of Object.entries(value.quantities)) {
      if (source !== undefined) source.set(item, Math.max(0, (source.get(item) ?? 0) - quantity));
      if (destination !== undefined) destination.set(item, Math.max(0, (destination.get(item) ?? 0) - quantity));
    }
  }

  #applyReplenishmentComplete(event: Extract<SimulationEvent, { type: "REPLENISHMENT_COMPLETE" }>): { responder: ResponderSnapshot; responderResource: ResponderResourceSnapshot; stockpile: StockpileSnapshot; replenishment: ReplenishmentSnapshot; change: ResourceChange } {
    const current = this.#replenishments.get(event.relatedReplenishmentId);
    if (current === undefined) throw new SimulationEventError(`Replenishment ${event.relatedReplenishmentId} does not exist.`);
    const responder = this.#responders.get(current.responderId);
    const stockpile = this.#stockpiles.get(current.stockpileId);
    if (responder === undefined || stockpile === undefined) throw new SimulationEventError("Replenishment references are no longer valid.");
    if (current.status !== "PENDING") return { responder, responderResource: this.#requireResponderResource(responder.id), stockpile, replenishment: current, change: resourceChange("RESOURCE_EVENT_IGNORED", { replenishmentId: current.id, reason: "REPLENISHMENT_SUPERSEDED" }) };
    const transfer = transferFromStockpile(stockpile, this.#requireResponderResource(responder.id), current.quantities, event.id, event.scheduledTimeMs, event.causeEventId);
    const replenishment = freezeReplenishment({ ...current, status: "COMPLETED", eventHistoryIds: [...current.eventHistoryIds, event.id] });
    return { responder: this.#withResourceInventory(responder, transfer.responder.inventory), responderResource: transfer.responder, stockpile: transfer.stockpile, replenishment, change: resourceChange("REPLENISHMENT_COMPLETED", { responderId: responder.id, stockpileId: stockpile.id, replenishmentId: current.id }) };
  }

  #scheduleOperationalMessageForChange(
    event: SimulationEvent,
    change: Readonly<SimulationChange>,
  ): void {
    if (!this.#config.communication.enabled || this.#initializing) return;
    if (
      event.type === "OPERATIONAL_MESSAGE_CREATE" ||
      event.type === "OPERATIONAL_MESSAGE_DELIVER" ||
      event.type === "OPERATIONAL_MESSAGE_RETRY" ||
      event.type === "REPORT_CREATE"
    ) return;

    let request: OperationalMessageRequest | undefined;
    const task = event.relatedTaskId === undefined ? undefined : this.#tasks.get(event.relatedTaskId);
    const responderId = event.relatedResponderId ?? task?.assignedResponderId;
    const responder = responderId === undefined ? undefined : this.#responders.get(responderId);
    const travel = event.relatedTravelId === undefined ? undefined : this.#travels.get(event.relatedTravelId);
    const resource = responderId === undefined ? undefined : this.#responderResources.get(responderId);
    const base = responderId === undefined ? undefined : {
      responderId,
      observedAtMs: event.scheduledTimeMs,
      submittedAtMs: event.scheduledTimeMs,
      source: "RESPONDER_UNIT" as const,
    };

    if (event.type === "RESPONDER_REGISTER" && responder !== undefined) {
      request = { ...base!, messageType: "RESPONDER_REGISTERED", content: { availabilityState: responder.availabilityState, location: responderLocationForTravel(responder), ...(resource === undefined ? {} : { fatigue: resource.fatigue, inventory: resource.inventory }) } };
    } else if (event.type === "TASK_ASSIGN" && responder !== undefined && task?.assignedResponderId === responder.id) {
      request = { ...base!, relatedTaskId: task.id, messageType: "ASSIGNMENT_ACKNOWLEDGED", content: { availabilityState: responder.availabilityState, taskStatus: task.status } };
    } else if (event.type === "RESPONDER_DEPART" && responder !== undefined && task !== undefined && travel?.status === "EN_ROUTE") {
      request = { ...base!, relatedTaskId: task.id, messageType: "UNIT_DEPARTED", content: { availabilityState: responder.availabilityState, taskStatus: task.status, travelStatus: travel.status, location: travel.currentLocation, routeVersion: travel.routeVersion } };
    } else if (event.type === "TRAVEL_PROGRESS" && travel !== undefined && "kind" in change && change.kind === "TRAVEL_PROGRESSED") {
      request = { ...base!, relatedTaskId: travel.taskId, messageType: "POSITION_UPDATED", content: { travelStatus: travel.status, location: projectTravel(travel, event.scheduledTimeMs).currentLocation, routeVersion: travel.routeVersion } };
    } else if (event.type === "TRAVEL_REROUTE" && travel !== undefined && "kind" in change && change.kind === "TRAVEL_REROUTED") {
      request = { ...base!, relatedTaskId: travel.taskId, messageType: "ROUTE_UPDATED", content: { travelStatus: travel.status, location: travel.currentLocation, routeVersion: travel.routeVersion } };
    } else if (event.type === "RESPONDER_ARRIVE" && responder !== undefined && travel?.status === "ARRIVED") {
      request = { ...base!, relatedTaskId: travel.taskId, messageType: "ARRIVAL_REPORTED", content: { availabilityState: responder.availabilityState, travelStatus: travel.status, location: responderLocationForTravel(responder), routeVersion: travel.routeVersion } };
    } else if (event.type === "TASK_STATE_TRANSITION" && responderId !== undefined && task !== undefined) {
      const messageType = task.status === "IN_PROGRESS" ? "TASK_STARTED" : task.status === "COMPLETED" ? "TASK_COMPLETED" : task.status === "FAILED" ? "TASK_FAILED" : task.status === "CANCELLED" ? "TASK_CANCELLED" : undefined;
      if (messageType !== undefined) request = { ...base!, relatedTaskId: task.id, messageType, content: { ...(responder === undefined ? {} : { availabilityState: responder.availabilityState }), taskStatus: task.status, ...(resource === undefined ? {} : { fatigue: resource.fatigue, inventory: resource.inventory }) } };
    } else if (event.type === "RESPONDER_STATE_TRANSITION" && responder?.availabilityState === "OFFLINE") {
      request = { ...base!, messageType: "UNIT_UNAVAILABLE", content: { availabilityState: "OFFLINE" } };
    } else if (event.type === "COMMUNICATION_STATE_CHANGE") {
      if (event.payload.targetState === "OFFLINE") request = { ...base!, messageType: "COMMUNICATION_LOST", content: { communicationState: "OFFLINE" } };
      if (event.payload.targetState === "CONNECTED") request = { ...base!, messageType: "COMMUNICATION_RESTORED", content: { communicationState: "CONNECTED", ...(responder === undefined ? {} : { availabilityState: responder.availabilityState, location: responderLocationForTravel(responder) }) } };
    } else if (event.type === "RECOVERY_START" && responder !== undefined && resource !== undefined) {
      request = { ...base!, relatedTaskId: event.relatedTaskId, messageType: "RECOVERY_STARTED", content: { availabilityState: responder.availabilityState, fatigue: resource.fatigue } };
    } else if (event.type === "RECOVERY_COMPLETE" && responder !== undefined && resource !== undefined) {
      request = { ...base!, messageType: "RECOVERY_COMPLETED", content: { availabilityState: responder.availabilityState, fatigue: resource.fatigue, inventory: resource.inventory } };
    } else if ((event.type === "EQUIPMENT_FAIL" || event.type === "EQUIPMENT_REPAIR") && resource !== undefined) {
      request = { ...base!, messageType: "EQUIPMENT_STATUS_CHANGED", content: { ...(responder === undefined ? {} : { availabilityState: responder.availabilityState }), fatigue: resource.fatigue, equipmentItem: event.payload.item, equipmentCondition: resource.equipmentConditions[event.payload.item]! } };
    } else if (event.type === "REPLENISHMENT_COMPLETE" && resource !== undefined) {
      request = { ...base!, messageType: "REPLENISHMENT_COMPLETED", content: { ...(responder === undefined ? {} : { availabilityState: responder.availabilityState }), fatigue: resource.fatigue, inventory: resource.inventory } };
    }
    if (request === undefined) return;

    const pendingCount = [...this.#operationalMessages.values()].filter((item) => item.deliveryStatus === "PENDING").length;
    const required = this.#config.communication.maxRetriesPerMessage + 2;
    if (
      pendingCount >= this.#config.communication.maxPendingMessages ||
      required > this.#remainingEventCapacity ||
      this.#scheduledCommunicationEventCount + this.#reservedCommunicationChildEventCount + required > this.#config.communication.maxCommunicationEvents
    ) return;
    this.#scheduleEvent({
      type: "OPERATIONAL_MESSAGE_CREATE",
      scheduledTimeMs: event.scheduledTimeMs,
      priority: 10,
      causeEventId: event.id,
      payload: request,
    });
  }

  #scheduleCommunicationInfrastructureChanges(
    event: Extract<SimulationEvent, { type: "EVOLUTION_APPLY" }>,
  ): void {
    if (!this.#config.communication.enabled) return;
    const applicableChanges = event.payload.infrastructureChanges.filter(
      (item) =>
        item.infrastructureId === "COMMUNICATION_TOWER" ||
        (item.infrastructureId === "ELECTRICAL_SUBSTATION" && this.#config.communication.infrastructureLink.electricalAffectsLinkedResponders),
    );
    if (applicableChanges.length === 0) return;
    const target = infrastructureCommunicationState(applicableChanges.at(-1)!.status);
    for (const responder of this.#responders.values()) {
      if (!communicationInfrastructureApplies(responder, this.#config.communication)) continue;
      const current = this.#communications.get(responder.id);
      if (current === undefined) continue;
      const path = communicationTransitionPath(current.state, target);
      for (let index = 0; index < path.length; index += 1) {
        this.#scheduleEvent({
          type: "COMMUNICATION_STATE_CHANGE",
          scheduledTimeMs: event.scheduledTimeMs,
          priority: -15 + index,
          causeEventId: event.id,
          relatedResponderId: responder.id,
          payload: { targetState: path[index]! },
        });
      }
    }
  }

  #applyOperationalMessageAttempt(
    event: Extract<SimulationEvent, { type: "OPERATIONAL_MESSAGE_DELIVER" | "OPERATIONAL_MESSAGE_RETRY" }>,
  ): {
    message: OperationalMessageSnapshot;
    observation?: PublicOperationalObservation;
    retry: boolean;
    change: OperationalMessageChange;
  } {
    const current = this.#operationalMessages.get(event.relatedMessageId);
    if (current === undefined) throw new SimulationEventError(`Operational message ${event.relatedMessageId} does not exist.`);
    if (current.deliveryStatus !== "PENDING" || event.payload.attemptNumber !== current.attemptCount + 1) {
      return { message: current, retry: false, change: this.#messageChange("OPERATIONAL_MESSAGE_EVENT_IGNORED", current, "SUPERSEDED_ATTEMPT") };
    }
    let message = recordDeliveryAttempt(current, event.scheduledTimeMs);
    if (this.#config.communication.permanentlyFailedMessageTypes.includes(message.messageType)) {
      message = failOperationalMessage(message, "PERMANENTLY_CONFIGURED");
      return { message, retry: false, change: this.#messageChange("OPERATIONAL_MESSAGE_FAILED", message, "PERMANENTLY_CONFIGURED") };
    }
    if (event.scheduledTimeMs - message.submittedAtMs > this.#config.communication.maxDeliveryDelayMs) {
      message = failOperationalMessage(message, "MAXIMUM_DELAY");
      return { message, retry: false, change: this.#messageChange("OPERATIONAL_MESSAGE_FAILED", message, "MAXIMUM_DELAY") };
    }
    const state = this.#communications.get(message.responderId)?.state;
    if (state === undefined) throw new SimulationEventError(`Communication state for responder ${message.responderId} does not exist.`);
    const succeeds =
      state === "CONNECTED" ||
      state === "DEGRADED" ||
      (state === "INTERMITTENT" && this.#deliveryPlanner.intermittentSucceeds(message.id, message.attemptCount, this.#config.communication));
    if (succeeds) {
      message = deliverOperationalMessage(message, event.scheduledTimeMs);
      const observation = projectPublicOperationalObservation(message);
      return { message, observation, retry: false, change: this.#messageChange("OPERATIONAL_MESSAGE_DELIVERED", message) };
    }
    if (message.attemptCount > this.#config.communication.maxRetriesPerMessage) {
      message = failOperationalMessage(message, "RETRY_LIMIT");
      return { message, retry: false, change: this.#messageChange("OPERATIONAL_MESSAGE_FAILED", message, "RETRY_LIMIT") };
    }
    return { message, retry: true, change: this.#messageChange("OPERATIONAL_MESSAGE_RETRY_SCHEDULED", message, state) };
  }

  #scheduleNextMessageAttempt(
    message: OperationalMessageSnapshot,
    causeEventId: string,
    retry: boolean,
  ): void {
    if (message.deliveryStatus !== "PENDING") return;
    const state = this.#communications.get(message.responderId)?.state;
    if (state === undefined) throw new SimulationEventError(`Communication state for responder ${message.responderId} does not exist.`);
    const attemptNumber = message.attemptCount + 1;
    const delay = retry || state === "OFFLINE" || state === "RECOVERING"
      ? this.#config.communication.retryIntervalMs
      : this.#deliveryPlanner.delayMs(message.id, attemptNumber, state, this.#config.communication);
    const scheduledTimeMs = Math.max(this.#clock.timeMs, message.submittedAtMs) + delay;
    if (scheduledTimeMs > this.#maximumTimeMs) {
      this.#releaseReservedMessageAttempts(message.id);
      this.#operationalMessages.set(message.id, failOperationalMessage(message, "MAXIMUM_DELAY"));
      return;
    }
    const consumedReservation = this.#consumeReservedMessageAttempt(message.id);
    try {
      this.#scheduleEvent({
        type: retry ? "OPERATIONAL_MESSAGE_RETRY" : "OPERATIONAL_MESSAGE_DELIVER",
        scheduledTimeMs,
        priority: 5,
        causeEventId,
        relatedMessageId: message.id,
        payload: { attemptNumber },
      });
    } catch (error) {
      if (consumedReservation) this.#restoreReservedMessageAttempt(message.id);
      throw error;
    }
  }

  #consumeReservedMessageAttempt(messageId: string): boolean {
    const remaining = this.#reservedMessageAttemptEvents.get(messageId) ?? 0;
    if (remaining === 0) return false;
    if (remaining === 1) this.#reservedMessageAttemptEvents.delete(messageId);
    else this.#reservedMessageAttemptEvents.set(messageId, remaining - 1);
    this.#reservedCommunicationChildEventCount -= 1;
    return true;
  }

  #restoreReservedMessageAttempt(messageId: string): void {
    this.#reservedMessageAttemptEvents.set(messageId, (this.#reservedMessageAttemptEvents.get(messageId) ?? 0) + 1);
    this.#reservedCommunicationChildEventCount += 1;
  }

  #releaseReservedMessageAttempts(messageId: string): void {
    const remaining = this.#reservedMessageAttemptEvents.get(messageId) ?? 0;
    if (remaining === 0) return;
    this.#reservedMessageAttemptEvents.delete(messageId);
    this.#reservedCommunicationChildEventCount -= remaining;
  }

  #applyTransition(event: IncidentTransitionEvent): {
    incident: IncidentSnapshot;
    change: IncidentChange;
  } {
    const incident = this.#incidents.get(event.relatedIncidentId);
    if (incident === undefined) {
      throw new SimulationEventError(`Incident ${event.relatedIncidentId} does not exist.`);
    }
    return transitionIncident(incident, event);
  }

  #applyResponderRegistration(
    event: Extract<SimulationEvent, { type: "RESPONDER_REGISTER" }>,
  ): { responder: ResponderSnapshot; change: ResponderChange } {
    if (this.#responders.has(event.relatedResponderId)) {
      throw new SimulationEventError(`Responder ${event.relatedResponderId} already exists.`);
    }
    const callsign = event.payload.callsign;
    if (callsign === undefined) {
      throw new SimulationEventError("Responder registration callsign is missing.");
    }
    return createResponder(
      event.relatedResponderId,
      callsign,
      event.payload,
      event.id,
      event.scheduledTimeMs,
    );
  }

  #applyResponderStateTransition(
    event: Extract<SimulationEvent, { type: "RESPONDER_STATE_TRANSITION" }>,
  ): { responder: ResponderSnapshot; change: ResponderChange } {
    const responder = this.#responders.get(event.relatedResponderId);
    if (responder === undefined) {
      throw new SimulationEventError(`Responder ${event.relatedResponderId} does not exist.`);
    }
    if (this.#findOpenTravelForResponder(responder.id) !== undefined) {
      throw new SimulationEventError(
        `Responder ${responder.id} has active travel; interrupt or cancel it first.`,
      );
    }
    return applyResponderTransition(
      responder,
      event.payload.targetState,
      event.id,
      event.scheduledTimeMs,
    );
  }

  #applyTaskCreation(
    event: Extract<SimulationEvent, { type: "TASK_CREATE" }>,
  ): { task: TaskSnapshot; change: TaskChange } {
    if (this.#tasks.has(event.relatedTaskId)) {
      throw new SimulationEventError(`Task ${event.relatedTaskId} already exists.`);
    }
    if (!this.#incidents.has(event.relatedIncidentId)) {
      throw new SimulationEventError(`Incident ${event.relatedIncidentId} does not exist.`);
    }
    if (event.payload.relatedIncidentId !== event.relatedIncidentId) {
      throw new SimulationEventError("Task incident association does not match its event.");
    }
    return createTaskSnapshot(
      event.relatedTaskId,
      event.payload,
      event.id,
      event.scheduledTimeMs,
      event.causeEventId,
    );
  }

  #applyTaskAssignment(
    event: Extract<SimulationEvent, { type: "TASK_ASSIGN" }>,
  ): {
    task: TaskSnapshot;
    responder?: ResponderSnapshot;
    change: TaskChange;
  } {
    const task = this.#tasks.get(event.relatedTaskId);
    if (task === undefined) {
      throw new SimulationEventError(`Task ${event.relatedTaskId} does not exist.`);
    }
    this.#reservedTaskAssignmentIds.delete(task.id);
    if (event.payload.responderId !== undefined) {
      this.#reservedResponderAssignmentIds.delete(event.payload.responderId);
    }

    const activeResponderIds = this.#activeAssignedResponderIds();
    for (const reservedId of this.#reservedResponderAssignmentIds) {
      activeResponderIds.add(reservedId);
    }
    const responder =
      event.payload.responderId === undefined
        ? matchRespondersForTask(task, this.#respondersVisibleToAssignmentPolicy(), activeResponderIds).find((candidate) => this.#isResponderResourceQualified(task, candidate))
        : this.#responders.get(event.payload.responderId);

    if (responder === undefined) {
      if (!event.payload.automatic) {
        throw new SimulationEventError("Manual task assignment responder does not exist.");
      }
      return recordSkippedAssignment(
        task,
        event.id,
        event.scheduledTimeMs,
        event.causeEventId,
      );
    }
    if (!isResponderQualifiedForTask(task, responder, activeResponderIds)) {
      throw new SimulationEventError(
        `Responder ${responder.id} is not eligible for task ${task.id}.`,
      );
    }
    if (!this.#isResponderResourceQualified(task, responder)) {
      if (event.payload.automatic) return recordSkippedAssignment(task, event.id, event.scheduledTimeMs, event.causeEventId);
      throw new SimulationEventError(`Responder ${responder.id} does not meet fatigue or equipment requirements for task ${task.id}.`);
    }

    const responderResult = applyResponderTransition(
      responder,
      "RESERVED",
      event.id,
      event.scheduledTimeMs,
    );
    const taskResult = applyTaskAssignment(
      task,
      responder.id,
      event.id,
      event.scheduledTimeMs,
      event.payload.automatic,
      event.causeEventId,
    );
    return {
      task: taskResult.task,
      responder: responderResult.responder,
      change: taskResult.change,
    };
  }

  #applyTaskStateTransition(
    event: Extract<SimulationEvent, { type: "TASK_STATE_TRANSITION" }>,
  ): {
    task: TaskSnapshot;
    responder?: ResponderSnapshot;
    travel?: TravelSnapshot;
    change: TaskChange;
  } {
    const task = this.#tasks.get(event.relatedTaskId);
    if (task === undefined) {
      throw new SimulationEventError(`Task ${event.relatedTaskId} does not exist.`);
    }
    const relatedTravel = this.#latestTravelForTask(task.id);
    if (
      event.payload.targetStatus === "IN_PROGRESS" &&
      relatedTravel !== undefined &&
      relatedTravel.status !== "ARRIVED"
    ) {
      throw new SimulationEventError(
        `Task ${task.id} cannot start before responder arrival.`,
      );
    }
    let responder: ResponderSnapshot | undefined;
    if (
      event.payload.targetStatus === "IN_PROGRESS" &&
      relatedTravel?.status === "ARRIVED" &&
      task.assignedResponderId !== undefined
    ) {
      const currentResponder = this.#responders.get(task.assignedResponderId);
      if (currentResponder === undefined) {
        throw new SimulationEventError("Assigned responder does not exist.");
      }
      responder = applyResponderTransition(
        currentResponder,
        "BUSY",
        event.id,
        event.scheduledTimeMs,
      ).responder;
    }
    let travel: TravelSnapshot | undefined;
    if (
      (event.payload.targetStatus === "FAILED" ||
        event.payload.targetStatus === "CANCELLED") &&
      relatedTravel !== undefined &&
      isOpenTravelStatus(relatedTravel.status)
    ) {
      travel = terminateTravel(
        relatedTravel,
        "CANCELLED",
        event.id,
        event.scheduledTimeMs,
        event.causeEventId,
      );
    }
    const result = applyTaskTransition(
      task,
      event.payload.targetStatus,
      event.id,
      event.scheduledTimeMs,
      event.causeEventId,
    );
    return {
      task: result.task,
      ...(responder === undefined ? {} : { responder }),
      ...(travel === undefined ? {} : { travel }),
      change: result.change,
    };
  }

  #applyResponderDeparture(
    event: Extract<SimulationEvent, { type: "RESPONDER_DEPART" }>,
  ): {
    task: TaskSnapshot;
    responder: ResponderSnapshot;
    travel: TravelSnapshot;
    change: TravelChange;
  } {
    const task = this.#requireExistingTask(event.relatedTaskId);
    const responder = this.#responders.get(event.relatedResponderId);
    const incident = this.#incidents.get(event.relatedIncidentId);
    if (responder === undefined || incident === undefined) {
      throw new SimulationEventError("Travel departure prerequisites are no longer valid.");
    }
    if (this.#travels.has(event.relatedTravelId)) {
      throw new SimulationEventError(`Travel ${event.relatedTravelId} already exists.`);
    }
    const startLocation = responderLocationForTravel(responder);
    const destination = projectIncidentLocation(incident.location);
    if (
      (task.status === "FAILED" || task.status === "CANCELLED") &&
      task.assignedResponderId === responder.id
    ) {
      const superseded = terminateTravel(
        createTravel(
          event.relatedTravelId,
          task.id,
          responder.id,
          startLocation,
          destination,
          undefined,
          event.payload.responderSpeedUnitsPerSecond,
          event.payload.progressIntervalMs,
          event.id,
          event.scheduledTimeMs,
          event.causeEventId,
        ),
        "CANCELLED",
        event.id,
        event.scheduledTimeMs,
        event.causeEventId,
      );
      return {
        task,
        responder,
        travel: superseded,
        change: travelChange(
          "TRAVEL_EVENT_IGNORED",
          superseded,
          "TASK_TERMINATED_BEFORE_DEPARTURE",
        ),
      };
    }
    if (
      task.status !== "ASSIGNED" ||
      task.assignedResponderId !== responder.id ||
      responder.availabilityState !== "RESERVED"
    ) {
      throw new SimulationEventError("Travel departure prerequisites are no longer valid.");
    }
    const route = findShortestRoute(
      this.#roadNetwork,
      startLocation,
      destination,
      event.payload.responderSpeedUnitsPerSecond,
    );
    if (
      route !== undefined &&
      event.scheduledTimeMs + route.durationMs > this.#maximumTimeMs
    ) {
      throw new SimulationLimitError("Travel arrival exceeds maximum simulation duration.");
    }
    const travel = createTravel(
      event.relatedTravelId,
      task.id,
      responder.id,
      startLocation,
      destination,
      route,
      event.payload.responderSpeedUnitsPerSecond,
      event.payload.progressIntervalMs,
      event.id,
      event.scheduledTimeMs,
      event.causeEventId,
    );
    if (route === undefined) {
      return {
        task,
        responder,
        travel,
        change: travelChange("TRAVEL_BLOCKED", travel, "NO_ACCESSIBLE_ROUTE"),
      };
    }
    const responderResult = applyResponderTransition(
      responder,
      "EN_ROUTE",
      event.id,
      event.scheduledTimeMs,
    );
    const taskResult = applyTaskTransition(
      task,
      "EN_ROUTE",
      event.id,
      event.scheduledTimeMs,
      event.causeEventId,
    );
    return {
      task: taskResult.task,
      responder: responderResult.responder,
      travel,
      change: travelChange("TRAVEL_DEPARTED", travel),
    };
  }

  #applyTravelProgress(
    event: Extract<SimulationEvent, { type: "TRAVEL_PROGRESS" }>,
  ): { travel: TravelSnapshot; change: TravelChange } {
    const travel = this.#requireExistingTravel(event.relatedTravelId);
    if (
      travel.status !== "EN_ROUTE" ||
      travel.routeVersion !== event.payload.routeVersion
    ) {
      return {
        travel,
        change: travelChange(
          "TRAVEL_EVENT_IGNORED",
          travel,
          "SUPERSEDED_PROGRESS_EVENT",
        ),
      };
    }
    const progressed = recordTravelProgress(
      travel,
      event.id,
      event.scheduledTimeMs,
      event.causeEventId,
    );
    return {
      travel: progressed,
      change: travelChange("TRAVEL_PROGRESSED", progressed),
    };
  }

  #applyTravelReroute(
    event: Extract<SimulationEvent, { type: "TRAVEL_REROUTE" }>,
  ): {
    travel: TravelSnapshot;
    task?: TaskSnapshot;
    responder?: ResponderSnapshot;
    outcome?: "ARRIVE" | "BLOCK";
    change: TravelChange;
  } {
    const travel = this.#requireExistingTravel(event.relatedTravelId);
    if (
      travel.routeVersion !== event.payload.routeVersion ||
      (!event.payload.retry && travel.status !== "EN_ROUTE") ||
      (event.payload.retry &&
        travel.status !== "BLOCKED" &&
        travel.status !== "INTERRUPTED")
    ) {
      return {
        travel,
        change: travelChange(
          "TRAVEL_EVENT_IGNORED",
          travel,
          "SUPERSEDED_REROUTE_EVENT",
        ),
      };
    }
    const projected = projectTravel(travel, event.scheduledTimeMs);
    const route = findShortestRoute(
      this.#roadNetwork,
      projected.currentLocation,
      projected.destination,
      travel.responderSpeedUnitsPerSecond,
    );
    if (route === undefined) {
      return {
        travel: projected,
        outcome: "BLOCK",
        change: travelChange(
          "TRAVEL_EVENT_IGNORED",
          projected,
          "NO_ACCESSIBLE_REROUTE",
        ),
      };
    }
    if (event.scheduledTimeMs + route.durationMs > this.#maximumTimeMs) {
      throw new SimulationLimitError("Rerouted arrival exceeds maximum simulation duration.");
    }
    const rerouted = rerouteTravel(
      travel,
      route,
      event.id,
      event.scheduledTimeMs,
      event.payload.retry,
      event.causeEventId,
    );
    let task: TaskSnapshot | undefined;
    let responder: ResponderSnapshot | undefined;
    if (
      event.payload.retry &&
      travel.departedAtMs === undefined
    ) {
      const currentTask = this.#requireExistingTask(travel.taskId);
      const currentResponder = this.#responders.get(travel.responderId);
      if (
        currentTask.status !== "ASSIGNED" ||
        currentResponder?.availabilityState !== "RESERVED"
      ) {
        throw new SimulationEventError("Blocked travel retry prerequisites are invalid.");
      }
      task = applyTaskTransition(
        currentTask,
        "EN_ROUTE",
        event.id,
        event.scheduledTimeMs,
        event.causeEventId,
      ).task;
      responder = applyResponderTransition(
        currentResponder,
        "EN_ROUTE",
        event.id,
        event.scheduledTimeMs,
      ).responder;
    }
    return {
      travel: rerouted,
      ...(task === undefined ? {} : { task }),
      ...(responder === undefined ? {} : { responder }),
      outcome: "ARRIVE",
      change: travelChange("TRAVEL_REROUTED", rerouted),
    };
  }

  #applyResponderArrival(
    event: Extract<SimulationEvent, { type: "RESPONDER_ARRIVE" }>,
  ): {
    travel: TravelSnapshot;
    responder?: ResponderSnapshot;
    change: TravelChange;
  } {
    const travel = this.#requireExistingTravel(event.relatedTravelId);
    const task = this.#tasks.get(travel.taskId);
    if (
      travel.status !== "EN_ROUTE" ||
      travel.routeVersion !== event.payload.routeVersion ||
      task?.status !== "EN_ROUTE"
    ) {
      return {
        travel,
        change: travelChange(
          "TRAVEL_EVENT_IGNORED",
          travel,
          "SUPERSEDED_ARRIVAL_EVENT",
        ),
      };
    }
    const blocked = remainingRouteSegmentIds(travel, event.scheduledTimeMs).some(
      (segmentId) =>
        this.#roadNetwork.segments.find((segment) => segment.id === segmentId)?.state ===
        "BLOCKED",
    );
    if (blocked) {
      return {
        travel,
        change: travelChange(
          "TRAVEL_EVENT_IGNORED",
          travel,
          "ARRIVAL_ROUTE_BLOCKED",
        ),
      };
    }
    const currentResponder = this.#responders.get(travel.responderId);
    if (currentResponder === undefined) {
      throw new SimulationEventError("Travel responder does not exist.");
    }
    const arrived = arriveTravel(
      travel,
      event.id,
      event.scheduledTimeMs,
      event.causeEventId,
    );
    const stateResult = applyResponderTransition(
      currentResponder,
      "ON_SCENE",
      event.id,
      event.scheduledTimeMs,
    ).responder;
    const responder = freezeResponderSnapshot({
      ...stateResult,
      location: Object.freeze({
        fictional: true,
        coordinateSystem: "SIMULATED_LOCAL_GRID",
        x: arrived.destination.x,
        y: arrived.destination.y,
        label: arrived.destination.label ?? "Fictional incident destination",
      }),
    });
    return {
      travel: arrived,
      responder,
      change: travelChange("TRAVEL_ARRIVED", arrived),
    };
  }

  #applyTravelBlocked(
    event: Extract<SimulationEvent, { type: "TRAVEL_BLOCKED" }>,
  ): { travel: TravelSnapshot; change: TravelChange } {
    const travel = this.#requireExistingTravel(event.relatedTravelId);
    if (
      travel.routeVersion !== event.payload.routeVersion ||
      !isOpenTravelStatus(travel.status)
    ) {
      return {
        travel,
        change: travelChange(
          "TRAVEL_EVENT_IGNORED",
          travel,
          "SUPERSEDED_BLOCK_EVENT",
        ),
      };
    }
    const blocked = blockTravel(
      travel,
      event.id,
      event.scheduledTimeMs,
      event.payload.retry,
      event.causeEventId,
    );
    return {
      travel: blocked,
      change: travelChange("TRAVEL_BLOCKED", blocked, "NO_ACCESSIBLE_ROUTE"),
    };
  }

  #applyTravelInterruption(
    event: Extract<SimulationEvent, { type: "TRAVEL_INTERRUPT" }>,
  ): { travel: TravelSnapshot; change: TravelChange } {
    const travel = this.#requireExistingTravel(event.relatedTravelId);
    const interrupted = terminateTravel(
      travel,
      "INTERRUPTED",
      event.id,
      event.scheduledTimeMs,
      event.causeEventId,
    );
    return {
      travel: interrupted,
      change: travelChange("TRAVEL_INTERRUPTED", interrupted),
    };
  }

  #applyReport(event: Extract<SimulationEvent, { type: "REPORT_CREATE" }>): {
    report: EmergencyReport;
    evaluation: PrivateReportEvaluation;
  } {
    const report = event.payload;
    const incident = this.#incidents.get(event.relatedIncidentId);
    if (incident === undefined) {
      throw new SimulationEventError(`Incident ${event.relatedIncidentId} does not exist.`);
    }
    if (this.#reports.has(report.id)) {
      throw new SimulationEventError(`Report ${report.id} already exists.`);
    }
    if (report.runId !== this.#runId) {
      throw new SimulationEventError("Report run ID does not match the simulation run.");
    }
    if (report.internalIncidentId !== event.relatedIncidentId) {
      throw new SimulationEventError("Report incident association does not match its event.");
    }
    if (
      report.observedAtMs > report.submittedAtMs ||
      report.submittedAtMs > report.receivedAtMs ||
      report.receivedAtMs !== event.scheduledTimeMs
    ) {
      throw new SimulationEventError("Report timestamps are invalid.");
    }
    const pendingEvaluation = this.#pendingReportEvaluations.get(report.id);
    if (pendingEvaluation === undefined) {
      throw new SimulationEventError("Report evaluation metadata is missing.");
    }
    return { report, evaluation: finalizeEvaluation(pendingEvaluation, incident) };
  }

  #applyEvolution(event: Extract<SimulationEvent, { type: "EVOLUTION_APPLY" }>): void {
    const incident = this.#incidents.get(event.relatedIncidentId);
    if (incident === undefined) throw new SimulationEventError("Evolution incident does not exist.");
    this.#environmentHistory.push(Object.freeze({ eventId: event.id, atMs: event.scheduledTimeMs, state: event.payload.environment, ...(event.causeEventId === undefined ? {} : { causeEventId: event.causeEventId }) }));
    for (const ruleId of event.payload.ruleIds) this.#cascadeApplications.push(Object.freeze({ ruleId, eventId: event.id, ...(event.causeEventId === undefined ? {} : { causeEventId: event.causeEventId }), atMs: event.scheduledTimeMs, depth: event.payload.cascadeDepth, affectedIds: Object.freeze([event.relatedIncidentId]) }));
    for (const item of event.payload.infrastructureChanges) {
      const entity = [...this.#infrastructure.values()].find((candidate) => candidate.type === item.infrastructureId);
      if (entity !== undefined) this.#infrastructure.set(entity.id, Object.freeze({ ...entity, status: item.status, condition: item.condition, history: Object.freeze([...entity.history, Object.freeze({ eventId: event.id, atMs: event.scheduledTimeMs, status: item.status, condition: item.condition, ruleId: item.ruleId })]) }));
    }
    const action = event.payload.incidentAction;
    if (action !== undefined) {
      if (
        (action === "IMPROVE" && incident.severity <= MIN_INCIDENT_SEVERITY) ||
        (action === "ESCALATE" && incident.severity >= MAX_INCIDENT_SEVERITY)
      ) {
        // The environmental change is real, but incident severity is already at its bound.
      } else {
      const type = action === "ACTIVATE" ? "INCIDENT_ACTIVATE" : action === "ESCALATE" ? "INCIDENT_SEVERITY_INCREASE" : action === "IMPROVE" ? "INCIDENT_SEVERITY_DECREASE" : action === "STABILIZE" ? "INCIDENT_STABILIZE" : "INCIDENT_RESOLVE";
      const synthetic = { ...event, type, payload: type.includes("SEVERITY") ? { amount: event.payload.severityAmount ?? 1 } : {} } as IncidentTransitionEvent;
      this.#incidents.set(
        incident.id,
        freezeIncidentSnapshot(transitionIncident(incident, synthetic).incident),
      );
      }
    }
    if (event.payload.secondaryIncidentType !== undefined && this.#incidents.size < this.#config.maxIncidentCount) {
      const id = this.#ids.nextIncidentId((candidate) => this.#reservedIncidentIds.has(candidate));
      this.#reservedIncidentIds.add(id);
      const created = createIncident(id, { incidentType: event.payload.secondaryIncidentType, location: incident.location, severity: 3 }, event.id, event.scheduledTimeMs).incident;
      this.#incidents.set(id, freezeIncidentSnapshot(created));
      this.#secondaryOrigins.set(id, event.id);
    }
    if (event.payload.observationCategory !== undefined) this.scheduleReports({ reportCount: 1, incidentIds: [event.relatedIncidentId], startTimeMs: event.scheduledTimeMs, frequencyMs: 0, categories: [event.payload.observationCategory], ...(event.payload.reportNoise === undefined ? {} : { noise: event.payload.reportNoise }) });
  }

  #selectReportIncidents(incidentIds: readonly string[] | undefined): readonly IncidentSnapshot[] {
    if (incidentIds === undefined) {
      return Object.freeze([...this.#incidents.values()]);
    }
    if (!Array.isArray(incidentIds) || incidentIds.length === 0) {
      throw new SimulationEventError("incidentIds must be a non-empty array when provided.");
    }
    const selected = incidentIds.map((incidentId) => {
      if (typeof incidentId !== "string") {
        throw new SimulationEventError("incidentIds entries must be strings.");
      }
      const incident = this.#incidents.get(incidentId);
      if (incident === undefined) {
        throw new SimulationEventError(`Incident ${incidentId} does not exist.`);
      }
      return incident;
    });
    return Object.freeze(selected);
  }

  #requireExistingIncident(incidentId: unknown): string {
    if (typeof incidentId !== "string" || !this.#incidents.has(incidentId)) {
      throw new SimulationEventError(`Incident ${String(incidentId)} does not exist.`);
    }
    return incidentId;
  }

  #requireExistingResponder(responderId: unknown): string {
    if (typeof responderId !== "string" || !this.#responders.has(responderId)) {
      throw new SimulationEventError(`Responder ${String(responderId)} does not exist.`);
    }
    return responderId;
  }

  #requireExistingTask(taskId: unknown): TaskSnapshot {
    if (typeof taskId !== "string") {
      throw new SimulationEventError(`Task ${String(taskId)} does not exist.`);
    }
    const task = this.#tasks.get(taskId);
    if (task === undefined) {
      throw new SimulationEventError(`Task ${taskId} does not exist.`);
    }
    return task;
  }

  #requireExistingTravel(travelId: unknown): TravelSnapshot {
    if (typeof travelId !== "string") {
      throw new SimulationEventError(`Travel ${String(travelId)} does not exist.`);
    }
    const travel = this.#travels.get(travelId);
    if (travel === undefined) {
      throw new SimulationEventError(`Travel ${travelId} does not exist.`);
    }
    return travel;
  }

  #latestTravelForTask(taskId: string): TravelSnapshot | undefined {
    return [...this.#travels.values()].filter((travel) => travel.taskId === taskId).at(-1);
  }

  #findOpenTravelForTask(taskId: string): TravelSnapshot | undefined {
    return [...this.#travels.values()].find(
      (travel) => travel.taskId === taskId && isOpenTravelStatus(travel.status),
    );
  }

  #findOpenTravelForResponder(responderId: string): TravelSnapshot | undefined {
    return [...this.#travels.values()].find(
      (travel) =>
        travel.responderId === responderId && isOpenTravelStatus(travel.status),
    );
  }

  #scheduleTravelChildren(
    travel: TravelSnapshot,
    causeEventId: string,
    includeProgress: boolean,
  ): void {
    if (travel.status !== "EN_ROUTE") return;
    if (includeProgress) {
      for (const scheduledTimeMs of travelProgressEventTimes(travel)) {
        this.#scheduleEvent({
          type: "TRAVEL_PROGRESS",
          scheduledTimeMs,
          priority: 0,
          causeEventId,
          relatedTravelId: travel.id,
          payload: { routeVersion: travel.routeVersion },
        });
      }
    }
    this.#scheduleTravelArrival(travel, causeEventId);
  }

  #scheduleTravelArrival(travel: TravelSnapshot, causeEventId: string): void {
    if (travel.status !== "EN_ROUTE" || travel.estimatedArrivalAtMs === undefined) return;
    this.#scheduleEvent({
      type: "RESPONDER_ARRIVE",
      scheduledTimeMs: travel.estimatedArrivalAtMs,
      priority: 0,
      causeEventId,
      relatedTravelId: travel.id,
      payload: { routeVersion: travel.routeVersion },
    });
  }

  #affectedTravels(
    segmentIds: readonly string[],
    atMs: number,
  ): readonly TravelSnapshot[] {
    const changed = new Set(segmentIds);
    return Object.freeze(
      [...this.#travels.values()].filter(
        (travel) =>
          travel.status === "EN_ROUTE" &&
          !this.#reservedTravelRerouteIds.has(travel.id) &&
          remainingRouteSegmentIds(travel, atMs).some((id) => changed.has(id)),
      ),
    );
  }

  #assertRoadRerouteCapacity(segmentIds: readonly string[], atMs: number): void {
    const affectedCount = this.#affectedTravels(segmentIds, atMs).length;
    const required = affectedCount * 2;
    if (
      this.#scheduledEventCount +
        this.#reservedAutomaticAssignmentEventCount +
        this.#reservedTravelChildEventCount +
        this.#reservedCommunicationChildEventCount +
        this.#reservedResourceChildEventCount +
        required >
      this.#config.maxEventCount
    ) {
      throw new SimulationLimitError(
        "Road change reroutes exceed remaining event capacity.",
      );
    }
  }

  #scheduleAffectedTravelReroutes(
    segmentIds: readonly string[],
    atMs: number,
    causeEventId: string,
  ): void {
    for (const travel of this.#affectedTravels(segmentIds, atMs)) {
      if (travel.rerouteCount >= MAX_TRAVEL_REROUTES) {
        this.#scheduleEvent({
          type: "TRAVEL_BLOCKED",
          scheduledTimeMs: atMs,
          priority: -20,
          causeEventId,
          relatedTravelId: travel.id,
          payload: { routeVersion: travel.routeVersion, retry: false },
        });
        continue;
      }
      this.#scheduleEvent({
        type: "TRAVEL_REROUTE",
        scheduledTimeMs: atMs,
        priority: -20,
        causeEventId,
        relatedTravelId: travel.id,
        payload: { routeVersion: travel.routeVersion, retry: false },
      });
    }
  }

  #linkedRoadSegmentIdsForEvolution(
    event: Extract<SimulationEvent, { type: "EVOLUTION_APPLY" }>,
  ): readonly string[] {
    if (
      !event.payload.infrastructureChanges.some(
        (change) => change.infrastructureId === "ROAD",
      )
    ) {
      return Object.freeze([]);
    }
    return Object.freeze(
      this.#roadNetwork.segments
        .filter((segment) => segment.infrastructureType === "ROAD")
        .map((segment) => segment.id),
    );
  }

  #applyEvolutionRoadChanges(
    event: Extract<SimulationEvent, { type: "EVOLUTION_APPLY" }>,
  ): RoadNetworkSnapshot {
    let network = this.#roadNetwork;
    for (const change of event.payload.infrastructureChanges) {
      if (change.infrastructureId !== "ROAD") continue;
      const state = infrastructureStatusToRoadState(change.status);
      for (const segment of network.segments.filter(
        (candidate) => candidate.infrastructureType === "ROAD",
      )) {
        network = updateRoadSegmentState(
          network,
          segment.id,
          state,
          event.id,
          event.scheduledTimeMs,
          event.causeEventId,
        ).network;
      }
    }
    return network;
  }

  #activeAssignedResponderIds(): Set<string> {
    const ids = new Set<string>();
    for (const task of this.#tasks.values()) {
      if (task.assignedResponderId !== undefined && isActiveTaskStatus(task.status)) {
        ids.add(task.assignedResponderId);
      }
    }
    return ids;
  }

  #respondersVisibleToAssignmentPolicy(): ResponderSnapshot[] {
    if (!this.#config.communication.enabled) return [...this.#responders.values()];
    return [...this.#responders.values()].flatMap((responder) => {
      const known = this.#commandCenterKnowledge.get(responder.id);
      if (known?.availabilityState !== "AVAILABLE") return [];
      if (this.#config.resources.enabled && (known.fatigue === undefined || known.fatigue >= this.#config.resources.assignmentFatigueThreshold)) return [];
      return [known.inventory === undefined ? responder : this.#withResourceInventory(responder, known.inventory)];
    });
  }

  #advanceClockTo(targetTimeMs: number): void {
    const deltaMs = targetTimeMs - this.#clock.timeMs;
    if (deltaMs > 0) {
      this.#clock.advance(deltaMs);
    }
  }

  #requireRunning(): void {
    this.#assertNotFailed();
    if (this.#status !== "RUNNING") {
      throw new SimulationStateError("Simulation must be running for this operation.");
    }
  }

  #assertNotFailed(): void {
    if (this.#status === "FAILED") {
      throw new SimulationStateError("Simulation has failed; reset it before continuing.");
    }
  }
}

function freezeIncidentSnapshot(incident: IncidentSnapshot): IncidentSnapshot {
  return Object.freeze({
    ...incident,
    location: Object.freeze({ ...incident.location }),
    eventHistoryIds: Object.freeze([...incident.eventHistoryIds]),
  });
}

function isOpenTravelStatus(status: TravelSnapshot["status"]): boolean {
  return status === "EN_ROUTE" || status === "BLOCKED" || status === "INTERRUPTED";
}

function travelChange(
  kind: TravelChange["kind"],
  travel: TravelSnapshot,
  reason?: string,
): TravelChange {
  return Object.freeze({
    kind,
    travelId: travel.id,
    taskId: travel.taskId,
    responderId: travel.responderId,
    routeVersion: travel.routeVersion,
    status: travel.status,
    ...(reason === undefined ? {} : { reason }),
  });
}

function responderLocationForTravel(
  responder: ResponderSnapshot,
): import("./travel.js").FictionalTravelLocation {
  return Object.freeze({
    fictional: true,
    coordinateSystem: "SIMULATED_LOCAL_GRID",
    x: responder.location.x,
    y: responder.location.y,
    label: responder.location.label,
  });
}

function defaultResponderSpeed(responderType: ResponderSnapshot["responderType"]): number {
  switch (responderType) {
    case "AMBULANCE":
    case "FIRE_ENGINE":
    case "POLICE":
      return 18;
    case "WATER_RESCUE":
    case "SEARCH_AND_RESCUE":
      return 12;
    case "UTILITY_REPAIR":
    case "EVACUATION_TRANSPORT":
      return 10;
    case "SUPPLY_DELIVERY":
      return 9;
  }
}

function isTerminalTaskStatus(status: TaskStatus): status is "COMPLETED" | "FAILED" | "CANCELLED" {
  return status === "COMPLETED" || status === "FAILED" || status === "CANCELLED";
}

function isResourceEventType(type: SimulationEvent["type"]): boolean {
  return ["FATIGUE_UPDATE", "EQUIPMENT_FAIL", "EQUIPMENT_REPAIR", "TASK_RELEASE", "RECOVERY_START", "RECOVERY_COMPLETE", "STOCKPILE_REGISTER", "REPLENISHMENT_REQUEST", "REPLENISHMENT_COMPLETE"].includes(type);
}

function resourceChange(kind: ResourceChange["kind"], values: Omit<ResourceChange, "kind"> = {}): ResourceChange {
  return Object.freeze({ kind, ...values });
}

