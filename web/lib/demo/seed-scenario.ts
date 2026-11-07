import type {
  Assignment,
  AssignmentStatus,
  Incident,
  IncidentCategory,
  IncidentPriority,
  IncidentStatus,
  Report,
  Responder,
  SampleKey,
  Scenario,
} from "@/lib/demo/types";

/**
 * Deterministic fictional flood scenario.
 * Priorities, groupings, and assignments are generator labels for the
 * dashboard. They are not Nemotron output and must not be presented as such.
 * Coordinates are simulated pins on a real OpenStreetMap backdrop.
 */

const SCENARIO_ID = "scn_demo_flood";
const DEFAULT_SEED = 20261107;
const DEFAULT_REPORT_COUNT = 100;
const SCENARIO_CLOCK = Date.UTC(2026, 10, 7, 12, 0, 0);
const UNASSESSED_BASIS =
  "Not yet reviewed in this simulation. No model priority has been assigned.";
const BASELINE_BASIS =
  "Scenario baseline label from the deterministic generator. Not a Nemotron recommendation.";
const ASSIGNMENT_NOTE =
  "Seeded scenario baseline. Not created by Nemotron and not approved in this session.";

const DISTRICTS = [
  { name: "Riverside Ward", lat: 32.7764, lon: -96.806 },
  { name: "North Levee", lat: 32.8072, lon: -96.834 },
  { name: "Harbor Flats", lat: 32.7548, lon: -96.788 },
  { name: "Canal Row", lat: 32.7915, lon: -96.768 },
  { name: "East Bottoms", lat: 32.7633, lon: -96.746 },
  { name: "Mill Crossing", lat: 32.8196, lon: -96.802 },
  { name: "South Embankment", lat: 32.7412, lon: -96.821 },
  { name: "Depot Reach", lat: 32.7848, lon: -96.848 },
] as const;

const DEPTHS = [
  "ankle deep",
  "over the curb",
  "across the roadway",
  "in the stairwell",
  "up to the wheel wells",
] as const;

type RosterEntry = {
  id: string;
  callsign: string;
  capabilities: string[];
  home: number;
  offline?: boolean;
};

const ROSTER: readonly RosterEntry[] = [
  {
    id: "unit_01",
    callsign: "WAVE-1",
    capabilities: ["water rescue", "boat"],
    home: 0,
  },
  {
    id: "unit_02",
    callsign: "WAVE-2",
    capabilities: ["water rescue", "boat"],
    home: 1,
  },
  {
    id: "unit_03",
    callsign: "LEVEE-4",
    capabilities: ["high-water vehicle", "evacuation"],
    home: 1,
  },
  {
    id: "unit_04",
    callsign: "SHELTER-2",
    capabilities: ["evacuation", "shelter transport"],
    home: 2,
  },
  {
    id: "unit_05",
    callsign: "MED-SIM-6",
    capabilities: ["simulated medical support"],
    home: 0,
  },
  {
    id: "unit_06",
    callsign: "UTIL-3",
    capabilities: ["utilities", "power isolation"],
    home: 3,
  },
  {
    id: "unit_07",
    callsign: "SCOUT-8",
    capabilities: ["search", "welfare check"],
    home: 4,
  },
  {
    id: "unit_08",
    callsign: "SCOUT-9",
    capabilities: ["search"],
    home: 5,
    offline: true,
  },
  {
    id: "unit_09",
    callsign: "BOAT-5",
    capabilities: ["water rescue", "boat"],
    home: 6,
  },
  {
    id: "unit_10",
    callsign: "HAUL-7",
    capabilities: ["evacuation", "supplies"],
    home: 7,
  },
  {
    id: "unit_11",
    callsign: "DIKE-1",
    capabilities: ["flood control", "sandbags"],
    home: 6,
  },
  {
    id: "unit_12",
    callsign: "RELAY-11",
    capabilities: ["communications"],
    home: 3,
    offline: true,
  },
];

type ReportTemplate = {
  category: IncidentCategory;
  summary: string;
  texts: readonly string[];
  lowDetail?: boolean;
};

const TEMPLATES: readonly ReportTemplate[] = [
  {
    category: "structure_flood",
    summary:
      "Water inside a block {block} building in {district}, Demo City",
    texts: [
      "Caller in {district}, Demo City, says water is {depth} at block {block}. They cannot tell whether it is still rising.",
      "A second caller for block {block} in {district} says the water is only in the garage. That conflicts with the earlier message. No floor number was given.",
    ],
  },
  {
    category: "structure_flood",
    summary: "Incomplete building report at block {block}, {district}",
    lowDetail: true,
    texts: [
      "Water in a building at block {block}, {district}. The caller hung up before giving a floor or a headcount.",
    ],
  },
  {
    category: "stranded_vehicle",
    summary: "Stalled vehicles at block {block} in {district}, Demo City",
    texts: [
      "Two cars are stopped in water {depth} near block {block} in {district}. People are still with the vehicles.",
      "Update from {district}: the same vehicles have not moved. No injury was described. The water is {depth}.",
    ],
  },
  {
    category: "stranded_vehicle",
    summary: "Single stalled car in {district}, Demo City",
    texts: [
      "One car is stuck {depth} at block {block}, {district}. The caller is on the roof and can wait for a simulated check.",
    ],
  },
  {
    category: "evacuation_assistance",
    summary: "Evacuation help requested in {district}, Demo City",
    texts: [
      "Residents at block {block} in {district} are asking for a ride to higher ground. Water is {depth}. A pet carrier was mentioned, but no names were given.",
      "Follow-up from block {block}: some neighbors already left and others are still packing. The caller does not know who remains.",
    ],
  },
  {
    category: "evacuation_assistance",
    summary: "Short evacuation request in {district}",
    lowDetail: true,
    texts: [
      "Need a way out of {district}, block {block}. That is all the caller said.",
    ],
  },
  {
    category: "welfare_check",
    summary: "Low-detail welfare check in {district}, Demo City",
    lowDetail: true,
    texts: [
      "Someone may still be near block {block} in {district}. No name, no door, and no description of the water.",
    ],
  },
  {
    category: "welfare_check",
    summary: "Welfare check with conflicting occupancy in {district}",
    texts: [
      "A caller thinks an older neighbor is home at block {block}, {district}. They have not seen the person today.",
      "Another caller for block {block} says the apartment looked empty this morning. Neither message includes a name or a callback.",
    ],
  },
  {
    category: "utility_hazard",
    summary: "Utility hazard reported in {district}, Demo City",
    texts: [
      "Sparking was reported on a pole near block {block} in {district}. Water is {depth} around the base. The caller stayed back.",
    ],
  },
  {
    category: "utility_hazard",
    summary: "Darkened block and standing water in {district}",
    texts: [
      "Lights are out along block {block} in {district}. Street water is {depth}.",
      "Second report from {district}: a transformer is humming, but nobody has confirmed a downed line.",
    ],
  },
  {
    category: "water_rescue",
    summary: "People waiting above the water in {district}, Demo City",
    texts: [
      "Three people are on a loading dock at block {block}, {district}. Water is {depth} and moving. They asked for a boat in this fictional report.",
      "Update: the group is still on the dock. One person went back for a bag and returned. No medical details were given.",
    ],
  },
  {
    category: "water_rescue",
    summary: "Boat request with almost no detail in {district}",
    lowDetail: true,
    texts: [
      "Boat needed somewhere in {district}. The caller could not name the block or say how many people were there.",
    ],
  },
  {
    category: "supply_request",
    summary: "Supply request from a fictional shelter corner in {district}",
    texts: [
      "People gathered at block {block} in {district} are asking for drinking water and dry blankets. Street water is {depth}.",
    ],
  },
  {
    category: "supply_request",
    summary: "Unclear supply request in {district}, Demo City",
    lowDetail: true,
    texts: ["Need supplies in {district}. No address and no count of people."],
  },
  {
    category: "structure_flood",
    summary: "Repeated flood messages for block {block}, {district}",
    texts: [
      "First caller: water is entering the lobby at block {block}, {district}, and is {depth}.",
      "Second caller at the same block says the lobby is dry and the water is in the alley instead.",
      "Third caller can hear voices inside but does not know which floor. Missing detail should stay visible for review.",
    ],
  },
];

type CommitInput = {
  summary: string;
  category: IncidentCategory;
  districtName: string;
  lat: number;
  lon: number;
  priority: IncidentPriority;
  status: IncidentStatus;
  lowDetail: boolean;
  texts: string[];
  minutes: number[];
  sampleKey?: SampleKey;
  responder?: Responder;
};

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(items: readonly T[], rng: () => number): T {
  if (items.length === 0) {
    throw new Error("Cannot pick from an empty list");
  }
  const index = Math.min(items.length - 1, Math.floor(rng() * items.length));
  const item = items[index];
  if (item === undefined) {
    throw new Error("Pick missed the list");
  }
  return item;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function roundCoord(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

function jitter(rng: () => number, amount: number): number {
  return (rng() - 0.5) * amount;
}

function isoFromMinute(minute: number): string {
  return new Date(SCENARIO_CLOCK + minute * 60_000).toISOString();
}

function fill(
  template: string,
  district: string,
  block: number,
  depth: string,
): string {
  return template
    .split("{district}")
    .join(district)
    .split("{block}")
    .join(String(block))
    .split("{depth}")
    .join(depth);
}

function pickPriority(
  status: IncidentStatus,
  rng: () => number,
): IncidentPriority {
  if (status === "NEW" || status === "NEEDS_REVIEW") {
    const roll = rng();
    if (roll < 0.72) return "UNASSESSED";
    if (roll < 0.86) return "LOW";
    return "MEDIUM";
  }
  const roll = rng();
  if (roll < 0.1) return "CRITICAL";
  if (roll < 0.34) return "HIGH";
  if (roll < 0.72) return "MEDIUM";
  return "LOW";
}

function pickStatus(rng: () => number): IncidentStatus {
  const roll = rng();
  if (roll < 0.28) return "NEW";
  if (roll < 0.56) return "NEEDS_REVIEW";
  if (roll < 0.7) return "ASSIGNED";
  if (roll < 0.84) return "IN_PROGRESS";
  return "RESOLVED";
}

export function generateFloodScenario(options?: {
  seed?: number;
  reportCount?: number;
}): Scenario {
  const seed = options?.seed ?? DEFAULT_SEED;
  const reportCount = options?.reportCount ?? DEFAULT_REPORT_COUNT;
  if (reportCount < 6) {
    throw new Error("The scripted flood samples need at least 6 reports");
  }

  const rng = mulberry32(seed);
  const incidents: Incident[] = [];
  const reports: Report[] = [];
  const assignments: Assignment[] = [];
  let incidentCounter = 1;
  let reportCounter = 1;
  let minuteCursor = 70;

  const responders: Responder[] = ROSTER.map((entry) => ({
    id: entry.id,
    scenarioId: SCENARIO_ID,
    callsign: entry.callsign,
    capabilities: [...entry.capabilities],
    availability: entry.offline ? "OFFLINE" : "AVAILABLE",
    lat: 0,
    lon: 0,
    updatedAt: isoFromMinute(0),
  }));

  const nextMinute = (): number => {
    const minute = minuteCursor;
    minuteCursor += 3 + Math.floor(rng() * 6);
    return minute;
  };

  const addAssignment = (
    incidentId: string,
    responder: Responder,
    status: AssignmentStatus,
    minute: number,
  ) => {
    const assignedAt = isoFromMinute(minute);
    assignments.push({
      id: `asn_${pad(assignments.length + 1, 4)}`,
      incidentId,
      responderId: responder.id,
      status,
      assignedAt,
      origin: "scenario_baseline",
      note: ASSIGNMENT_NOTE,
    });
    if (status === "ASSIGNED" || status === "IN_PROGRESS") {
      responder.availability = "BUSY";
      responder.updatedAt = assignedAt;
    }
  };

  const commit = (input: CommitInput) => {
    if (input.texts.length !== input.minutes.length) {
      throw new Error("Each fictional report needs a timestamp");
    }
    const incidentId = `inc_${pad(incidentCounter, 4)}`;
    incidentCounter += 1;
    const reportIds: string[] = [];
    const createdReports: Report[] = [];
    input.texts.forEach((text, index) => {
      const reportId = `rpt_${pad(reportCounter, 4)}`;
      reportCounter += 1;
      reportIds.push(reportId);
      const center = (input.texts.length - 1) / 2;
      const minute = input.minutes[index];
      if (minute === undefined) {
        throw new Error(`Missing timestamp for ${reportId}`);
      }
      createdReports.push({
        id: reportId,
        scenarioId: SCENARIO_ID,
        incidentId,
        source: "seed",
        rawText: text,
        reportedLat: roundCoord(input.lat + (index - center) * 0.0012),
        reportedLon: roundCoord(input.lon + (index - center) * 0.001),
        receivedAt: isoFromMinute(minute),
        analysisStatus: "NOT_AI_REVIEWED",
      });
    });
    const firstReport = createdReports[0];
    const lastReport = createdReports[createdReports.length - 1];
    if (!firstReport || !lastReport) {
      throw new Error(`Incident ${incidentId} has no reports`);
    }
    incidents.push({
      id: incidentId,
      scenarioId: SCENARIO_ID,
      summary: input.summary,
      category: input.category,
      district: input.districtName,
      lat: roundCoord(input.lat),
      lon: roundCoord(input.lon),
      priority: input.priority,
      priorityBasis:
        input.priority === "UNASSESSED" ? UNASSESSED_BASIS : BASELINE_BASIS,
      status: input.status,
      lowDetail: input.lowDetail,
      sampleKey: input.sampleKey,
      reportIds,
      createdAt: firstReport.receivedAt,
      updatedAt: lastReport.receivedAt,
    });
    reports.push(...createdReports);
    if (
      input.status === "ASSIGNED" ||
      input.status === "IN_PROGRESS" ||
      input.status === "RESOLVED"
    ) {
      if (!input.responder) {
        throw new Error(`Missing responder for ${incidentId}`);
      }
      const lastMinute = input.minutes[input.minutes.length - 1];
      if (lastMinute === undefined) {
        throw new Error(`Missing assignment time for ${incidentId}`);
      }
      addAssignment(
        incidentId,
        input.responder,
        input.status === "RESOLVED" ? "COMPLETED" : input.status,
        lastMinute,
      );
    }
  };

  const claimAvailable = (): Responder | undefined => {
    const available = responders.filter(
      (responder) => responder.availability === "AVAILABLE",
    );
    // Leave a visible available pool for the dashboard metric.
    if (available.length <= 5) return undefined;
    return pick(available, rng);
  };

  const claimHistorical = (): Responder => {
    const eligible = responders.filter(
      (responder) => responder.availability !== "OFFLINE",
    );
    return pick(eligible, rng);
  };

  commit({
    summary:
      "Conflicting flood reports at Riverside Court, a fictional apartment block in Demo City",
    category: "structure_flood",
    districtName: "Riverside Ward",
    lat: 32.7769,
    lon: -96.8072,
    priority: "UNASSESSED",
    status: "NEEDS_REVIEW",
    lowDetail: false,
    sampleKey: "riverside-court",
    minutes: [18, 26, 34],
    texts: [
      "Water is coming into Riverside Court, a fictional apartment block in Riverside Ward, Demo City. The caller is on a lower floor but cannot tell which one. The hallway is wet and the lights are flickering.",
      "Second message about Riverside Court. A neighbor says the water is at the stairwell, but another resident says it is only in the basement. The floor and the number of people inside are still unknown.",
      "Riverside Court again. The caller can hear people upstairs but cannot confirm a door number or whether anyone needs a boat. Missing details are still part of the original reports.",
    ],
  });

  commit({
    summary: "Incomplete welfare check on a lane in East Bottoms, Demo City",
    category: "welfare_check",
    districtName: "East Bottoms",
    lat: 32.7628,
    lon: -96.7448,
    priority: "UNASSESSED",
    status: "NEW",
    lowDetail: true,
    sampleKey: "quiet-lane",
    minutes: [41],
    texts: [
      "Someone may still be at the far end of a lane in East Bottoms, Demo City. The caller does not know the house, the name, or whether the water has reached the door.",
    ],
  });

  const wave2 = responders.find((responder) => responder.callsign === "WAVE-2");
  if (!wave2) {
    throw new Error("Scripted roster is missing WAVE-2");
  }

  commit({
    summary:
      "Two fictional vehicles stranded on the North Levee service road",
    category: "stranded_vehicle",
    districtName: "North Levee",
    lat: 32.8084,
    lon: -96.8326,
    priority: "HIGH",
    status: "IN_PROGRESS",
    lowDetail: false,
    sampleKey: "levee-road",
    responder: wave2,
    minutes: [48, 57],
    texts: [
      "Two vehicles are stalled on the North Levee service road in Demo City. The occupants are on the roofs. Water is moving across the roadway. This is a fictional scenario report.",
      "Update for the North Levee service road. The same two vehicles are still stranded. No injuries were described. The water has not dropped.",
    ],
  });

  let reportsRemaining = reportCount - reports.length;
  let guard = 0;
  while (reportsRemaining > 0) {
    guard += 1;
    if (guard > 200) {
      throw new Error("Scenario generator did not finish");
    }
    const eligible = TEMPLATES.filter(
      (template) => template.texts.length <= reportsRemaining,
    );
    const template = pick(eligible, rng);
    const district = pick(DISTRICTS, rng);
    const block = 12 + Math.floor(rng() * 70);
    const depth = pick(DEPTHS, rng);
    const texts = template.texts.map((text) =>
      fill(text, district.name, block, depth),
    );
    const minutes = texts.map(() => nextMinute());
    let status = pickStatus(rng);
    let responder: Responder | undefined;
    if (status === "ASSIGNED" || status === "IN_PROGRESS") {
      responder = claimAvailable();
      if (!responder) status = "NEEDS_REVIEW";
    } else if (status === "RESOLVED") {
      responder = claimHistorical();
    }
    const priority = pickPriority(status, rng);
    commit({
      summary: fill(template.summary, district.name, block, depth),
      category: template.category,
      districtName: district.name,
      lat: district.lat + jitter(rng, 0.012),
      lon: district.lon + jitter(rng, 0.012),
      priority,
      status,
      lowDetail: template.lowDetail === true,
      texts,
      minutes,
      responder,
    });
    reportsRemaining -= texts.length;
  }

  for (const entry of ROSTER) {
    const responder = responders.find((item) => item.id === entry.id);
    const home = DISTRICTS[entry.home];
    if (!responder || !home) {
      throw new Error(`Roster placement failed for ${entry.callsign}`);
    }
    const active = assignments.find(
      (assignment) =>
        assignment.responderId === responder.id &&
        (assignment.status === "ASSIGNED" ||
          assignment.status === "IN_PROGRESS"),
    );
    const incident = active
      ? incidents.find((item) => item.id === active.incidentId)
      : undefined;
    responder.lat = roundCoord((incident?.lat ?? home.lat) + jitter(rng, 0.01));
    responder.lon = roundCoord((incident?.lon ?? home.lon) + jitter(rng, 0.01));
  }

  const mapCenter = {
    lat: roundCoord(
      incidents.reduce((sum, incident) => sum + incident.lat, 0) /
        incidents.length,
    ),
    lon: roundCoord(
      incidents.reduce((sum, incident) => sum + incident.lon, 0) /
        incidents.length,
    ),
  };

  const scenario: Scenario = {
    id: SCENARIO_ID,
    name: "Urban Flood — Demo City",
    disasterType: "urban_flood",
    description:
      "Deterministic fictional flood for dashboard development. Every report is synthetic. Priorities and assignments are scenario baseline labels, not model findings.",
    seed,
    fictionalLocation: "Demo City",
    mapCenter,
    incidents,
    reports,
    responders,
    assignments,
  };

  assertScenario(scenario, seed, reportCount);
  return scenario;
}

function assertScenario(
  scenario: Scenario,
  seed: number,
  reportCount: number,
): void {
  const errors: string[] = [];
  if (scenario.seed !== seed) errors.push("seed mismatch");
  if (scenario.reports.length !== reportCount) {
    errors.push(`expected ${reportCount} reports, found ${scenario.reports.length}`);
  }
  if (scenario.responders.length !== ROSTER.length) {
    errors.push("responder count");
  }

  const incidentIds = new Set<string>();
  for (const incident of scenario.incidents) {
    if (incidentIds.has(incident.id)) errors.push(`duplicate ${incident.id}`);
    incidentIds.add(incident.id);
    const linked = scenario.reports.filter(
      (report) => report.incidentId === incident.id,
    );
    if (linked.length === 0) errors.push(`${incident.id} has no reports`);
    if (linked.length !== incident.reportIds.length) {
      errors.push(`${incident.id} report id mismatch`);
    }
    for (const reportId of incident.reportIds) {
      if (!linked.some((report) => report.id === reportId)) {
        errors.push(`${incident.id} missing ${reportId}`);
      }
    }
    if (!incident.summary.trim() || !incident.priorityBasis.trim()) {
      errors.push(`${incident.id} missing summary or basis`);
    }
  }

  const reportIds = new Set<string>();
  for (const report of scenario.reports) {
    if (reportIds.has(report.id)) errors.push(`duplicate ${report.id}`);
    reportIds.add(report.id);
    if (!incidentIds.has(report.incidentId)) {
      errors.push(`orphan ${report.id}`);
    }
    if (report.analysisStatus !== "NOT_AI_REVIEWED") {
      errors.push(`${report.id} was marked reviewed`);
    }
    if (!report.rawText.trim()) errors.push(`empty ${report.id}`);
  }

  const samples = new Set(
    scenario.incidents
      .map((incident) => incident.sampleKey)
      .filter((key): key is SampleKey => key !== undefined),
  );
  for (const key of ["riverside-court", "quiet-lane", "levee-road"] as const) {
    if (!samples.has(key)) errors.push(`missing sample ${key}`);
  }

  const responderIds = new Set(
    scenario.responders.map((responder) => responder.id),
  );
  const activeByResponder = new Map<string, number>();
  const assignmentsByIncident = new Map<string, Assignment[]>();
  for (const assignment of scenario.assignments) {
    if (!incidentIds.has(assignment.incidentId)) {
      errors.push(`bad assignment incident ${assignment.incidentId}`);
    }
    if (!responderIds.has(assignment.responderId)) {
      errors.push(`bad assignment responder ${assignment.responderId}`);
    }
    if (assignment.origin !== "scenario_baseline") {
      errors.push(`unexpected origin ${assignment.id}`);
    }
    const list = assignmentsByIncident.get(assignment.incidentId) ?? [];
    list.push(assignment);
    assignmentsByIncident.set(assignment.incidentId, list);
    if (assignment.status === "ASSIGNED" || assignment.status === "IN_PROGRESS") {
      activeByResponder.set(
        assignment.responderId,
        (activeByResponder.get(assignment.responderId) ?? 0) + 1,
      );
    }
  }

  for (const responder of scenario.responders) {
    const active = activeByResponder.get(responder.id) ?? 0;
    if (active > 1) errors.push(`double booked ${responder.callsign}`);
    if (responder.availability === "BUSY" && active !== 1) {
      errors.push(`busy mismatch ${responder.callsign}`);
    }
    if (responder.availability !== "BUSY" && active !== 0) {
      errors.push(`availability mismatch ${responder.callsign}`);
    }
  }

  for (const incident of scenario.incidents) {
    const related = assignmentsByIncident.get(incident.id) ?? [];
    if (incident.status === "NEW" || incident.status === "NEEDS_REVIEW") {
      if (related.length !== 0) errors.push(`${incident.id} should be unassigned`);
    } else if (incident.status === "RESOLVED") {
      if (related.length !== 1 || related[0]?.status !== "COMPLETED") {
        errors.push(`${incident.id} resolved assignment`);
      }
    } else if (related.length !== 1 || related[0]?.status !== incident.status) {
      errors.push(`${incident.id} active assignment`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Scenario failed validation:\n${errors.join("\n")}`);
  }
}
