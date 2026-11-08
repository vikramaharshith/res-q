import type { Scenario } from "@/lib/demo/types";

export interface ScenarioMetrics {
  totalReports: number;
  needsReview: number;
  availableResponders: number;
  simulatedAssignments: number;
  baselineAssignments: number;
  humanAssignments: number;
}

export function getScenarioMetrics(scenario: Scenario): ScenarioMetrics {
  return {
    totalReports: scenario.reports.length,
    needsReview: scenario.incidents.filter(
      (incident) =>
        incident.status === "NEW" || incident.status === "NEEDS_REVIEW",
    ).length,
    availableResponders: scenario.responders.filter(
      (responder) => responder.availability === "AVAILABLE",
    ).length,
    simulatedAssignments: scenario.assignments.length,
    baselineAssignments: scenario.assignments.filter(
      (assignment) => assignment.origin === "scenario_baseline",
    ).length,
    humanAssignments: scenario.assignments.filter(
      (assignment) => assignment.origin !== "scenario_baseline",
    ).length,
  };
}

export function reportsForIncident(scenario: Scenario, incidentId: string) {
  return scenario.reports
    .filter((report) => report.incidentId === incidentId)
    .sort((left, right) => {
      const byTime = left.receivedAt.localeCompare(right.receivedAt);
      if (byTime !== 0) return byTime;
      return left.id.localeCompare(right.id);
    });
}

export function assignmentForIncident(scenario: Scenario, incidentId: string) {
  return scenario.assignments.find(
    (assignment) => assignment.incidentId === incidentId,
  );
}

export function responderById(scenario: Scenario, responderId: string) {
  return scenario.responders.find((responder) => responder.id === responderId);
}
