import {
  assignmentForIncident,
  reportsForIncident,
  responderById,
} from "@/lib/demo/metrics";
import type { Incident, Report, Responder, Scenario } from "@/lib/demo/types";
import type { NemotronToolDefinition } from "@/lib/ai/nemotron-client";
import type { RecommendedResponderDto } from "@/lib/ai/types";

export const ALLOWED_TOOL_NAMES = [
  "get_incident_context",
  "find_related_reports",
  "list_available_responders",
  "get_scenario_context",
] as const;

export type ToolName = (typeof ALLOWED_TOOL_NAMES)[number];

export interface ToolExecution {
  toolName: string;
  status: "completed" | "rejected";
  sanitizedArguments: Record<string, unknown>;
  result: Record<string, unknown>;
  reportIds: string[];
  incidentIds: string[];
  responders: RecommendedResponderDto[];
}

const DATA_SOURCE = "deterministic_synthetic_scenario";

export const NEMOTRON_TOOLS: NemotronToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_incident_context",
      description:
        "Read the active fictional incident, its original reports, and any scenario-baseline assignment. The server binds the incident. Baseline labels are not AI findings.",
      parameters: {
        type: "object",
        properties: {
          scenario_id: { type: "string" },
          incident_id: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_related_reports",
      description:
        "Read other synthetic reports that are deterministic candidates for the active incident. Candidates are not automatic merges. The server binds the incident and caps the limit.",
      parameters: {
        type: "object",
        properties: {
          scenario_id: { type: "string" },
          incident_id: { type: "string" },
          limit: { type: "integer" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_available_responders",
      description:
        "Read simulated responders currently marked AVAILABLE in the scenario. This does not assign or reserve a unit.",
      parameters: {
        type: "object",
        properties: {
          scenario_id: { type: "string" },
          required_capabilities: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_scenario_context",
      description:
        "Read the fictional disaster type, counts, and the rule that recommendations stay advisory.",
      parameters: {
        type: "object",
        properties: {
          scenario_id: { type: "string" },
        },
      },
    },
  },
];

function isToolName(value: string): value is ToolName {
  return (ALLOWED_TOOL_NAMES as readonly string[]).includes(value);
}

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function snippet(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function stringField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseArguments(
  raw: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  if (raw.length > 4_000) {
    return { ok: false, message: "Tool arguments are too large." };
  }
  let parsed: unknown;
  try {
    parsed = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return { ok: false, message: "Tool arguments were not valid JSON." };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, message: "Tool arguments were not a JSON object." };
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}

function rejected(
  toolName: string,
  sanitizedArguments: Record<string, unknown>,
  message: string,
): ToolExecution {
  return {
    toolName,
    status: "rejected",
    sanitizedArguments,
    result: {
      simulation: true,
      data_source: DATA_SOURCE,
      error: "invalid_arguments",
      message,
    },
    reportIds: [],
    incidentIds: [],
    responders: [],
  };
}

function boundArguments(
  args: Record<string, unknown>,
  scenarioId: string,
  incidentId?: string,
): { sanitized: Record<string, unknown>; ignored: boolean } {
  const sanitized: Record<string, unknown> = {
    scenario_id: scenarioId,
    bound_by: "server",
  };
  if (incidentId) sanitized.incident_id = incidentId;
  const requestedScenario = stringField(args.scenario_id);
  const requestedIncident = stringField(args.incident_id);
  let ignored = false;
  if (requestedScenario && requestedScenario !== scenarioId) {
    sanitized.ignored_scenario_id = clip(requestedScenario, 80);
    ignored = true;
  }
  if (incidentId && requestedIncident && requestedIncident !== incidentId) {
    sanitized.ignored_incident_id = clip(requestedIncident, 80);
    ignored = true;
  }
  return { sanitized, ignored };
}

function bindingNotice(ignored: boolean): string {
  if (ignored) {
    return "The server used the active synthetic scenario instead of the ids in the tool arguments.";
  }
  return "The server bound this read to the active synthetic scenario.";
}

function distanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function responderDto(responder: Responder): RecommendedResponderDto {
  return {
    id: responder.id,
    callsign: responder.callsign,
    availability: responder.availability,
    capabilities: [...responder.capabilities],
  };
}

function reportPayload(report: Report, textLimit: number) {
  return {
    id: report.id,
    incident_id: report.incidentId,
    raw_text: snippet(report.rawText, textLimit),
    received_at: report.receivedAt,
    reported_lat: report.reportedLat,
    reported_lon: report.reportedLon,
    analysis_status: report.analysisStatus,
    source: report.source,
  };
}

function incidentContext(
  scenario: Scenario,
  incident: Incident,
  ignored: boolean,
): ToolExecution {
  const reports = reportsForIncident(scenario, incident.id);
  const assignment = assignmentForIncident(scenario, incident.id);
  const assigned = assignment
    ? responderById(scenario, assignment.responderId)
    : undefined;
  return {
    toolName: "get_incident_context",
    status: "completed",
    sanitizedArguments: {
      scenario_id: scenario.id,
      incident_id: incident.id,
      bound_by: "server",
    },
    result: {
      simulation: true,
      data_source: DATA_SOURCE,
      notice: bindingNotice(ignored),
      scenario_id: scenario.id,
      incident: {
        id: incident.id,
        summary: incident.summary,
        category: incident.category,
        district: incident.district,
        lat: incident.lat,
        lon: incident.lon,
        scenario_baseline_priority: incident.priority,
        scenario_baseline_status: incident.status,
        priority_basis: incident.priorityBasis,
        low_detail: incident.lowDetail,
        sample_key: incident.sampleKey ?? null,
      },
      linked_reports: reports.map((report) => reportPayload(report, 800)),
      scenario_baseline_assignment: assignment
        ? {
            id: assignment.id,
            responder_id: assignment.responderId,
            callsign: assigned?.callsign ?? null,
            status: assignment.status,
            origin: assignment.origin,
            note: assignment.note,
            do_not_treat_as_recommendation: true,
          }
        : null,
      baseline_note:
        "Scenario baseline priority, status, and assignment come from the deterministic generator. They are not Nemotron findings and they are not approval.",
    },
    reportIds: reports.map((report) => report.id),
    incidentIds: [incident.id],
    responders: [],
  };
}

function relatedReports(
  scenario: Scenario,
  incident: Incident,
  args: Record<string, unknown>,
  sanitized: Record<string, unknown>,
  ignored: boolean,
): ToolExecution {
  let limit = 5;
  if (args.limit !== undefined) {
    if (typeof args.limit !== "number" || !Number.isInteger(args.limit)) {
      return rejected(
        "find_related_reports",
        sanitized,
        "limit must be an integer from 1 to 8.",
      );
    }
    if (args.limit < 1 || args.limit > 8) {
      return rejected(
        "find_related_reports",
        sanitized,
        "limit must be an integer from 1 to 8.",
      );
    }
    limit = args.limit;
  }
  sanitized.limit = limit;

  const incidentsById = new Map(
    scenario.incidents.map((item) => [item.id, item]),
  );
  const anchorTime = Date.parse(incident.updatedAt);
  const candidates = scenario.reports
    .filter((report) => report.incidentId !== incident.id)
    .map((report) => {
      const other = incidentsById.get(report.incidentId);
      if (!other) return null;
      const reasons: string[] = [];
      if (other.district === incident.district) reasons.push("same district");
      if (other.category === incident.category) reasons.push("same category");
      const kilometers = distanceKm(
        incident.lat,
        incident.lon,
        other.lat,
        other.lon,
      );
      if (kilometers <= 2) {
        reasons.push(`about ${kilometers.toFixed(2)} km apart`);
      }
      const reportTime = Date.parse(report.receivedAt);
      if (Number.isFinite(anchorTime) && Number.isFinite(reportTime)) {
        const minutes = Math.abs(reportTime - anchorTime) / 60_000;
        if (minutes <= 90) {
          reasons.push(`received ${Math.round(minutes)} minutes apart`);
        }
      }
      if (reasons.length === 0) return null;
      const score = reasons.length * 10 - kilometers;
      return { report, other, reasons, kilometers, score };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (left.kilometers !== right.kilometers) {
        return left.kilometers - right.kilometers;
      }
      return left.report.id.localeCompare(right.report.id);
    });

  const selected = candidates.slice(0, limit);
  return {
    toolName: "find_related_reports",
    status: "completed",
    sanitizedArguments: sanitized,
    result: {
      simulation: true,
      data_source: DATA_SOURCE,
      notice: `${bindingNotice(ignored)} These are deterministic candidates, not an AI merge and not a decision to drop any report.`,
      incident_id: incident.id,
      limit,
      candidate_count_considered: candidates.length,
      candidates: selected.map((item) => ({
        report_id: item.report.id,
        incident_id: item.other.id,
        incident_summary: item.other.summary,
        category: item.other.category,
        district: item.other.district,
        distance_km: Number(item.kilometers.toFixed(2)),
        match_reasons: item.reasons,
        raw_text: snippet(item.report.rawText, 320),
        received_at: item.report.receivedAt,
        automatic_link: false,
      })),
    },
    reportIds: selected.map((item) => item.report.id),
    incidentIds: [...new Set(selected.map((item) => item.other.id))],
    responders: [],
  };
}

function capabilityList(
  value: unknown,
): { ok: true; capabilities: string[] } | { ok: false; message: string } {
  if (value === undefined) return { ok: true, capabilities: [] };
  if (!Array.isArray(value)) {
    return {
      ok: false,
      message: "required_capabilities must be an array of strings.",
    };
  }
  if (value.length > 4) {
    return {
      ok: false,
      message: "required_capabilities accepts at most 4 entries.",
    };
  }
  const capabilities: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim() || entry.trim().length > 40) {
      return {
        ok: false,
        message: "Each capability must be a short string.",
      };
    }
    capabilities.push(entry.trim());
  }
  return { ok: true, capabilities };
}

function hasCapabilities(responder: Responder, required: string[]): boolean {
  if (required.length === 0) return true;
  const owned = responder.capabilities.map((item) => item.toLowerCase());
  return required.every((needed) => {
    const needle = needed.toLowerCase();
    return owned.some((capability) => {
      if (capability === needle) return true;
      return needle.length >= 4 && capability.includes(needle);
    });
  });
}

function availableResponders(
  scenario: Scenario,
  args: Record<string, unknown>,
  sanitized: Record<string, unknown>,
  ignored: boolean,
): ToolExecution {
  const parsed = capabilityList(args.required_capabilities);
  if (!parsed.ok) {
    return rejected("list_available_responders", sanitized, parsed.message);
  }
  if (parsed.capabilities.length > 0) {
    sanitized.required_capabilities = parsed.capabilities;
  }
  const available = scenario.responders
    .filter((responder) => responder.availability === "AVAILABLE")
    .filter((responder) => hasCapabilities(responder, parsed.capabilities))
    .sort((left, right) => left.callsign.localeCompare(right.callsign));
  const busy = scenario.responders.filter(
    (responder) => responder.availability === "BUSY",
  ).length;
  const offline = scenario.responders.filter(
    (responder) => responder.availability === "OFFLINE",
  ).length;
  const responders = available.map(responderDto);
  return {
    toolName: "list_available_responders",
    status: "completed",
    sanitizedArguments: sanitized,
    result: {
      simulation: true,
      data_source: DATA_SOURCE,
      notice: `${bindingNotice(ignored)} Availability is seeded scenario state. Listing a unit does not assign it.`,
      required_capabilities: parsed.capabilities,
      excluded_counts: { busy, offline },
      responders: responders.map((responder) => ({
        id: responder.id,
        callsign: responder.callsign,
        capabilities: responder.capabilities,
        availability: responder.availability,
      })),
    },
    reportIds: [],
    incidentIds: [],
    responders,
  };
}

function scenarioContext(
  scenario: Scenario,
  sanitized: Record<string, unknown>,
  ignored: boolean,
): ToolExecution {
  const available = scenario.responders.filter(
    (responder) => responder.availability === "AVAILABLE",
  ).length;
  return {
    toolName: "get_scenario_context",
    status: "completed",
    sanitizedArguments: sanitized,
    result: {
      simulation: true,
      data_source: DATA_SOURCE,
      notice: bindingNotice(ignored),
      scenario_id: scenario.id,
      name: scenario.name,
      disaster_type: scenario.disasterType,
      fictional_location: scenario.fictionalLocation,
      description: scenario.description,
      seed: scenario.seed,
      report_count: scenario.reports.length,
      incident_count: scenario.incidents.length,
      responder_count: scenario.responders.length,
      available_responder_count: available,
      operational_constraints: [
        "This is a fictional Demo City flood. It is not a real emergency.",
        "Do not dispatch, alert, message, or approve an assignment.",
        "Recommendations stay advisory until a human decides.",
        "Seeded assignments are scenario baseline, not AI decisions.",
        "Missing details are not an all-clear.",
      ],
    },
    reportIds: [],
    incidentIds: [],
    responders: [],
  };
}

export function executeAllowlistedTool(
  scenario: Scenario,
  incidentId: string,
  toolName: string,
  rawArguments: string,
): ToolExecution {
  if (!isToolName(toolName)) {
    return {
      toolName: clip(toolName || "unknown", 80),
      status: "rejected",
      sanitizedArguments: {},
      result: {
        simulation: true,
        data_source: DATA_SOURCE,
        error: "unknown_tool",
        message: `That tool is not allowlisted. Allowed tools: ${ALLOWED_TOOL_NAMES.join(", ")}.`,
      },
      reportIds: [],
      incidentIds: [],
      responders: [],
    };
  }

  const parsed = parseArguments(rawArguments);
  if (!parsed.ok) {
    return rejected(toolName, { bound_by: "server" }, parsed.message);
  }

  const incident = scenario.incidents.find((item) => item.id === incidentId);
  const needsIncident =
    toolName === "get_incident_context" || toolName === "find_related_reports";
  if (needsIncident && !incident) {
    return rejected(
      toolName,
      { scenario_id: scenario.id, incident_id: incidentId, bound_by: "server" },
      "The active incident is not in the synthetic scenario.",
    );
  }

  const bound = boundArguments(
    parsed.value,
    scenario.id,
    needsIncident ? incidentId : undefined,
  );

  if (toolName === "get_incident_context" && incident) {
    const execution = incidentContext(scenario, incident, bound.ignored);
    execution.sanitizedArguments = {
      ...bound.sanitized,
      ...execution.sanitizedArguments,
    };
    return execution;
  }
  if (toolName === "find_related_reports" && incident) {
    return relatedReports(
      scenario,
      incident,
      parsed.value,
      bound.sanitized,
      bound.ignored,
    );
  }
  if (toolName === "list_available_responders") {
    return availableResponders(
      scenario,
      parsed.value,
      bound.sanitized,
      bound.ignored,
    );
  }
  return scenarioContext(scenario, bound.sanitized, bound.ignored);
}
