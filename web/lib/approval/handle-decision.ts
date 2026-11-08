import { redactServerText } from "@/lib/security/redact";
import { STANDARD_DEMO_ID } from "@/lib/supabase/standard-demo-parse";
import { INCIDENT_PRIORITIES, type IncidentPriority } from "@/lib/demo/types";
import { assertLocalDemoGate } from "@/lib/approval/local-gate";
import {
  APPROVAL_ACTIONS,
  LOCAL_OPERATOR_LABEL,
  type ApprovalAction,
  type ApprovalDecisionDto,
  type CommandSnapshot,
  type DecisionRequest,
} from "@/lib/approval/types";

/**
 * Approval route logic. The store performs the only write, and only after the
 * local demonstration gate accepts the caller. Browser-supplied operator ids
 * are ignored.
 */

export interface StoreApplyInput {
  request: DecisionRequest;
  incidentId: string;
  agentRunId: string;
  scenarioId: string;
  operatorLabel: typeof LOCAL_OPERATOR_LABEL;
}

export type StoreApplyResult =
  | { type: "migration_required"; message: string }
  | { type: "unavailable"; message: string }
  | { type: "refused"; httpStatus: number; code: string; message: string }
  | {
      type: "committed";
      httpStatus: number;
      code: string;
      message: string;
      assignmentCreated: boolean;
      decision: ApprovalDecisionDto;
      snapshot: CommandSnapshot | null;
      replay: boolean;
    };

export interface ApprovalStore {
  apply(input: StoreApplyInput): Promise<StoreApplyResult>;
}

export interface ApprovalHandlerConfig {
  secret: string | null;
  enabled: boolean;
  store: ApprovalStore;
}

function json(body: unknown, status: number): Response {
  const encoded = redactServerText(JSON.stringify(body) ?? "");
  let redacted: unknown = body;
  try {
    redacted = JSON.parse(encoded) as unknown;
  } catch {
    redacted = { ok: false, message: "The response could not be encoded." };
  }
  return Response.json(redacted, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function failure(status: number, code: string, message: string): Response {
  return json(
    {
      ok: false,
      code,
      message: redactServerText(message),
      simulation: true,
      assignment_created: false,
      decision: null,
      snapshot: null,
      replay: false,
    },
    status,
  );
}

function success(result: Extract<StoreApplyResult, { type: "committed" }>): Response {
  return json(
    {
      ok: true,
      code: result.code,
      message: redactServerText(result.message),
      simulation: true,
      assignment_created: result.assignmentCreated,
      decision: result.decision,
      snapshot: result.snapshot,
      replay: result.replay,
    },
    result.httpStatus,
  );
}

export async function handleApprovalRequest(
  request: Request,
  config: ApprovalHandlerConfig,
): Promise<Response> {
  const gate = assertLocalDemoGate({
    url: request.url,
    hostHeader: request.headers.get("host"),
    forwardedFor: request.headers.get("x-forwarded-for"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    realIp: request.headers.get("x-real-ip"),
    connectingIp: request.headers.get("cf-connecting-ip"),
    cookieHeader: request.headers.get("cookie"),
    demoHeader: request.headers.get("x-resq-local-demo"),
    secret: config.secret,
    enabled: config.enabled,
  });
  if (!gate.ok) return failure(403, "UNAUTHORIZED", gate.message);

  let raw = "";
  try {
    raw = await request.text();
  } catch {
    return failure(400, "INVALID_REQUEST", "The decision request could not be read. Nothing was assigned.");
  }
  if (raw.length > 8_000) {
    return failure(400, "INVALID_REQUEST", "The decision request is too large. Nothing was assigned.");
  }
  let body: unknown;
  try {
    body = raw.trim() ? JSON.parse(raw) : null;
  } catch {
    return failure(400, "INVALID_REQUEST", "The decision request was not valid JSON. Nothing was assigned.");
  }
  const parsed = parseDecisionBody(body);
  if (!parsed.ok) return failure(parsed.httpStatus, parsed.code, parsed.message);

  let result: StoreApplyResult;
  try {
    result = await config.store.apply({
      request: parsed.request,
      incidentId: parsed.incidentId,
      agentRunId: parsed.agentRunId,
      scenarioId: STANDARD_DEMO_ID,
      operatorLabel: LOCAL_OPERATOR_LABEL,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "database error";
    return failure(
      503,
      "DATABASE_UNAVAILABLE",
      `The decision could not be saved. Nothing was confirmed. ${redactServerText(message)}`,
    );
  }
  if (result.type === "migration_required") {
    return failure(503, "MIGRATION_REQUIRED", result.message);
  }
  if (result.type === "unavailable") {
    return failure(503, "DATABASE_UNAVAILABLE", result.message);
  }
  if (result.type === "refused") {
    return failure(result.httpStatus, result.code, result.message);
  }
  if (result.decision.operatorLabel !== LOCAL_OPERATOR_LABEL) {
    return failure(
      500,
      "DATABASE_UNAVAILABLE",
      "The decision store returned an unexpected operator. The board was not updated from that result.",
    );
  }
  return success(result);
}

function parseDecisionBody(body: unknown):
  | {
      ok: true;
      request: DecisionRequest;
      incidentId: string;
      agentRunId: string;
    }
  | { ok: false; httpStatus: number; code: string; message: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      httpStatus: 400,
      code: "INVALID_REQUEST",
      message: "The decision request must be a JSON object. Nothing was assigned.",
    };
  }
  const record = body as Record<string, unknown>;
  if (record.scenario_id !== undefined && record.scenario_id !== STANDARD_DEMO_ID) {
    return {
      ok: false,
      httpStatus: 403,
      code: "SCENARIO_MISMATCH",
      message: "Decisions stay inside the standard demo scenario. Nothing was assigned.",
    };
  }
  if (typeof record.incident_id !== "string" || !/^inc_[0-9]{4,8}$/.test(record.incident_id)) {
    return {
      ok: false,
      httpStatus: 400,
      code: "INVALID_REQUEST",
      message: "incident_id must be a synthetic incident id. Nothing was assigned.",
    };
  }
  if (typeof record.agent_run_id !== "string" || !/^run_[0-9a-f-]{36}$/i.test(record.agent_run_id)) {
    return {
      ok: false,
      httpStatus: 400,
      code: "INVALID_REQUEST",
      message: "agent_run_id must be a server investigation id. Nothing was assigned.",
    };
  }
  if (typeof record.action !== "string" || !APPROVAL_ACTIONS.includes(record.action as ApprovalAction)) {
    return {
      ok: false,
      httpStatus: 400,
      code: "INVALID_REQUEST",
      message: "action must be approve, reject, or override. Nothing was assigned.",
    };
  }
  if (typeof record.idempotency_key !== "string") {
    return {
      ok: false,
      httpStatus: 400,
      code: "INVALID_REQUEST",
      message: "idempotency_key is required. Nothing was assigned.",
    };
  }
  const reason = typeof record.reason === "string" ? record.reason : "";
  const selectedPriority = parsePriority(record.selected_priority);
  if (record.selected_priority !== undefined && record.selected_priority !== null && !selectedPriority) {
    return {
      ok: false,
      httpStatus: 400,
      code: "INVALID_REQUEST",
      message: "selected_priority is not a review priority. Nothing was assigned.",
    };
  }
  let selectedResponderId: string | null = null;
  if (record.selected_responder_id !== undefined && record.selected_responder_id !== null) {
    if (
      typeof record.selected_responder_id !== "string" ||
      !/^unit_[0-9]{2,8}$/.test(record.selected_responder_id)
    ) {
      return {
        ok: false,
        httpStatus: 400,
        code: "INVALID_REQUEST",
        message: "selected_responder_id must be a simulated unit id. Nothing was assigned.",
      };
    }
    selectedResponderId = record.selected_responder_id;
  }
  return {
    ok: true,
    incidentId: record.incident_id,
    agentRunId: record.agent_run_id,
    request: {
      action: record.action as ApprovalAction,
      confirmed: record.confirmed === true,
      reason,
      idempotencyKey: record.idempotency_key,
      selectedPriority,
      selectedResponderId,
    },
  };
}

function parsePriority(value: unknown): IncidentPriority | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  if ((INCIDENT_PRIORITIES as readonly string[]).includes(upper)) {
    return upper as IncidentPriority;
  }
  return null;
}
