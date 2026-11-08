import {
  MAX_INCIDENT_SEVERITY,
  MIN_INCIDENT_SEVERITY,
  type InitialIncidentDefinition,
  type SimulatedLocation,
} from "./config.js";
import { SimulationEventError } from "./errors.js";
import type { IncidentTransitionEvent } from "./events.js";

export type IncidentStatus =
  | "DETECTED"
  | "ACTIVE"
  | "ESCALATING"
  | "STABILIZING"
  | "RESOLVED";

export interface IncidentSnapshot {
  readonly id: string;
  readonly incidentType: string;
  readonly location: Readonly<SimulatedLocation>;
  readonly severity: number;
  readonly status: IncidentStatus;
  readonly createdAtMs: number;
  readonly lastUpdatedAtMs: number;
  readonly eventHistoryIds: readonly string[];
}

export interface IncidentChange {
  readonly incidentId: string;
  readonly previousStatus: IncidentStatus | null;
  readonly status: IncidentStatus;
  readonly previousSeverity: number | null;
  readonly severity: number;
}

export function createIncident(
  id: string,
  definition: Readonly<InitialIncidentDefinition>,
  eventId: string,
  timestampMs: number,
): { incident: IncidentSnapshot; change: IncidentChange } {
  const incident: IncidentSnapshot = {
    id,
    incidentType: definition.incidentType,
    location: definition.location,
    severity: definition.severity,
    status: "DETECTED",
    createdAtMs: timestampMs,
    lastUpdatedAtMs: timestampMs,
    eventHistoryIds: [eventId],
  };
  return {
    incident,
    change: {
      incidentId: id,
      previousStatus: null,
      status: incident.status,
      previousSeverity: null,
      severity: incident.severity,
    },
  };
}

export function transitionIncident(
  current: IncidentSnapshot,
  event: IncidentTransitionEvent,
): { incident: IncidentSnapshot; change: IncidentChange } {
  if (current.status === "RESOLVED") {
    throw new SimulationEventError(`Incident ${current.id} is resolved and cannot transition.`);
  }

  let nextStatus: IncidentStatus = current.status;
  let nextSeverity = current.severity;

  switch (event.type) {
    case "INCIDENT_ACTIVATE":
      requireStatus(current, ["DETECTED"], event.type);
      nextStatus = "ACTIVE";
      break;
    case "INCIDENT_SEVERITY_INCREASE":
      requireStatus(current, ["ACTIVE", "ESCALATING"], event.type);
      nextSeverity += event.payload.amount;
      if (nextSeverity > MAX_INCIDENT_SEVERITY) {
        throw new SimulationEventError(
          `Incident severity cannot exceed ${MAX_INCIDENT_SEVERITY}.`,
        );
      }
      nextStatus = "ESCALATING";
      break;
    case "INCIDENT_SEVERITY_DECREASE":
      requireStatus(current, ["ACTIVE", "ESCALATING", "STABILIZING"], event.type);
      nextSeverity -= event.payload.amount;
      if (nextSeverity < MIN_INCIDENT_SEVERITY) {
        throw new SimulationEventError(
          `Incident severity cannot be less than ${MIN_INCIDENT_SEVERITY}.`,
        );
      }
      if (current.status === "ESCALATING") {
        nextStatus = "ACTIVE";
      }
      break;
    case "INCIDENT_STABILIZE":
      requireStatus(current, ["ACTIVE", "ESCALATING"], event.type);
      nextStatus = "STABILIZING";
      break;
    case "INCIDENT_RESOLVE":
      requireStatus(current, ["STABILIZING"], event.type);
      nextStatus = "RESOLVED";
      break;
  }

  const incident: IncidentSnapshot = {
    ...current,
    severity: nextSeverity,
    status: nextStatus,
    lastUpdatedAtMs: event.scheduledTimeMs,
    eventHistoryIds: [...current.eventHistoryIds, event.id],
  };
  return {
    incident,
    change: {
      incidentId: current.id,
      previousStatus: current.status,
      status: nextStatus,
      previousSeverity: current.severity,
      severity: nextSeverity,
    },
  };
}

function requireStatus(
  incident: IncidentSnapshot,
  allowed: readonly IncidentStatus[],
  operation: string,
): void {
  if (!allowed.includes(incident.status)) {
    throw new SimulationEventError(
      `${operation} is invalid while incident ${incident.id} is ${incident.status}.`,
    );
  }
}

