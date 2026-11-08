import type { InitialIncidentDefinition } from "./config.js";
import type { EmergencyReport } from "../reporting/types.js";
import type { EvolutionMutation } from "../evolution/evolution.js";
import type {
  InitialResponderDefinition,
  ResponderAvailabilityState,
  ValidatedResponderDefinition,
} from "./responder.js";
import type {
  TaskAssignmentOrigin,
  TaskDefinition,
  TaskStatus,
  ValidatedTaskDefinition,
} from "./task.js";
import type { RoadAccessState } from "./travel.js";
import type {
  CommunicationState,
  OperationalMessageRequest,
} from "./communication.js";
import type {
  EquipmentCondition,
  FatigueMode,
  StockpileDefinition,
} from "./resources.js";

export type SimulationEventType =
  | "INCIDENT_CREATE"
  | "INCIDENT_ACTIVATE"
  | "INCIDENT_SEVERITY_INCREASE"
  | "INCIDENT_SEVERITY_DECREASE"
  | "INCIDENT_STABILIZE"
  | "INCIDENT_RESOLVE"
  | "RESPONDER_REGISTER"
  | "RESPONDER_STATE_TRANSITION"
  | "TASK_CREATE"
  | "TASK_ASSIGN"
  | "TASK_STATE_TRANSITION"
  | "RESPONDER_DEPART"
  | "TRAVEL_PROGRESS"
  | "TRAVEL_REROUTE"
  | "RESPONDER_ARRIVE"
  | "TRAVEL_BLOCKED"
  | "TRAVEL_INTERRUPT"
  | "ROAD_STATE_CHANGE"
  | "COMMUNICATION_STATE_CHANGE"
  | "OPERATIONAL_MESSAGE_CREATE"
  | "OPERATIONAL_MESSAGE_DELIVER"
  | "OPERATIONAL_MESSAGE_RETRY"
  | "FATIGUE_UPDATE"
  | "EQUIPMENT_FAIL"
  | "EQUIPMENT_REPAIR"
  | "TASK_RELEASE"
  | "RECOVERY_START"
  | "RECOVERY_COMPLETE"
  | "STOCKPILE_REGISTER"
  | "REPLENISHMENT_REQUEST"
  | "REPLENISHMENT_COMPLETE"
  | "REPORT_CREATE"
  | "EVOLUTION_APPLY";

interface EventRequestBase {
  scheduledTimeMs: number;
  priority?: number;
  causeEventId?: string;
}

export interface CreateIncidentEventRequest extends EventRequestBase {
  type: "INCIDENT_CREATE";
  payload: InitialIncidentDefinition;
}

interface IncidentTransitionEventRequest extends EventRequestBase {
  relatedIncidentId: string;
}

export interface ActivateIncidentEventRequest extends IncidentTransitionEventRequest {
  type: "INCIDENT_ACTIVATE";
  payload?: Record<never, never>;
}

export interface IncreaseSeverityEventRequest extends IncidentTransitionEventRequest {
  type: "INCIDENT_SEVERITY_INCREASE";
  payload: { amount: number };
}

export interface DecreaseSeverityEventRequest extends IncidentTransitionEventRequest {
  type: "INCIDENT_SEVERITY_DECREASE";
  payload: { amount: number };
}

export interface StabilizeIncidentEventRequest extends IncidentTransitionEventRequest {
  type: "INCIDENT_STABILIZE";
  payload?: Record<never, never>;
}

export interface ResolveIncidentEventRequest extends IncidentTransitionEventRequest {
  type: "INCIDENT_RESOLVE";
  payload?: Record<never, never>;
}

export interface RegisterResponderEventRequest extends EventRequestBase {
  type: "RESPONDER_REGISTER";
  payload: InitialResponderDefinition;
}

export interface ResponderStateTransitionEventRequest extends EventRequestBase {
  type: "RESPONDER_STATE_TRANSITION";
  relatedResponderId: string;
  payload: { targetState: ResponderAvailabilityState };
}

export interface CreateTaskEventRequest extends EventRequestBase {
  type: "TASK_CREATE";
  payload: TaskDefinition;
}

export interface AssignTaskEventRequest extends EventRequestBase {
  type: "TASK_ASSIGN";
  relatedTaskId: string;
  payload: {
    responderId?: string;
    automatic: boolean;
    origin: TaskAssignmentOrigin;
  };
}

export interface TaskStateTransitionEventRequest extends EventRequestBase {
  type: "TASK_STATE_TRANSITION";
  relatedTaskId: string;
  payload: { targetStatus: TaskStatus };
}

export interface ResponderDepartEventRequest extends EventRequestBase {
  type: "RESPONDER_DEPART";
  relatedTaskId: string;
  payload: {
    responderSpeedUnitsPerSecond: number;
    progressIntervalMs: number;
  };
}

export interface TravelProgressEventRequest extends EventRequestBase {
  type: "TRAVEL_PROGRESS";
  relatedTravelId: string;
  payload: { routeVersion: number };
}

export interface TravelRerouteEventRequest extends EventRequestBase {
  type: "TRAVEL_REROUTE";
  relatedTravelId: string;
  payload: { routeVersion: number; retry: boolean };
}

export interface ResponderArriveEventRequest extends EventRequestBase {
  type: "RESPONDER_ARRIVE";
  relatedTravelId: string;
  payload: { routeVersion: number };
}

export interface TravelBlockedEventRequest extends EventRequestBase {
  type: "TRAVEL_BLOCKED";
  relatedTravelId: string;
  payload: { routeVersion: number; retry: boolean };
}

export interface TravelInterruptEventRequest extends EventRequestBase {
  type: "TRAVEL_INTERRUPT";
  relatedTravelId: string;
  payload?: Record<never, never>;
}

export interface RoadStateChangeEventRequest extends EventRequestBase {
  type: "ROAD_STATE_CHANGE";
  payload: { segmentId: string; state: RoadAccessState };
}

export interface CommunicationStateChangeEventRequest extends EventRequestBase {
  type: "COMMUNICATION_STATE_CHANGE";
  relatedResponderId: string;
  payload: { targetState: CommunicationState };
}

export interface OperationalMessageCreateEventRequest extends EventRequestBase {
  type: "OPERATIONAL_MESSAGE_CREATE";
  payload: OperationalMessageRequest;
}

interface OperationalMessageAttemptEventRequest extends EventRequestBase {
  relatedMessageId: string;
  payload: { attemptNumber: number };
}

export interface OperationalMessageDeliverEventRequest extends OperationalMessageAttemptEventRequest {
  type: "OPERATIONAL_MESSAGE_DELIVER";
}

export interface OperationalMessageRetryEventRequest extends OperationalMessageAttemptEventRequest {
  type: "OPERATIONAL_MESSAGE_RETRY";
}

export interface FatigueUpdateEventRequest extends EventRequestBase {
  type: "FATIGUE_UPDATE";
  relatedResponderId: string;
  payload: { targetMode?: FatigueMode };
}

export interface EquipmentFailEventRequest extends EventRequestBase {
  type: "EQUIPMENT_FAIL";
  relatedResponderId: string;
  payload: { item: string; targetCondition: Extract<EquipmentCondition, "DEGRADED" | "UNAVAILABLE">; cause: string };
}

export interface EquipmentRepairEventRequest extends EventRequestBase {
  type: "EQUIPMENT_REPAIR";
  relatedResponderId: string;
  payload: { item: string; targetCondition: Extract<EquipmentCondition, "UNDER_REPAIR" | "OPERATIONAL" | "DEGRADED"> };
}

export interface TaskReleaseEventRequest extends EventRequestBase {
  type: "TASK_RELEASE";
  relatedTaskId: string;
  payload?: Record<never, never>;
}

export interface RecoveryStartEventRequest extends EventRequestBase {
  type: "RECOVERY_START";
  relatedTaskId: string;
  relatedResponderId: string;
  payload?: Record<never, never>;
}

export interface RecoveryCompleteEventRequest extends EventRequestBase {
  type: "RECOVERY_COMPLETE";
  relatedResponderId: string;
  payload: { recoveryStartedEventId: string };
}

export interface StockpileRegisterEventRequest extends EventRequestBase {
  type: "STOCKPILE_REGISTER";
  payload: StockpileDefinition;
}

export interface ReplenishmentRequestEventRequest extends EventRequestBase {
  type: "REPLENISHMENT_REQUEST";
  relatedResponderId: string;
  payload: { stockpileId: string; quantities: Readonly<Record<string, number>>; delayMs?: number };
}

export interface ReplenishmentCompleteEventRequest extends EventRequestBase {
  type: "REPLENISHMENT_COMPLETE";
  relatedReplenishmentId: string;
  payload?: Record<never, never>;
}

export type SimulationEventRequest =
  | CreateIncidentEventRequest
  | ActivateIncidentEventRequest
  | IncreaseSeverityEventRequest
  | DecreaseSeverityEventRequest
  | StabilizeIncidentEventRequest
  | ResolveIncidentEventRequest
  | RegisterResponderEventRequest
  | ResponderStateTransitionEventRequest
  | CreateTaskEventRequest
  | AssignTaskEventRequest
  | TaskStateTransitionEventRequest
  | ResponderDepartEventRequest
  | TravelProgressEventRequest
  | TravelRerouteEventRequest
  | ResponderArriveEventRequest
  | TravelBlockedEventRequest
  | TravelInterruptEventRequest
  | RoadStateChangeEventRequest
  | CommunicationStateChangeEventRequest
  | OperationalMessageCreateEventRequest
  | OperationalMessageDeliverEventRequest
  | OperationalMessageRetryEventRequest
  | FatigueUpdateEventRequest
  | EquipmentFailEventRequest
  | EquipmentRepairEventRequest
  | TaskReleaseEventRequest
  | RecoveryStartEventRequest
  | RecoveryCompleteEventRequest
  | StockpileRegisterEventRequest
  | ReplenishmentRequestEventRequest
  | ReplenishmentCompleteEventRequest;

interface SimulationEventBase {
  readonly id: string;
  readonly scheduledTimeMs: number;
  readonly priority: number;
  /** Legacy entity association retained for Phase 1-5 event consumers. */
  readonly relatedIncidentId: string;
  readonly relatedResponderId?: string;
  readonly relatedTaskId?: string;
  readonly relatedTravelId?: string;
  readonly relatedMessageId?: string;
  readonly relatedReplenishmentId?: string;
  readonly causeEventId?: string;
}

interface IncidentSimulationEventBase extends SimulationEventBase {
  readonly relatedIncidentId: string;
}

interface ResponderSimulationEventBase extends SimulationEventBase {
  readonly relatedResponderId: string;
}

interface TaskSimulationEventBase extends SimulationEventBase {
  readonly relatedTaskId: string;
}

interface TravelSimulationEventBase extends TaskSimulationEventBase {
  readonly relatedResponderId: string;
  readonly relatedTravelId: string;
}

interface MessageSimulationEventBase extends SimulationEventBase {
  readonly relatedResponderId: string;
  readonly relatedMessageId: string;
}

interface ReplenishmentSimulationEventBase extends ResponderSimulationEventBase {
  readonly relatedReplenishmentId: string;
}

export type SimulationEvent =
  | (IncidentSimulationEventBase & {
      readonly type: "INCIDENT_CREATE";
      readonly payload: Readonly<InitialIncidentDefinition>;
    })
  | (IncidentSimulationEventBase & {
      readonly type: "INCIDENT_ACTIVATE";
      readonly payload: Readonly<Record<never, never>>;
    })
  | (IncidentSimulationEventBase & {
      readonly type: "INCIDENT_SEVERITY_INCREASE";
      readonly payload: Readonly<{ amount: number }>;
    })
  | (IncidentSimulationEventBase & {
      readonly type: "INCIDENT_SEVERITY_DECREASE";
      readonly payload: Readonly<{ amount: number }>;
    })
  | (IncidentSimulationEventBase & {
      readonly type: "INCIDENT_STABILIZE";
      readonly payload: Readonly<Record<never, never>>;
    })
  | (IncidentSimulationEventBase & {
      readonly type: "INCIDENT_RESOLVE";
      readonly payload: Readonly<Record<never, never>>;
    })
  | (ResponderSimulationEventBase & {
      readonly type: "RESPONDER_REGISTER";
      readonly payload: ValidatedResponderDefinition;
    })
  | (ResponderSimulationEventBase & {
      readonly type: "RESPONDER_STATE_TRANSITION";
      readonly payload: Readonly<{ targetState: ResponderAvailabilityState }>;
    })
  | (TaskSimulationEventBase & {
      readonly type: "TASK_CREATE";
      readonly payload: ValidatedTaskDefinition;
    })
  | (TaskSimulationEventBase & {
      readonly type: "TASK_ASSIGN";
      readonly payload: Readonly<{
        responderId?: string;
        automatic: boolean;
        origin: "SIMULATION_BASELINE";
      }>;
    })
  | (TaskSimulationEventBase & {
      readonly type: "TASK_STATE_TRANSITION";
      readonly payload: Readonly<{ targetStatus: TaskStatus }>;
    })
  | (TravelSimulationEventBase & {
      readonly type: "RESPONDER_DEPART";
      readonly payload: Readonly<{
        travelId: string;
        responderSpeedUnitsPerSecond: number;
        progressIntervalMs: number;
      }>;
    })
  | (TravelSimulationEventBase & {
      readonly type: "TRAVEL_PROGRESS";
      readonly payload: Readonly<{ routeVersion: number }>;
    })
  | (TravelSimulationEventBase & {
      readonly type: "TRAVEL_REROUTE";
      readonly payload: Readonly<{ routeVersion: number; retry: boolean }>;
    })
  | (TravelSimulationEventBase & {
      readonly type: "RESPONDER_ARRIVE";
      readonly payload: Readonly<{ routeVersion: number }>;
    })
  | (TravelSimulationEventBase & {
      readonly type: "TRAVEL_BLOCKED";
      readonly payload: Readonly<{ routeVersion: number; retry: boolean }>;
    })
  | (TravelSimulationEventBase & {
      readonly type: "TRAVEL_INTERRUPT";
      readonly payload: Readonly<Record<never, never>>;
    })
  | (SimulationEventBase & {
      readonly type: "ROAD_STATE_CHANGE";
      readonly payload: Readonly<{ segmentId: string; state: RoadAccessState }>;
    })
  | (ResponderSimulationEventBase & {
      readonly type: "COMMUNICATION_STATE_CHANGE";
      readonly payload: Readonly<{ targetState: CommunicationState }>;
    })
  | (MessageSimulationEventBase & {
      readonly type: "OPERATIONAL_MESSAGE_CREATE";
      readonly payload: Readonly<{ messageId: string; request: OperationalMessageRequest }>;
    })
  | (MessageSimulationEventBase & {
      readonly type: "OPERATIONAL_MESSAGE_DELIVER";
      readonly payload: Readonly<{ attemptNumber: number }>;
    })
  | (ResponderSimulationEventBase & {
      readonly type: "FATIGUE_UPDATE";
      readonly payload: Readonly<{ targetMode?: FatigueMode }>;
    })
  | (ResponderSimulationEventBase & {
      readonly type: "EQUIPMENT_FAIL";
      readonly payload: Readonly<{ item: string; targetCondition: "DEGRADED" | "UNAVAILABLE"; cause: string }>;
    })
  | (ResponderSimulationEventBase & {
      readonly type: "EQUIPMENT_REPAIR";
      readonly payload: Readonly<{ item: string; targetCondition: "UNDER_REPAIR" | "OPERATIONAL" | "DEGRADED" }>;
    })
  | (TaskSimulationEventBase & {
      readonly type: "TASK_RELEASE";
      readonly relatedResponderId: string;
      readonly payload: Readonly<Record<never, never>>;
    })
  | (TaskSimulationEventBase & {
      readonly type: "RECOVERY_START";
      readonly relatedResponderId: string;
      readonly payload: Readonly<Record<never, never>>;
    })
  | (ResponderSimulationEventBase & {
      readonly type: "RECOVERY_COMPLETE";
      readonly payload: Readonly<{ recoveryStartedEventId: string }>;
    })
  | (SimulationEventBase & {
      readonly type: "STOCKPILE_REGISTER";
      readonly payload: StockpileDefinition;
    })
  | (ReplenishmentSimulationEventBase & {
      readonly type: "REPLENISHMENT_REQUEST";
      readonly payload: Readonly<{ stockpileId: string; quantities: Readonly<Record<string, number>>; delayMs: number; failureReason?: "INSUFFICIENT_STOCK" | "DESTINATION_CAPACITY" }>;
    })
  | (ReplenishmentSimulationEventBase & {
      readonly type: "REPLENISHMENT_COMPLETE";
      readonly payload: Readonly<Record<never, never>>;
    })
  | (MessageSimulationEventBase & {
      readonly type: "OPERATIONAL_MESSAGE_RETRY";
      readonly payload: Readonly<{ attemptNumber: number }>;
    })
  | (IncidentSimulationEventBase & {
      readonly type: "REPORT_CREATE";
      readonly payload: EmergencyReport;
    })
  | (IncidentSimulationEventBase & {
      readonly type: "EVOLUTION_APPLY";
      readonly payload: EvolutionMutation;
    });

export type IncidentTransitionEvent = Exclude<
  SimulationEvent,
  {
    type:
      | "INCIDENT_CREATE"
      | "RESPONDER_REGISTER"
      | "RESPONDER_STATE_TRANSITION"
      | "TASK_CREATE"
      | "TASK_ASSIGN"
      | "TASK_STATE_TRANSITION"
      | "RESPONDER_DEPART"
      | "TRAVEL_PROGRESS"
      | "TRAVEL_REROUTE"
      | "RESPONDER_ARRIVE"
      | "TRAVEL_BLOCKED"
      | "TRAVEL_INTERRUPT"
      | "ROAD_STATE_CHANGE"
      | "COMMUNICATION_STATE_CHANGE"
      | "OPERATIONAL_MESSAGE_CREATE"
      | "OPERATIONAL_MESSAGE_DELIVER"
      | "OPERATIONAL_MESSAGE_RETRY"
      | "FATIGUE_UPDATE"
      | "EQUIPMENT_FAIL"
      | "EQUIPMENT_REPAIR"
      | "TASK_RELEASE"
      | "RECOVERY_START"
      | "RECOVERY_COMPLETE"
      | "STOCKPILE_REGISTER"
      | "REPLENISHMENT_REQUEST"
      | "REPLENISHMENT_COMPLETE"
      | "REPORT_CREATE"
      | "EVOLUTION_APPLY";
  }
>;

