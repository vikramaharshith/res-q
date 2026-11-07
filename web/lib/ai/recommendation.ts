import { INCIDENT_PRIORITIES, type IncidentPriority } from "@/lib/demo/types";
import type {
  RecommendationDto,
  RecommendedResponderDto,
} from "@/lib/ai/types";

export interface EvidenceScope {
  incidentId: string;
  incidentIds: Set<string>;
  reportIds: Set<string>;
  toolNames: Set<string>;
  responders: Map<string, RecommendedResponderDto>;
}

export function emptyEvidenceScope(incidentId: string): EvidenceScope {
  return {
    incidentId,
    incidentIds: new Set([incidentId]),
    reportIds: new Set(),
    toolNames: new Set(),
    responders: new Map(),
  };
}

export function parseModelJson(
  text: string,
): { ok: true; value: unknown } | { ok: false; problem: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, problem: "The model returned no JSON text." };
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  const attempts = [candidate];
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) {
    attempts.push(candidate.slice(start, end + 1));
  }
  for (const attempt of attempts) {
    try {
      const parsed: unknown = JSON.parse(attempt);
      if (Array.isArray(parsed)) {
        if (parsed.length === 1) return { ok: true, value: parsed[0] };
        return {
          ok: false,
          problem: "The model returned more than one JSON value.",
        };
      }
      return { ok: true, value: parsed };
    } catch {
      continue;
    }
  }
  return { ok: false, problem: "The model text was not valid JSON." };
}

function readBoundedText(
  value: unknown,
  label: string,
  max: number,
  problems: string[],
): string | null {
  if (typeof value !== "string") {
    problems.push(`${label} must be a string.`);
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    problems.push(`${label} must not be empty.`);
    return null;
  }
  if (trimmed.length > max) {
    problems.push(`${label} must be ${max} characters or fewer.`);
    return null;
  }
  return trimmed;
}

function canonicalPriority(value: unknown): IncidentPriority | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  if ((INCIDENT_PRIORITIES as readonly string[]).includes(upper)) {
    return upper as IncidentPriority;
  }
  return null;
}

function normalizeEvidenceToken(value: string): string | null {
  const match = value
    .trim()
    .match(/^(report|tool|incident|responder):\s*([A-Za-z0-9_-]+)$/);
  if (!match?.[1] || !match[2]) return null;
  return `${match[1].toLowerCase()}:${match[2].toLowerCase()}`;
}

function responderIdFor(scope: EvidenceScope, value: string): string | null {
  if (scope.responders.has(value)) return value;
  const needle = value.toLowerCase();
  for (const responder of scope.responders.values()) {
    if (responder.id.toLowerCase() === needle) return responder.id;
    if (responder.callsign.toLowerCase() === needle) return responder.id;
  }
  return null;
}

function evidenceAllowed(token: string, scope: EvidenceScope): boolean {
  const separator = token.indexOf(":");
  const prefix = token.slice(0, separator);
  const id = token.slice(separator + 1);
  if (prefix === "tool") return scope.toolNames.has(id);
  if (prefix === "report") return scope.reportIds.has(id);
  if (prefix === "incident") return scope.incidentIds.has(id);
  if (prefix === "responder") return responderIdFor(scope, id) !== null;
  return false;
}

function canonicalEvidence(token: string, scope: EvidenceScope): string {
  if (!token.startsWith("responder:")) return token;
  const resolved = responderIdFor(scope, token.slice("responder:".length));
  return resolved ? `responder:${resolved}` : token;
}

export function validateRecommendation(
  value: unknown,
  scope: EvidenceScope,
):
  | { ok: true; recommendation: RecommendationDto }
  | { ok: false; problems: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, problems: ["The model response was not a JSON object."] };
  }
  const record = value as Record<string, unknown>;
  const problems: string[] = [];
  if (
    record.incident_id !== undefined &&
    record.incident_id !== scope.incidentId
  ) {
    problems.push(`incident_id must be ${scope.incidentId}.`);
  }

  const proposed = canonicalPriority(record.proposed_priority);
  if (!proposed) {
    problems.push(
      "proposed_priority must be UNASSESSED, LOW, MEDIUM, HIGH, or CRITICAL.",
    );
  }
  const summary = readBoundedText(record.summary, "summary", 700, problems);
  const uncertainty = readBoundedText(
    record.uncertainty,
    "uncertainty",
    900,
    problems,
  );
  const rationale = readBoundedText(record.rationale, "rationale", 1400, problems);

  const evidence: string[] = [];
  if (!Array.isArray(record.evidence)) {
    problems.push("evidence must be an array of id strings from this run.");
  } else if (record.evidence.length === 0 || record.evidence.length > 12) {
    problems.push("evidence must contain 1 to 12 id strings.");
    } else {
      record.evidence.forEach((entry, index) => {
        if (typeof entry !== "string") {
          problems.push(`evidence ${index + 1} must be a string.`);
          return;
        }
        const token = normalizeEvidenceToken(entry);
        if (!token || !evidenceAllowed(token, scope)) {
          const shown = entry.trim().replace(/\s+/g, " ").slice(0, 40);
          problems.push(
            `evidence ${index + 1} (${shown}) is not an id from this run.`,
          );
          return;
        }
        const canonical = canonicalEvidence(token, scope);
        if (!evidence.includes(canonical)) evidence.push(canonical);
      });
      if (
        scope.reportIds.size > 0 &&
        !evidence.some((token) => token.startsWith("report:"))
      ) {
        problems.push(
          "evidence must include a report: id returned by a tool in this run.",
        );
      }
    }

  const missing: string[] = [];
  if (!Array.isArray(record.missing_information)) {
    problems.push("missing_information must be an array of strings.");
  } else if (record.missing_information.length > 8) {
    problems.push("missing_information accepts at most 8 entries.");
  } else {
    record.missing_information.forEach((entry, index) => {
      if (typeof entry !== "string" || !entry.trim()) {
        problems.push(`missing_information ${index + 1} must be a short string.`);
        return;
      }
      if (entry.trim().length > 240) {
        problems.push(`missing_information ${index + 1} is too long.`);
        return;
      }
      missing.push(entry.trim());
    });
  }

  let recommendedId: string | null = null;
  if (
    record.recommended_responder_id !== undefined &&
    record.recommended_responder_id !== null
  ) {
    if (typeof record.recommended_responder_id !== "string") {
      problems.push("recommended_responder_id must be a string or null.");
    } else if (record.recommended_responder_id.trim()) {
      recommendedId = responderIdFor(
        scope,
        record.recommended_responder_id.trim(),
      );
      if (!recommendedId) {
        problems.push(
          "recommended_responder_id must be null or a unit returned by list_available_responders in this run.",
        );
        recommendedId = null;
      }
    }
  }

  if (problems.length > 0 || !proposed || !summary || !uncertainty || !rationale) {
    return { ok: false, problems };
  }

  return {
    ok: true,
    recommendation: {
      incident_id: scope.incidentId,
      proposed_priority: proposed,
      summary,
      evidence,
      missing_information: missing,
      uncertainty,
      recommended_responder_id: recommendedId,
      recommended_responder: recommendedId
        ? (scope.responders.get(recommendedId) ?? null)
        : null,
      rationale,
      requires_human_approval: true,
      advisory: true,
      data_source: "nvidia_nemotron",
    },
  };
}

export function repairPrompt(problems: string[], scope: EvidenceScope): string {
  const reports = [...scope.reportIds]
    .sort()
    .slice(0, 24)
    .map((id) => `report:${id}`);
  const tools = [...scope.toolNames].sort().map((name) => `tool:${name}`);
  const incidents = [...scope.incidentIds]
    .sort()
    .slice(0, 12)
    .map((id) => `incident:${id}`);
  const responderIds = [...scope.responders.keys()].sort();
  const allowed = [
    ...tools,
    ...incidents,
    ...reports,
    ...responderIds.map((id) => `responder:${id}`),
  ];
  return [
    "The server rejected the previous reply. Return one JSON object and nothing else. Do not call tools.",
    `Problems: ${problems.slice(0, 8).join(" ")}`,
    `incident_id must be ${scope.incidentId}.`,
    "requires_human_approval must be true.",
    `proposed_priority must be UNASSESSED, LOW, MEDIUM, HIGH, or CRITICAL.`,
    `Allowed evidence values: ${allowed.join(", ") || "none"}.`,
    responderIds.length > 0
      ? `recommended_responder_id must be one of ${responderIds.join(", ")} or null.`
      : "recommended_responder_id must be null because no available unit was returned.",
    "Use only facts from the tool results. Do not invent measurements, people, or assignments.",
  ].join("\n");
}
