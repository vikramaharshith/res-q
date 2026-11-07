import type {
  IncidentPriority,
  ResponderAvailability,
} from "@/lib/demo/types";

export interface AgentErrorDto {
  code: string;
  message: string;
  retryable: boolean;
  details?: string[];
  unvalidated_excerpt?: string;
}

export interface ToolEventDto {
  sequence_no: number;
  event_type: "tool_finished";
  tool_name: string;
  status: "completed" | "rejected";
  sanitized_arguments: Record<string, unknown>;
  sanitized_result: Record<string, unknown>;
  duration_ms: number;
  created_at: string;
}

export interface RecommendedResponderDto {
  id: string;
  callsign: string;
  availability: ResponderAvailability;
  capabilities: string[];
}

export interface RecommendationDto {
  incident_id: string;
  proposed_priority: IncidentPriority;
  summary: string;
  evidence: string[];
  missing_information: string[];
  uncertainty: string;
  recommended_responder_id: string | null;
  recommended_responder: RecommendedResponderDto | null;
  rationale: string;
  requires_human_approval: true;
  advisory: true;
  data_source: "nvidia_nemotron";
}

export interface AgentRunDto {
  run_id: string;
  status: "COMPLETED" | "FAILED";
  model_id: string | null;
  incident_id: string;
  scenario_id: string;
  simulation: true;
  advisory: true;
  assignment_created: false;
  multi_step: boolean;
  distinct_tool_count: number;
  tool_call_count: number;
  tool_events: ToolEventDto[];
  recommendation: RecommendationDto | null;
  validation_retried: boolean;
  recorded_by: "server" | "browser";
  started_at: string;
  finished_at: string;
  error: AgentErrorDto | null;
}

export type InvestigationSession =
  | { phase: "running" }
  | { phase: "done"; run: AgentRunDto };

export function isAgentRunDto(value: unknown): value is AgentRunDto {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.run_id === "string" &&
    (record.status === "COMPLETED" || record.status === "FAILED") &&
    typeof record.incident_id === "string" &&
    Array.isArray(record.tool_events) &&
    record.assignment_created === false &&
    record.simulation === true
  );
}
