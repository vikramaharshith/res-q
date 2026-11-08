export const INCIDENT_PRIORITIES = [
  "UNASSESSED",
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
] as const;

export type IncidentPriority = (typeof INCIDENT_PRIORITIES)[number];

export const INCIDENT_STATUSES = [
  "NEW",
  "NEEDS_REVIEW",
  "ASSIGNED",
  "IN_PROGRESS",
  "RESOLVED",
] as const;

export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const RESPONDER_AVAILABILITIES = [
  "AVAILABLE",
  "BUSY",
  "OFFLINE",
] as const;

export type ResponderAvailability = (typeof RESPONDER_AVAILABILITIES)[number];

export const INCIDENT_CATEGORIES = [
  "structure_flood",
  "stranded_vehicle",
  "evacuation_assistance",
  "welfare_check",
  "utility_hazard",
  "water_rescue",
  "supply_request",
] as const;

export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];

export const SAMPLE_KEYS = [
  "riverside-court",
  "quiet-lane",
  "levee-road",
] as const;

export type SampleKey = (typeof SAMPLE_KEYS)[number];

export type AnalysisStatus = "NOT_AI_REVIEWED";

export const ASSIGNMENT_ORIGINS = [
  "scenario_baseline",
  "human_approval",
  "human_override",
] as const;

export type AssignmentOrigin = (typeof ASSIGNMENT_ORIGINS)[number];

export type AssignmentStatus = "ASSIGNED" | "IN_PROGRESS" | "COMPLETED";

export interface Report {
  id: string;
  scenarioId: string;
  incidentId: string;
  source: "seed";
  rawText: string;
  reportedLat: number;
  reportedLon: number;
  receivedAt: string;
  analysisStatus: AnalysisStatus;
}

export interface Incident {
  id: string;
  scenarioId: string;
  summary: string;
  category: IncidentCategory;
  district: string;
  lat: number;
  lon: number;
  priority: IncidentPriority;
  priorityBasis: string;
  status: IncidentStatus;
  lowDetail: boolean;
  sampleKey?: SampleKey;
  reportIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Responder {
  id: string;
  scenarioId: string;
  callsign: string;
  capabilities: string[];
  availability: ResponderAvailability;
  lat: number;
  lon: number;
  updatedAt: string;
}

export interface Assignment {
  id: string;
  incidentId: string;
  responderId: string;
  status: AssignmentStatus;
  assignedAt: string;
  origin: AssignmentOrigin;
  note: string;
}

export interface Scenario {
  id: string;
  name: string;
  disasterType: "urban_flood";
  description: string;
  seed: number;
  fictionalLocation: string;
  mapCenter: { lat: number; lon: number };
  incidents: Incident[];
  reports: Report[];
  responders: Responder[];
  assignments: Assignment[];
}
