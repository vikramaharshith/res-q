import type { RecommendationDto } from "@/lib/ai/types";
import type {
  Assignment,
  AssignmentOrigin,
  AssignmentStatus,
  IncidentPriority,
  IncidentStatus,
  ResponderAvailability,
} from "@/lib/demo/types";

export const APPROVAL_ACTIONS = ["approve", "reject", "override"] as const;

export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

export const LOCAL_OPERATOR_LABEL = "local_demo_operator";

export interface StateSnapshot {
  incidentStatus: IncidentStatus;
  incidentPriority: IncidentPriority;
  responderId: string | null;
  responderAvailability: ResponderAvailability | null;
  assignmentId: string | null;
  assignmentStatus: AssignmentStatus | null;
  assignmentOrigin: AssignmentOrigin | null;
}

export interface ApprovalDecisionDto {
  id: string;
  idempotencyKey: string;
  fingerprint: string;
  agentRunId: string;
  incidentId: string;
  scenarioId: string;
  action: ApprovalAction;
  reason: string;
  operatorLabel: typeof LOCAL_OPERATOR_LABEL;
  selectedPriority: IncidentPriority | null;
  selectedResponderId: string | null;
  originalRecommendation: RecommendationDto;
  previousState: StateSnapshot;
  resultingState: StateSnapshot;
  assignmentId: string | null;
  assignmentCreated: boolean;
  createdAt: string;
  simulation: true;
  humanDecision: true;
}

export interface DecisionRun {
  id: string;
  status: "COMPLETED" | "FAILED";
  incidentId: string;
  scenarioId: string;
  recommendation: RecommendationDto | null;
}

export interface DecisionRequest {
  action: ApprovalAction;
  confirmed: boolean;
  reason: string;
  idempotencyKey: string;
  selectedPriority: IncidentPriority | null;
  selectedResponderId: string | null;
}

export interface CommandSnapshotIncident {
  id: string;
  status: IncidentStatus;
  priority: IncidentPriority;
  updatedAt: string;
}

export interface CommandSnapshotResponder {
  id: string;
  availability: ResponderAvailability;
  updatedAt: string;
}

export interface CommandSnapshot {
  complete: boolean;
  source: "supabase" | "decision";
  incidents: CommandSnapshotIncident[];
  responders: CommandSnapshotResponder[];
  assignments: Assignment[];
}

export interface ApprovalHistory {
  storage: "ready" | "blocked";
  storageMessage: string | null;
  runs: import("@/lib/ai/types").AgentRunDto[];
  decisions: ApprovalDecisionDto[];
}

export function emptyHistory(message: string): ApprovalHistory {
  return {
    storage: "blocked",
    storageMessage: message,
    runs: [],
    decisions: [],
  };
}
