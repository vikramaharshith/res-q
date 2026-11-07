import type {
  AssignmentStatus,
  IncidentCategory,
  IncidentPriority,
  IncidentStatus,
  ResponderAvailability,
  SampleKey,
} from "@/lib/demo/types";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const month = MONTHS[date.getUTCMonth()] ?? "UTC";
  const day = date.getUTCDate();
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${month} ${day}, ${hours}:${minutes} UTC`;
}

export function formatCoordinates(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export function priorityLabel(priority: IncidentPriority): string {
  switch (priority) {
    case "UNASSESSED":
      return "Unassessed";
    case "LOW":
      return "Low";
    case "MEDIUM":
      return "Medium";
    case "HIGH":
      return "High";
    case "CRITICAL":
      return "Critical";
  }
}

export function statusLabel(status: IncidentStatus): string {
  switch (status) {
    case "NEW":
      return "New";
    case "NEEDS_REVIEW":
      return "Needs review";
    case "ASSIGNED":
      return "Assigned";
    case "IN_PROGRESS":
      return "In progress";
    case "RESOLVED":
      return "Resolved";
  }
}

export function assignmentStatusLabel(status: AssignmentStatus): string {
  switch (status) {
    case "ASSIGNED":
      return "Assigned";
    case "IN_PROGRESS":
      return "In progress";
    case "COMPLETED":
      return "Completed";
  }
}

export function availabilityLabel(availability: ResponderAvailability): string {
  switch (availability) {
    case "AVAILABLE":
      return "Available";
    case "BUSY":
      return "Busy";
    case "OFFLINE":
      return "Offline";
  }
}

export function categoryLabel(category: IncidentCategory): string {
  switch (category) {
    case "structure_flood":
      return "Structure flood";
    case "stranded_vehicle":
      return "Stranded vehicle";
    case "evacuation_assistance":
      return "Evacuation assistance";
    case "welfare_check":
      return "Welfare check";
    case "utility_hazard":
      return "Utility hazard";
    case "water_rescue":
      return "Water rescue";
    case "supply_request":
      return "Supply request";
  }
}

export function sampleLabel(sampleKey: SampleKey): string {
  switch (sampleKey) {
    case "riverside-court":
      return "Scripted sample · conflicting reports";
    case "quiet-lane":
      return "Scripted sample · low detail";
    case "levee-road":
      return "Scripted sample · baseline assignment";
  }
}

export function priorityBadgeClass(priority: IncidentPriority): string {
  switch (priority) {
    case "CRITICAL":
      return "bg-rose-500/15 text-rose-200 ring-rose-400/50";
    case "HIGH":
      return "bg-orange-500/15 text-orange-200 ring-orange-400/50";
    case "MEDIUM":
      return "bg-amber-400/15 text-amber-100 ring-amber-300/50";
    case "LOW":
      return "bg-sky-400/15 text-sky-100 ring-sky-300/50";
    case "UNASSESSED":
      return "bg-slate-400/10 text-slate-300 ring-slate-400/40";
  }
}

export function statusBadgeClass(status: IncidentStatus): string {
  switch (status) {
    case "NEW":
      return "bg-cyan-400/15 text-cyan-100 ring-cyan-300/50";
    case "NEEDS_REVIEW":
      return "bg-amber-400/15 text-amber-100 ring-amber-300/50";
    case "ASSIGNED":
      return "bg-violet-400/15 text-violet-100 ring-violet-300/50";
    case "IN_PROGRESS":
      return "bg-blue-400/15 text-blue-100 ring-blue-300/50";
    case "RESOLVED":
      return "bg-emerald-400/15 text-emerald-100 ring-emerald-300/50";
  }
}

export function availabilityBadgeClass(
  availability: ResponderAvailability,
): string {
  switch (availability) {
    case "AVAILABLE":
      return "bg-teal-400/15 text-teal-100 ring-teal-300/50";
    case "BUSY":
      return "bg-pink-400/15 text-pink-100 ring-pink-300/50";
    case "OFFLINE":
      return "bg-slate-500/15 text-slate-300 ring-slate-400/40";
  }
}

export function statusHex(status: IncidentStatus): string {
  switch (status) {
    case "NEW":
      return "#22d3ee";
    case "NEEDS_REVIEW":
      return "#fbbf24";
    case "ASSIGNED":
      return "#a78bfa";
    case "IN_PROGRESS":
      return "#60a5fa";
    case "RESOLVED":
      return "#34d399";
  }
}

export function availabilityHex(availability: ResponderAvailability): string {
  switch (availability) {
    case "AVAILABLE":
      return "#2dd4bf";
    case "BUSY":
      return "#f472b6";
    case "OFFLINE":
      return "#64748b";
  }
}

export const ANALYSIS_LABEL = "Not yet AI-reviewed";
