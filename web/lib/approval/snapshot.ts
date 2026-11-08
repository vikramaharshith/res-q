import type { Assignment, Scenario } from "@/lib/demo/types";
import type { CommandSnapshot } from "@/lib/approval/types";

export function toCommandSnapshot(scenario: Scenario): CommandSnapshot {
  return {
    complete: true,
    source: "supabase",
    incidents: scenario.incidents.map((incident) => ({
      id: incident.id,
      status: incident.status,
      priority: incident.priority,
      updatedAt: incident.updatedAt,
    })),
    responders: scenario.responders.map((responder) => ({
      id: responder.id,
      availability: responder.availability,
      updatedAt: responder.updatedAt,
    })),
    assignments: scenario.assignments.map((assignment) => ({ ...assignment })),
  };
}

function sameBaseline(left: Assignment, right: Assignment): boolean {
  return (
    left.id === right.id &&
    left.incidentId === right.incidentId &&
    left.responderId === right.responderId &&
    left.status === right.status &&
    left.assignedAt === right.assignedAt &&
    left.origin === "scenario_baseline" &&
    right.origin === "scenario_baseline" &&
    left.note === right.note
  );
}

export function applyCommandSnapshot(
  scenario: Scenario,
  snapshot: CommandSnapshot,
): { ok: true; scenario: Scenario } | { ok: false; message: string } {
  const currentBaseline = scenario.assignments.filter(
    (assignment) => assignment.origin === "scenario_baseline",
  );
  if (snapshot.complete) {
    const nextBaseline = snapshot.assignments.filter(
      (assignment) => assignment.origin === "scenario_baseline",
    );
    if (nextBaseline.length !== currentBaseline.length) {
      return {
        ok: false,
        message:
          "The refreshed board dropped a scenario baseline assignment, so the view was left unchanged.",
      };
    }
    for (const current of currentBaseline) {
      const next = nextBaseline.find((assignment) => assignment.id === current.id);
      if (!next || !sameBaseline(current, next)) {
        return {
          ok: false,
          message:
            "The refreshed board changed a scenario baseline assignment, so the view was left unchanged.",
        };
      }
    }
    const incidentIds = new Set(snapshot.incidents.map((incident) => incident.id));
    const responderIds = new Set(snapshot.responders.map((responder) => responder.id));
    if (
      scenario.incidents.some((incident) => !incidentIds.has(incident.id)) ||
      scenario.responders.some((responder) => !responderIds.has(responder.id))
    ) {
      return {
        ok: false,
        message:
          "The refreshed board was missing an incident or responder, so the view was left unchanged.",
      };
    }
  }

  const incidents = scenario.incidents.map((incident) => {
    const update = snapshot.incidents.find((item) => item.id === incident.id);
    if (!update) return incident;
    return {
      ...incident,
      status: update.status,
      priority: update.priority,
      updatedAt: update.updatedAt,
    };
  });
  const responders = scenario.responders.map((responder) => {
    const update = snapshot.responders.find((item) => item.id === responder.id);
    if (!update) return responder;
    return {
      ...responder,
      availability: update.availability,
      updatedAt: update.updatedAt,
    };
  });
  const assignments = snapshot.complete
    ? snapshot.assignments.map((assignment) => ({ ...assignment }))
    : mergeAssignments(scenario.assignments, snapshot.assignments);

  return {
    ok: true,
    scenario: { ...scenario, incidents, responders, assignments },
  };
}

function mergeAssignments(current: Assignment[], incoming: Assignment[]): Assignment[] {
  const merged = current.map((assignment) => ({ ...assignment }));
  for (const assignment of incoming) {
    if (assignment.origin === "scenario_baseline") continue;
    if (merged.some((item) => item.id === assignment.id)) continue;
    if (merged.some((item) => item.incidentId === assignment.incidentId)) continue;
    merged.push({ ...assignment });
  }
  return merged;
}
