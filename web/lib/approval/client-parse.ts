import type { AgentRunDto } from "@/lib/ai/types";
import { isAgentRunDto } from "@/lib/ai/types";
import type {
  ApprovalDecisionDto,
  ApprovalHistory,
  CommandSnapshot,
} from "@/lib/approval/types";

function isDecision(value: unknown): value is ApprovalDecisionDto {
  if (!value || typeof value !== "object") return false;
  const record = value as ApprovalDecisionDto;
  return (
    record.simulation === true &&
    record.humanDecision === true &&
    record.operatorLabel === "local_demo_operator" &&
    typeof record.id === "string" &&
    typeof record.incidentId === "string"
  );
}

export function parseHistory(value: unknown): ApprovalHistory | null {
  if (!value || typeof value !== "object") return null;
  const record = value as {
    storage?: unknown;
    storageMessage?: unknown;
    runs?: unknown;
    decisions?: unknown;
  };
  if (record.storage !== "ready" && record.storage !== "blocked") return null;
  if (!Array.isArray(record.runs) || !Array.isArray(record.decisions)) return null;
  const runs = record.runs.filter((run): run is AgentRunDto => isAgentRunDto(run));
  const decisions = record.decisions.filter(isDecision);
  return {
    storage: record.storage,
    storageMessage: typeof record.storageMessage === "string" ? record.storageMessage : null,
    runs,
    decisions,
  };
}

export function parseCommandSnapshot(value: unknown): CommandSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const record = value as CommandSnapshot;
  if (typeof record.complete !== "boolean") return null;
  if (!Array.isArray(record.incidents) || !Array.isArray(record.responders) || !Array.isArray(record.assignments)) {
    return null;
  }
  return record;
}

export function parseApprovalPayload(value: unknown): {
  ok: boolean;
  message: string;
  snapshot: CommandSnapshot | null;
} {
  if (!value || typeof value !== "object") {
    return {
      ok: false,
      message: "The approval route did not return a usable result. Do not assume an assignment was created.",
      snapshot: null,
    };
  }
  const record = value as {
    ok?: unknown;
    message?: unknown;
    snapshot?: unknown;
    assignment_created?: unknown;
  };
  const message =
    typeof record.message === "string"
      ? record.message
      : "The approval route did not explain the result. Do not assume an assignment was created.";
  return {
    ok: record.ok === true,
    message,
    snapshot: record.snapshot ? parseCommandSnapshot(record.snapshot) : null,
  };
}
