import { redactSecrets } from "@/lib/ai/nemotron-client";
import type { AgentRunDto, RecommendationDto, ToolEventDto } from "@/lib/ai/types";
import type { ApprovalDecisionDto } from "@/lib/approval/types";

const TRACE_VERSION = 1;

interface StoredTrace {
  version: number;
  tool_events: ToolEventDto[];
  error: AgentRunDto["error"];
  started_at: string;
  finished_at: string;
  validation_retried: boolean;
  recorded_by: "server";
  simulation: true;
  advisory: true;
  assignment_created: false;
  multi_step: boolean;
  distinct_tool_count: number;
  tool_call_count: number;
}

export interface AgentRunRow {
  id: string;
  incident_id: string;
  scenario_id: string;
  model_id: string | null;
  status: "COMPLETED" | "FAILED";
  recommendation: RecommendationDto | null;
  tool_trace: StoredTrace;
  created_at: string;
}

export function toAgentRunRow(run: AgentRunDto): AgentRunRow {
  const safe = redactSecrets(run);
  return {
    id: safe.run_id,
    incident_id: safe.incident_id,
    scenario_id: safe.scenario_id,
    model_id: safe.model_id,
    status: safe.status,
    recommendation: safe.recommendation,
    tool_trace: {
      version: TRACE_VERSION,
      tool_events: safe.tool_events,
      error: safe.error,
      started_at: safe.started_at,
      finished_at: safe.finished_at,
      validation_retried: safe.validation_retried,
      recorded_by: "server",
      simulation: true,
      advisory: true,
      assignment_created: false,
      multi_step: safe.multi_step,
      distinct_tool_count: safe.distinct_tool_count,
      tool_call_count: safe.tool_call_count,
    },
    created_at: safe.finished_at,
  };
}

export function fromAgentRunRow(row: AgentRunRow): AgentRunDto | null {
  const trace = row.tool_trace;
  if (!trace || trace.version !== TRACE_VERSION || trace.assignment_created !== false) {
    return null;
  }
  if (row.status !== "COMPLETED" && row.status !== "FAILED") return null;
  return redactSecrets({
    run_id: row.id,
    status: row.status,
    model_id: row.model_id,
    incident_id: row.incident_id,
    scenario_id: row.scenario_id,
    simulation: true,
    advisory: true,
    assignment_created: false,
    multi_step: trace.multi_step,
    distinct_tool_count: trace.distinct_tool_count,
    tool_call_count: trace.tool_call_count,
    tool_events: trace.tool_events,
    recommendation: row.recommendation,
    validation_retried: trace.validation_retried,
    recorded_by: "server",
    started_at: trace.started_at,
    finished_at: trace.finished_at,
    error: trace.error,
    stored: true,
    storage_code: "stored",
  });
}

export function decisionFromResult(value: unknown): ApprovalDecisionDto | null {
  if (!value || typeof value !== "object") return null;
  const record = value as ApprovalDecisionDto;
  if (record.humanDecision !== true || record.simulation !== true) return null;
  if (record.operatorLabel !== "local_demo_operator") return null;
  if (typeof record.id !== "string" || typeof record.agentRunId !== "string") return null;
  return record;
}
