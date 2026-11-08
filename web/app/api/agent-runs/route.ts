import { connection } from "next/server";

import { investigateIncident } from "@/lib/ai/agent-orchestrator";
import { redactSecrets } from "@/lib/ai/nemotron-client";
import type { AgentRunDto } from "@/lib/ai/types";
import { loadStoredHistory, rememberInvestigation } from "@/lib/approval/history";

export const maxDuration = 180;

function respond(run: AgentRunDto, status: number): Response {
  return Response.json(redactSecrets(run), {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function invalid(message: string): Response {
  const now = new Date().toISOString();
  const run: AgentRunDto = {
    run_id: `run_${crypto.randomUUID()}`,
    status: "FAILED",
    model_id: null,
    incident_id: "",
    scenario_id: "",
    simulation: true,
    advisory: true,
    assignment_created: false,
    multi_step: false,
    distinct_tool_count: 0,
    tool_call_count: 0,
    tool_events: [],
    recommendation: null,
    validation_retried: false,
    recorded_by: "server",
    started_at: now,
    finished_at: now,
    error: {
      code: "INVALID_REQUEST",
      message,
      retryable: false,
    },
  };
  return respond(run, 400);
}

export async function GET(): Promise<Response> {
  await connection();
  const history = await loadStoredHistory();
  return Response.json(redactSecrets(history), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  let raw = "";
  try {
    raw = await request.text();
  } catch {
    return invalid("The investigation request could not be read.");
  }
  if (raw.length > 2_000) {
    return invalid("The investigation request is too large.");
  }

  let body: unknown;
  try {
    body = raw.trim() ? JSON.parse(raw) : null;
  } catch {
    return invalid("The investigation request was not valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return invalid("The investigation request must be a JSON object.");
  }
  const record = body as Record<string, unknown>;
  if (record.mode !== "investigate") {
    return invalid('mode must be "investigate".');
  }
  if (typeof record.incident_id !== "string" || !/^inc_[0-9]{4,8}$/.test(record.incident_id)) {
    return invalid("incident_id must be a synthetic incident id.");
  }

  try {
    const result = await investigateIncident(record.incident_id);
    const stored = await rememberInvestigation(result.run);
    return respond(stored, result.httpStatus);
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    console.error(`[resq-agent] route_unexpected=${name}`);
    const now = new Date().toISOString();
    const run: AgentRunDto = {
      run_id: `run_${crypto.randomUUID()}`,
      status: "FAILED",
      model_id: null,
      incident_id: record.incident_id,
      scenario_id: "",
      simulation: true,
      advisory: true,
      assignment_created: false,
      multi_step: false,
      distinct_tool_count: 0,
      tool_call_count: 0,
      tool_events: [],
      recommendation: null,
      validation_retried: false,
      recorded_by: "server",
      started_at: now,
      finished_at: now,
      error: {
        code: "UPSTREAM_ERROR",
        message:
          "The investigation stopped because of a server error. Nothing was assigned.",
        retryable: true,
      },
    };
    return respond(run, 500);
  }
}
