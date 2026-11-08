# Chaos Engine

Chaos Engine is a standalone deterministic TypeScript simulation engine for
RES-Q by B7. It does not depend on the separate RES-Q application, a database,
a dashboard, a web framework, or an external AI service.

Phase 4 adds deterministic information uncertainty to the scalable fictional
emergency observations from Phases 1–3. Narratives are assembled from local
templates and structured observable claims; no language model is involved.

Phase 5 adds bounded disaster evolution, explicit cascade rules, fictional
infrastructure state, secondary incidents, and event-driven follow-up reports.

Phase 6A adds the responder foundation: deterministic registration, immutable
resource configuration, validated availability transitions, and responder
history integrated with the existing virtual clock and event queue.

Phase 6B adds deterministic fictional task management, capability matching,
and an optional baseline assignment policy. Automatic assignment is disabled by
default.

Phase 6C adds bounded fictional road routing, responder travel through virtual
time, road degradation and closure handling, versioned rerouting, and safe
arrival integration with task state.

Phase 6D adds deterministic simulated communication links, delayed and failed
operational messages, delivered-only command-center knowledge, and an explicit
actual-versus-known state boundary.

Phase 6E adds bounded fatigue, typed consumable and reusable resources,
equipment condition, post-task recovery, and conserved fictional-stockpile
replenishment.

Phase 6F combines the prior systems into deterministic end-to-end responder
workloads, adds reusable CALM/BUSY/CHAOS/EXTREME fixtures, recursive public-data
audits, canonical replay comparisons, operational metrics, and stress
benchmarks. It is the final part of Phase 6.

Phase 7A adds the versioned `resq.simulation.v1` public JSON contract,
allowlisted emergency and operational projections, dependency-free validation,
canonical serialization, and safe explicit local file writing.

Phase 7C profiles and hardens the completed engine. It preserves the existing
RNG byte stream while avoiding repeated hashing of the large canonical
configuration for every named random stream, and adds repeatable CPU, memory,
queue, event, export, validation, and serialization benchmarks.

Phase 8 independently audits the complete standalone system, tightens the
existing `resq.simulation.v1` schema/validator agreement, records current CLI,
security, determinism, safety, performance, and build evidence, and supplies a
documentation-only future integration handoff. See
[`RELEASE_READINESS.md`](RELEASE_READINESS.md) and
[`INTEGRATION_HANDOFF.md`](INTEGRATION_HANDOFF.md). No RES-Q or external-service
integration is included.

## Requirements and commands

- Node.js 22 or newer
- npm

```powershell
npm.cmd install
npm.cmd run typecheck
npm.cmd test
npm.cmd run check
npm.cmd run build
npm.cmd run benchmark:phase6f
npm.cmd run benchmark:phase7a
npm.cmd run benchmark:phase7c
```

`npm run check` runs strict TypeScript validation followed by all tests. The
build command writes ESM JavaScript, declarations, and source maps to `dist/`.

## Command-line quick start

The Phase 7B CLI runs entirely locally and always labels output as fictional.
From Windows PowerShell:

```powershell
npm.cmd install
npm.cmd run chaos -- help
npm.cmd run chaos -- presets
npm.cmd run chaos -- preview --scenario flood --difficulty calm --seed demo-42
npm.cmd run chaos -- simulate --scenario earthquake --difficulty chaos --seed training-001 --out simulation.json
npm.cmd run chaos -- validate --input simulation.json
npm.cmd run chaos -- replay --input simulation.json
```

Available commands are `help`, `presets`, `preview`, `simulate`, `validate`,
`replay`, and `version`. `simulate` writes nothing unless `--out` is supplied.
Existing files are refused unless `--overwrite` is explicit. Errors are concise,
omit stack traces, and return a nonzero exit code: `2` for command-line usage
errors and `1` for invalid files, failed validation/replay, simulation failure,
or file-system errors.

Scenarios are independently selectable as `flood`, `earthquake`, `storm`, and
`fire`. They have stable IDs, fictional names/geography, deterministic seeded
initial conditions, and map to the existing flood, earthquake-aftermath,
severe-storm, and urban-fire evolution models. Difficulty is independently
selectable as `calm`, `busy`, `chaos`, or `extreme`:

| Difficulty | Base reports | Responders | Tasks | Intended use |
| --- | ---: | ---: | ---: | --- |
| CALM | 100 | 10 | 8 | Fast daily development |
| BUSY | 1,000 | 50 | 25 + 3 shortage | Moderate competition and noise |
| CHAOS | 5,000 | 100 | 50 + 8 shortage | Shortages, cascades, and high noise |
| EXTREME | 10,000 | 200 | 100 + 20 shortage | Explicit heavy stress workload |

Safe deterministic overrides are `--seed`, `--reports` (1–10,000),
`--responders` (1–1,000), `--duration` (600,000–604,800,000 virtual
milliseconds), and `--samples` (0–10 timeline entries). The resolved scenario,
difficulty, seed, report count, responder count, duration, preset version,
engine version, and schema version are saved in the public `replayManifest`.
Arbitrary JSON configuration is not accepted.

`preview` prints compact public-safe counts and a chronological sample rather
than thousands of observations. Contradiction classifications remain private,
so the preview reports them as not publicly classified. `replay` validates the
input and version compatibility, reconstructs the run from the complete safe
manifest, and compares canonical public JSON byte-for-byte. It never changes
the original file. Exports without a Phase 7B manifest remain valid Phase 7A
documents but cannot be replayed by the CLI.

## Architecture

- `src/core/` contains seeded named RNG streams, the virtual clock, and the
  stable binary-heap event queue.
- `src/simulation/` contains configuration validation, deterministic IDs,
  incident, responder, task, and travel transition rules; capability matching;
  fictional road routing; event types; immutable state; and engine control.
- `src/reporting/types.ts` defines internal reports, public observations,
  report-generation configuration, categories, sources, and the explicit
  allowlisted public projection.
- `src/reporting/geography.ts` validates fictional geography and produces
  deterministic incident-centered local-grid locations.
- `src/reporting/report-generator.ts` creates deterministic timing, sources,
  claims, urgency, narrative variation, and report IDs.
- `src/reporting/noise.ts` validates information-noise settings, applies bounded
  transformations, indexes relationships, and creates private evaluations.
- `src/evolution/evolution.ts` plans normalized environmental timelines,
  threshold-based cascade applications, infrastructure changes, and observable
  consequences for flood, severe storm, earthquake aftermath, and urban fire.

Simulation decisions never call `Math.random()` or read wall-clock time. Report
content, timing, source, location offsets, and identifiers use separate named
random streams per report so changes to one concern do not shift later reports.

## Simulation and incident lifecycle

An engine begins in `READY`. Call `start()` or `resume()` before processing:

- `processNextEvent()` steps one queued event.
- `advanceBy(durationMs)` advances a simulated duration.
- `advanceUntil(timestampMs)` processes events through a virtual timestamp.
- `runUntilEmpty()` drains the bounded queue and enters `COMPLETED`.
- `pause()` stops processing, and `reset()` recreates initial state and IDs.

Incidents follow controlled transitions:

```text
DETECTED -> ACTIVE -> ESCALATING -> ACTIVE
                 \-> STABILIZING -> RESOLVED
ESCALATING --------^
```

Severity is an integer from 1 through 10. `RESOLVED` is terminal. An invalid
queued transition fails deterministically without partially changing incident
state; reset is required after a `FAILED` run.

## Responder foundation

`initialResponders` registers ambulance, fire engine, water rescue, search and
rescue, police, utility repair, evacuation transport, and supply delivery units.
Runtime registration uses `registerResponder()`. Every unit has a deterministic
ID and callsign, explicitly fictional simulated-grid location, crew capacity,
capabilities, and bounded equipment inventory. Configuration may set custom IDs
with the `rsp_custom_` prefix and unique uppercase callsigns.

Responder state uses the same stable queue and virtual clock as every other
simulation event. Call `scheduleResponderStateTransition()` for validated
changes among `AVAILABLE`, `RESERVED`, `EN_ROUTE`, `ON_SCENE`, `BUSY`,
`RECOVERING`, and `OFFLINE`. Registration and transitions appear in the main
event history and in each responder's deeply immutable state history.

The controlled lifecycle is:

```text
AVAILABLE -> RESERVED -> EN_ROUTE -> ON_SCENE -> BUSY
    ^            |           |          |          |
    |            v           +----------+----------+
    +------ RECOVERING <-----------------+

AVAILABLE <-> OFFLINE
```

Additional safe exits to `OFFLINE` are allowed from every active state. A queued
invalid transition fails deterministically without partially mutating the unit.
`reset()` restores initial registration events, generated identities, and
histories exactly, allowing byte-for-byte replay.

## Task management and baseline assignment

`createTask()` queues a deterministic fictional response task for an existing
incident. Tasks carry required capabilities, equipment quantities, crew
capacity, optional eligible responder types, priority, estimated effort,
timestamps, assignment metadata, and immutable causal event history. Custom IDs
use the `task_custom_` prefix. Multiple tasks may refer to the same incident.

Task state is controlled by validated events:

```text
PENDING --assignment event--> ASSIGNED -> EN_ROUTE -> IN_PROGRESS -> COMPLETED
   |                              |           |             |
   +------------------------------+-----------+-------------+-> FAILED
   +------------------------------+-----------+-------------+-> CANCELLED
```

Terminal task states cannot transition. Completing a task never resolves its
incident. `EN_ROUTE` and `IN_PROGRESS` are caller-driven markers only in Phase
6B: the engine does not calculate routes, move responders, infer arrival, apply
travel time, or complete work based on travel.

`getEligibleRespondersForTask()` evaluates only observable task requirements and
permitted responder telemetry: responder type, declared capabilities,
availability, crew capacity, equipment inventory, and existing active task
assignments. It never receives incident severity, hidden evolution state,
private report evaluation, future events, or future observations.

The baseline policy filters out unavailable, under-crewed, under-equipped,
wrong-type, missing-capability, and already-assigned responders. Eligible units
are ordered by smallest crew surplus, then smallest surplus of required
equipment, then ASCII callsign and responder ID. Same-time automatic decisions
process higher task priorities first. Every assignment has the sole origin
`SIMULATION_BASELINE`; it is fictional simulation output, not an external model
recommendation or an operational approval.

Manual simulation assignment uses `assignTask()`. Explicit automatic attempts
use `requestAutomaticTaskAssignment()`. Setting
`automaticTaskAssignment: true` requests one baseline attempt after each task
creation; the default is `false`. If no unit is eligible, the decision is
recorded and the task remains `PENDING`.

Assignment changes an `AVAILABLE` responder to `RESERVED` and prevents that unit
from holding another active task. Phase 6B deliberately does not synchronize
task travel markers with responder location or automatically release/recover a
unit after terminal task state; callers must submit explicit Phase 6A responder
telemetry transitions. That coupling is the Phase 6C travel boundary.

## Responder travel and fictional roads

Phase 6C supplies a bounded, explicitly fictional road graph. A `roadNetwork`
configuration contains simulated-grid nodes and directed or bidirectional road
segments. Each segment has integer distance, speed, congestion in permille,
current access state, and an optional `infrastructureType: "ROAD"` link to the
Phase 5 road entity. Defaults provide a small fictional grid; callers may supply
their own graph within the node and segment limits.

Road states are `ACCESSIBLE`, `DEGRADED`, `BLOCKED`, and `UNKNOWN`. Blocked
segments are excluded from routing. Degraded segments double their base travel
cost, unknown segments use a cautious multiplier, and congestion applies an
integer permille multiplier. Segment time is calculated deterministically from
distance, the lower of responder and segment speed, road state, and congestion.
Connectors from a responder or incident location to the nearest fictional node
also consume positive virtual time for nonzero distance.

Routing uses deterministic Dijkstra shortest path. Equal-cost paths break ties
by ASCII segment path and node ID. It never calls a map service, claims
real-world accuracy, reads future events, or inspects incident severity or
private report evaluation.

### Movement and events

`departResponder()` requires a valid `ASSIGNED` task and its `RESERVED`
responder. The departure event calculates a route using only the road state
available at that virtual time, then transitions both to `EN_ROUTE`. It records
the start, destination, route, distance, speed, departure, estimated arrival,
current location, progress, and causal history. Progress is interpolated along
route legs from elapsed virtual time; the unit never jumps to the incident at
departure.

Travel uses typed `RESPONDER_DEPART`, `TRAVEL_PROGRESS`, `TRAVEL_REROUTE`,
`TRAVEL_BLOCKED`, `TRAVEL_INTERRUPT`, and `RESPONDER_ARRIVE` events. Every route
has a monotonically increasing version. Rerouting invalidates older progress and
arrival events; when those events later leave the stable queue they are recorded
as safely ignored instead of moving the responder or failing the run.

Successful arrival moves the responder to the exact fictional destination and
transitions `EN_ROUTE -> ON_SCENE`. Only then may the task enter `IN_PROGRESS`,
which transitions the responder to `BUSY`. Task completion still does not
resolve its incident.

### Closures, rerouting, and Phase 5

`scheduleRoadStateChange()` changes a segment through the event queue. If the
changed segment remains on an active route, the engine first projects the unit
to the closure time, then performs one deterministic reroute from that location.
The estimated arrival is replaced and the triggering road event is retained as
the reroute cause. Phase 5 `ROAD` infrastructure changes apply the same mapping
to every segment explicitly linked with `infrastructureType: "ROAD"`:

- `OPERATIONAL` -> `ACCESSIBLE`
- `DEGRADED` or `RECOVERING` -> `DEGRADED`
- `OFFLINE` -> `BLOCKED`

If no route exists, travel becomes `BLOCKED` at its current position and cannot
produce a valid arrival. `retryTravel()` provides an explicit bounded retry
after road state changes. `interruptTravel()` stops an active attempt. Task
failure or cancellation cancels its travel version, so queued progress and
arrival events cannot create phantom movement.

The engine bounds road nodes, segments, travel attempts, progress events,
reroutes, retries, route duration, coordinates, and reserved queue capacity.
Travel and road snapshots, route legs, and histories are deeply immutable and
are rebuilt exactly by `reset()` and replay.

### Reproducible reroute example

```ts
const engine = new SimulationEngine({
  scenarioId: "fictional-reroute-demo",
  seed: "route-17",
  startTimeMs: 0,
  maxDurationMs: 60_000,
  initialIncidents: [{
    incidentType: "FICTIONAL_WATER_RESCUE",
    location: { latitude: 0, longitude: 20, label: "Simulated rescue site" },
    severity: 4,
  }],
  initialResponders: [{
    responderType: "WATER_RESCUE",
    location: {
      fictional: true,
      coordinateSystem: "SIMULATED_LOCAL_GRID",
      x: 0,
      y: 0,
      label: "Fictional rescue base",
    },
    crewCapacity: 4,
    equipmentInventory: { rescueBoat: 1 },
  }],
  roadNetwork: {
    nodes: [
      { id: "node_a", location: { fictional: true, coordinateSystem: "SIMULATED_LOCAL_GRID", x: 0, y: 0 } },
      { id: "node_b", location: { fictional: true, coordinateSystem: "SIMULATED_LOCAL_GRID", x: 10, y: 0 } },
      { id: "node_c", location: { fictional: true, coordinateSystem: "SIMULATED_LOCAL_GRID", x: 20, y: 0 } },
      { id: "node_d", location: { fictional: true, coordinateSystem: "SIMULATED_LOCAL_GRID", x: 10, y: 10 } },
    ],
    segments: [
      { id: "road_ab", fromNodeId: "node_a", toNodeId: "node_b", distanceUnits: 10, speedUnitsPerSecond: 10 },
      { id: "road_bc", fromNodeId: "node_b", toNodeId: "node_c", distanceUnits: 10, speedUnitsPerSecond: 10 },
      { id: "road_ad", fromNodeId: "node_a", toNodeId: "node_d", distanceUnits: 14, speedUnitsPerSecond: 10 },
      { id: "road_dc", fromNodeId: "node_d", toNodeId: "node_c", distanceUnits: 14, speedUnitsPerSecond: 10 },
    ],
  },
});

const incidentId = engine.getState().incidents[0]!.id;
engine.createTask({
  relatedIncidentId: incidentId,
  requiredCapabilities: ["WATER_RESCUE"],
  requiredEquipment: { rescueBoat: 1 },
  requiredCrewCapacity: 2,
  priority: "HIGH",
  estimatedEffortMs: 10_000,
});
engine.start();
engine.runUntilEmpty();

const taskId = engine.getTasks()[0]!.id;
engine.assignTask(taskId, engine.getResponders()[0]!.id);
engine.start();
engine.runUntilEmpty();

engine.departResponder(taskId, 0, {
  responderSpeedUnitsPerSecond: 10,
  progressIntervalMs: 500,
});
engine.scheduleRoadStateChange("road_bc", "BLOCKED", 500);
engine.start();
engine.runUntilEmpty();

const travel = engine.getTravels()[0]!;
// The versioned route uses road_ad -> road_dc and arrives at the simulated site.
console.log(travel.status, travel.routeVersion, travel.route?.segmentIds);
```

## Report generation

Call `scheduleReports()` only for incidents that already exist. It accepts:

- `reportCount` — required integer from 1 through 10,000 per call
- `incidentIds` — optional subset of existing incidents
- `startTimeMs` — first observation time, defaulting to current virtual time
- `frequencyMs` — simulated spacing between observations, default 1,000 ms
- `categories` — optional deterministic category rotation
- `sourceWeights` — optional weights for each source type
- `geography` — optional explicitly fictional place-name and local-grid setup
- `noise` — optional Phase 4 uncertainty configuration

The complete batch is validated against remaining event capacity and maximum
simulation duration before report IDs or events are consumed. Report events are
scheduled at `receivedAtMs`; reports are not visible in engine state before that
event is processed. Generation and queue processing support 10,000 base reports.

`reportCount` means base reports. Duplicates are additional final reports and
are preflighted against worst-case event and final-report limits.

All report timestamps satisfy:

```text
observedAtMs <= submittedAtMs <= receivedAtMs
```

Reporting and transmission delays are deterministic. Phase 4 can add bounded
delay and out-of-order receipt without violating timestamp ordering.

## Supported categories

- Flooded structure
- Stranded vehicle
- Water rescue
- Evacuation request
- Medical assistance
- Structure fire
- Building collapse
- Road obstruction
- Electrical hazard
- Communication outage
- Power outage
- Shelter shortage
- Supply request
- Infrastructure failure
- Welfare check
- Hazardous conditions

The exported `REPORT_CATEGORIES` constant provides the canonical machine values.

## Supported source types

- Civilian caller
- Emergency responder
- Automated sensor
- Emergency hotline
- Community organization
- Field observer

The exported `REPORT_SOURCE_TYPES` constant provides the canonical machine
values. Public source metadata contains only safe channel, fictional
organization, or simulated sensor descriptions—never reliability scores or
private contact information.

## Fictional geography

Every observation location is marked `fictional: true` and uses
`SIMULATED_LOCAL_GRID`, never a real-world coordinate claim. Default and custom
districts, roads, landmarks, and buildings must explicitly contain “Fictional”
or “Simulated.” Reports for the same incident share a deterministic geographic
cluster with small local-grid offsets.

## Observation boundary

Internal `EmergencyReport` records retain `internalIncidentId` for simulation
bookkeeping. `getPublicObservations()` constructs a new allowlisted
`PublicEmergencyObservation`; it does not serialize an internal report and then
remove fields.

Public observations include report identity, run identity, category, source,
fictional location, virtual timestamps, narrative, observable claims, status,
optional urgency, and safe source metadata. They exclude:

- Internal incident identifiers
- Actual incident severity
- Internal causal event identifiers
- Hidden state or future changes
- Privileged reliability data

Internal reports and public observations are deeply frozen.

## Information noise

Omitting `noise` preserves Phase 3 output. Passing `noise: {}` activates
validated low-noise defaults. Separate probabilities control duplicates,
contradictions, missing detail, added delay, stale candidates, and location
error. Configuration also supports:

- Up to five duplicates per base report
- Minimum and maximum added delivery delay
- A maximum simulated-grid location offset
- Per-source quality multipliers and confidence adjustment
- Boolean deterministic probability overrides
- A maximum final report count

Probabilities must be finite values from 0 through 1. All delay, offset,
duplicate, report, event, and simulation-duration limits are checked before
generation consumes IDs or random streams.

### Source quality profiles

Civilian callers, responders, sensors, hotlines, community organizations, and
field observers have distinct private profiles. Profiles influence missing
detail, delay, staleness candidates, location accuracy, contradiction likelihood,
and confidence. No source is modeled as universally correct or incorrect.
Reliability scores and multipliers never enter public observations.

### Duplicates and contradictions

Duplicates are new reports with unique IDs, separate receipt timing and source,
distinct wording, and bounded optional location variation. Each duplicate
points privately to one base report and family ID. Duplicates are not duplicated
again, preventing circular chains and runaway multiplication.

Contradictions replace a structured primary claim with a category-appropriate
opposite value, such as blocked/passable road or unavailable/available power.
They privately reference a previous report for the same incident and category
only when the values genuinely disagree. Original reports remain unchanged;
normal time evolution is not automatically labeled a deliberate contradiction.

### Missing and uncertain information

Missing-detail noise has three distinguishable forms:

- An omitted secondary claim, tracked privately
- An explicit public `UNKNOWN` claim
- A retained claim with `LOW` confidence and uncertain wording

Narratives are rebuilt from the transformed public claims, so omitted details
cannot remain asserted in text.

### Delivery and staleness

Added delay may cause an older observation to arrive after a newer one. A report
becomes operationally and publicly visible only when its `REPORT_CREATE` event
executes at `receivedAtMs`; queued future reports are not exposed.

A stale candidate is finalized at receipt. `isStale` becomes true only if the
incident lifecycle actually changed after observation. Stale reports retain the
private truthfulness marker `OBSERVATION_AT_TIME`; stale does not mean false.

### Location uncertainty

Location noise applies a nonzero Euclidean-bounded offset within
`SIMULATED_LOCAL_GRID` and marks the reported location `APPROXIMATE`. The exact
baseline location and applied offset stay private.

### Hidden evaluation scope

`getPrivateReportEvaluations()` and `getPrivateReportEvaluation()` are privileged
simulation/scoring APIs. They contain internal incident association, duplicate
families, contradiction links, missing-detail classification, location offsets,
delay and staleness data, transformation reasons, lifecycle snapshots, and
source-quality parameters.

This private layer evaluates the actual state currently modeled by Chaos Engine:
incident status, bounded severity, timestamps, and fictional location. It is not
a full physical disaster ground-truth model.

## Disaster evolution and cascades

`scheduleEvolution()` adds bounded `EVOLUTION_APPLY` events to the same stable
queue used by incidents and reports. Configuration selects an existing incident,
disaster type, step count, step interval, normalized initial conditions, cascade
depth, secondary-event and per-rule limits, observation probability, and
optional Phase 4 report noise.

Hidden environmental state contains normalized rainfall, floodwater, wind, fire,
structural damage, road access, electrical and communication availability, and
shelter occupancy. The fictional equations model rise and recession or growth
and suppression; they are deterministic training behavior, not scientific or
engineering forecasts.

Implemented causal rules cover heavy rain and floodwater, flooded roads and
substations, power-dependent communications, communication-related delay, fire
damage, collapse hazards, storm power damage, shelter supply demand, and
prolonged-hazard severity escalation. Every application records its rule, event,
cause, time, depth, and affected entity. Depth, per-rule activations, secondary
incidents, total events, incidents, and duration are bounded and preflighted.

Fictional roads, substations, communication towers, shelters, and critical
buildings have deterministic IDs, local-grid locations, operational status,
condition/capacity, and causal history. Their hidden state is available only
through explicitly privileged inspection APIs.

Evolution events may schedule existing report-generation events. Reports retain
Phase 4 noise and receipt visibility, contain only observable categories and
claims, and never include environment values, rule IDs, cascade depth, or true
causal chains.

Example:

```ts
const incidentId = engine.getState().incidents[0]!.id;
engine.scheduleEvolution({
  incidentId,
  disasterType: "FLOOD",
  stepCount: 6,
  stepIntervalMs: 60_000,
  observationProbability: 1,
  reportNoise: { delayProbability: 0.2 },
});
engine.start();
engine.runUntilEmpty();

// Hidden history shows rain -> floodwater -> road closure.
const hidden = engine.getHiddenCascadeApplications();
// Public callers inspect only received, possibly noisy observations.
const publicObservations = engine.getPublicObservations();
```

## Example

```ts
import { SimulationEngine } from "./src/index.js";

const engine = new SimulationEngine({
  scenarioId: "fictional-training-scenario",
  seed: "demo-42",
  startTimeMs: 0,
  maxDurationMs: 600_000,
  initialIncidents: [
    {
      incidentType: "STRUCTURE_FIRE",
      location: { latitude: 10, longitude: 10 },
      severity: 4,
    },
  ],
});

const incidentId = engine.getState().incidents[0]!.id;

engine.scheduleReports({
  reportCount: 3,
  incidentIds: [incidentId],
  frequencyMs: 5_000,
  sourceWeights: {
    CIVILIAN_CALLER: 5,
    EMERGENCY_RESPONDER: 2,
  },
  noise: {
    duplicateProbability: 0.1,
    contradictionProbability: 0.08,
    missingDetailProbability: 0.2,
    delayProbability: 0.25,
    locationErrorProbability: 0.15,
    maxDuplicatesPerOriginal: 1,
    maxFinalReportCount: 6,
  },
});

engine.start();
engine.runUntilEmpty();

const observations = engine.getPublicObservations();
console.log(observations[0]?.narrative);
// No observation contains internalIncidentId.
```

## Simulated communications and operational knowledge

Phase 6D uses the existing virtual clock and stable event queue; it does not add
a second scheduler or contact a real network. Communication is opt-in with
`communication.enabled` and defaults to disabled for backward compatibility.
Each responder has an actual link state: `CONNECTED`, `DEGRADED`,
`INTERMITTENT`, `OFFLINE`, or `RECOVERING`. Explicit state-change events and
explicitly configured Phase 5 communication-tower or electrical links can move
units through the validated state graph. Unit-ID, callsign, global, and
fictional-radius infrastructure effects are supported.

The engine keeps four separate views:

1. Actual responder, task, travel, and communication state used by simulation
   physics and safety validation.
2. Hidden pending or permanently failed operational messages.
3. Delivered public operational observations produced by a strict allowlist.
4. Latest command-center knowledge, updated only by successfully received
   observations.

Operational messages carry a deterministic ID, responder and optional task ID,
message type, observed and submitted virtual times, optional received time,
source, structured observable content, status, and bounded attempt count.
Lifecycle events generate registration, assignment, departure, position,
reroute, arrival, task, unavailability, and link-restoration messages. Actual
state changes continue even when those messages are delayed or fail.

Connected links use the configured normal delay. Degraded links add delay;
intermittent links use a named deterministic RNG stream; offline and recovering
links retain messages for bounded retry. Explicit message types may be
configured to fail permanently. Receipt always satisfies
`observedAtMs <= submittedAtMs <= receivedAtMs`. A pending message is never a
public observation, retries cannot deliver the same message twice, and retry,
delay, pending-message, communication-event, total-event, and virtual-duration
limits prevent unbounded work.

Receipt history is ordered by queue delivery, not observation time. If an older
message arrives late it remains evidence in the public history, but it cannot
replace newer command-center knowledge. Equal observation times use the stable
message ID as their deterministic tie-breaker. Neither projection includes
incident severity, casualties, infrastructure truth, cascade rules, causal
event IDs, future events, failure reasons, or undelivered content. The existing
emergency-report projection is unchanged.

Automatic baseline assignment uses only delivered command-center availability.
It cannot use hidden actual telemetry merely to improve a choice. The existing
actual-state capability and active-assignment checks remain a hard safety
backstop, so stale information cannot assign an unavailable unit or create a
physically impossible duplicate assignment. Manual simulation assignment also
retains those actual-state safety checks.

### Reproducible outage and delayed-arrival example

```ts
const engine = new SimulationEngine({
  scenarioId: "fictional-radio-outage",
  seed: "outage-17",
  startTimeMs: 0,
  maxDurationMs: 120_000,
  initialIncidents: [{
    incidentType: "FICTIONAL_SUPPLY_REQUEST",
    location: { latitude: 0, longitude: 20 },
    severity: 3,
  }],
  initialResponders: [{
    id: "rsp_custom_supply",
    callsign: "SUPPLY-017",
    responderType: "SUPPLY_DELIVERY",
    location: {
      fictional: true,
      coordinateSystem: "SIMULATED_LOCAL_GRID",
      x: 0,
      y: 0,
      label: "Fictional base",
    },
    crewCapacity: 2,
    equipmentInventory: { kit: 2 },
  }],
  communication: {
    enabled: true,
    normalDelayMs: 100,
    retryIntervalMs: 1_000,
    maxRetriesPerMessage: 10,
  },
});

engine.start();
engine.runUntilEmpty(); // delivers registration
const incidentId = engine.getState().incidents[0]!.id;
engine.createTask({
  relatedIncidentId: incidentId,
  requiredCapabilities: ["LOGISTICS"],
  requiredEquipment: { kit: 1 },
  requiredCrewCapacity: 1,
  priority: "HIGH",
  estimatedEffortMs: 5_000,
});
engine.start();
engine.runUntilEmpty();
const taskId = engine.getTasks()[0]!.id;
const responderId = engine.getResponders()[0]!.id;
engine.assignTask(taskId, responderId);
engine.start();
engine.runUntilEmpty();
engine.departResponder(taskId);
engine.start();
engine.processNextEvent(); // actual departure
engine.pause();

const eta = engine.getTravels()[0]!.estimatedArrivalAtMs!;
engine.scheduleCommunicationStateChange(responderId, "OFFLINE");
engine.scheduleCommunicationStateChange(responderId, "RECOVERING", eta + 1);
engine.scheduleCommunicationStateChange(responderId, "CONNECTED", eta + 2);
engine.start();
engine.advanceUntil(eta);

// Actual simulation state has arrived; delivered knowledge is still stale.
console.log(engine.getResponder(responderId)?.availabilityState); // ON_SCENE
console.log(engine.getCommandCenterKnowledge(responderId)?.availabilityState); // older state

engine.runUntilEmpty();
console.log(engine.getCommandCenterKnowledge(responderId)?.availabilityState); // ON_SCENE
```

Reset reconstructs link states, message IDs, named-stream delivery decisions,
attempts, receipt order, projections, and known state exactly. Run
`npm run typecheck`, `npm test`, `npm run check`, and `npm run build` for full
validation.

## Fatigue, equipment, supplies, and recovery

Phase 6E is opt-in with `resources.enabled`; it is disabled by default to retain
the behavior of Phases 1–6D. Every calculation uses virtual timestamps. A
responder resource snapshot records bounded fatigue from 0 through the
configured maximum, its current `INACTIVE`, `TRAVEL`, `WORK`, or `RECOVERY`
mode, the last accounted timestamp, inventory, equipment conditions, and an
immutable causal history. Travel and work use separate configurable hourly
rates. Each update accounts only for time after the previous update, preventing
elapsed time from being counted twice. Explicit inactive-rest and recovery
rates reduce fatigue without consulting a wall clock.

The baseline assignment policy rejects responders at or above the fatigue
threshold. With communications enabled, candidate selection uses the most
recent delivered fatigue and inventory information; current actual fatigue,
equipment, availability, and active assignments remain the final safety check.
This means stale knowledge can leave a task pending but cannot create a second
physical assignment.

Resource definitions assign each inventory key a typed category: medical
supplies, rescue consumables, fire-suppression supplies, fuel or energy, repair
materials, food and water, emergency supplies, or reusable equipment. A
definition also declares whether an item is consumable and whether it is
essential. Unknown legacy inventory remains reusable when Phase 6E is disabled;
an enabled task must reference configured resource definitions.

Assignment reserves a task's consumable requirements without deducting them.
Reusable equipment is checked but never consumed. On the validated transition
to `IN_PROGRESS`—and only after Phase 6C arrival—the engine rechecks quantities
and equipment condition, deducts consumables exactly once, and records the
consumption. Cancellation or failure releases an unused reservation. Supplies
already consumed are never refunded, and task completion still does not resolve
the incident.

Equipment conditions are `OPERATIONAL`, `DEGRADED`, `UNAVAILABLE`, and
`UNDER_REPAIR`. Explicit failure events require a fictional cause; repair events
follow validated transitions. Unavailable or under-repair required equipment
disqualifies a responder. Post-recovery inspection also keeps the unit
`OFFLINE` when essential equipment is missing or unavailable.

Every assigned task terminal state schedules one bounded release and recovery
chain. The chain releases unused reservations, transitions the responder to
`RECOVERING`, reduces fatigue for the configured duration, checks essential
equipment, and returns the unit to `AVAILABLE` only when both fatigue and
equipment requirements pass. Otherwise it moves the unit to `OFFLINE`.
Superseded recovery events are safe no-ops. Phase 6C travel cancellation remains
versioned, so cancellation cannot produce a later phantom arrival.

Stockpiles have explicit `stockpile_` identities, fictional local-grid
locations, bounded inventories, and immutable transfer histories.
`requestReplenishment()` validates a bounded quantity and delay. A successful
completion atomically subtracts the source and adds the same amount to the
responder; concurrent requests reserve both source and destination capacity.
Insufficient stock or destination capacity creates an explicit failed request
without changing either inventory. No automatic or source-free refill exists.

Recovery, equipment, task-resource, and replenishment changes use the existing
stable queue. When Phase 6D is enabled, recovery and replenishment notifications
can be delayed independently of the physical events. Only delivered allowlisted
fatigue, equipment, inventory, and availability facts update command knowledge;
pending messages, future resource events, incident severity, infrastructure
truth, cascade rules, and private evaluation metadata remain excluded.

### Reproducible travel, work, consumption, and recovery example

```ts
const engine = new SimulationEngine({
  scenarioId: "fictional-resource-cycle",
  seed: "resource-42",
  startTimeMs: 0,
  maxDurationMs: 10_000_000,
  initialIncidents: [{
    incidentType: "FICTIONAL_SUPPLY_OPERATION",
    location: { latitude: 0, longitude: 20 },
    severity: 3,
  }],
  initialResponders: [{
    id: "rsp_custom_supply",
    callsign: "SUPPLY-042",
    responderType: "SUPPLY_DELIVERY",
    location: {
      fictional: true,
      coordinateSystem: "SIMULATED_LOCAL_GRID",
      x: 0,
      y: 0,
      label: "Fictional supply base",
    },
    crewCapacity: 2,
    equipmentInventory: { supplyPack: 4, radio: 1 },
  }],
  resources: {
    enabled: true,
    travelFatiguePerHour: 10,
    workFatiguePerHour: 20,
    recoveryReductionPerHour: 40,
    recoveryDurationMs: 3_600_000,
    resourceDefinitions: {
      supplyPack: { category: "EMERGENCY_SUPPLY", consumable: true },
      radio: {
        category: "REUSABLE_EQUIPMENT",
        consumable: false,
        essential: true,
      },
    },
    initialStockpiles: [{
      id: "stockpile_training",
      location: {
        fictional: true,
        coordinateSystem: "SIMULATED_LOCAL_GRID",
        x: 0,
        y: 0,
        label: "Fictional training stockpile",
      },
      inventory: { supplyPack: 20 },
    }],
  },
});

const incidentId = engine.getState().incidents[0]!.id;
engine.createTask({
  relatedIncidentId: incidentId,
  requiredCapabilities: ["LOGISTICS"],
  requiredEquipment: { supplyPack: 2, radio: 1 },
  requiredCrewCapacity: 1,
  priority: "HIGH",
  estimatedEffortMs: 600_000,
});
engine.start();
engine.runUntilEmpty();

const taskId = engine.getTasks()[0]!.id;
const responderId = engine.getResponders()[0]!.id;
engine.assignTask(taskId, responderId);
engine.start();
engine.runUntilEmpty();
engine.departResponder(taskId);
engine.start();
engine.runUntilEmpty(); // responder is now ON_SCENE

engine.scheduleTaskStateTransition(taskId, "IN_PROGRESS", engine.getState().currentTimeMs);
engine.start();
engine.runUntilEmpty(); // consumes two supply packs, preserves the radio

engine.scheduleTaskStateTransition(
  taskId,
  "COMPLETED",
  engine.getState().currentTimeMs + 600_000,
);
engine.start();
engine.runUntilEmpty(); // release -> recovery -> AVAILABLE or OFFLINE

console.log(engine.getResponderResourceState(responderId));
```

Fatigue, reservations, consumption, equipment histories, replenishment IDs,
transfer order, recovery timing, availability changes, and operational
notifications are reproduced exactly by reset and replay. Safety limits cover
rates, fatigue, recovery duration, equipment and inventory quantities,
stockpiles, transfer amount and delay, resource events, total events, and
virtual duration.

## Full responder integration and stress workloads

`createResponderIntegrationPreset()` produces four reusable deterministic
configurations. Every configuration contains the same four fictional combined
scenarios—urban flood, earthquake aftermath, severe storm, and urban fire—but
changes operational load, unavailable units, report noise, communication
conditions, task volume, shortages, fatigue, and work duration.

| Difficulty | Responders | Base reports | Operational tasks | Deliberate shortage tasks |
| --- | ---: | ---: | ---: | ---: |
| CALM | 10 | 100 | 8 | 1 |
| BUSY | 50 | 1,000 | 25 | 3 |
| CHAOS | 100 | 5,000 | 50 | 8 |
| EXTREME | 200 | 10,000 | 100 | 20 |

The integrated lifecycle is:

```text
incident/report/evolution
  -> task -> qualified SIMULATION_BASELINE assignment -> RESERVED
  -> departure -> EN_ROUTE -> reroute if required -> ON_SCENE
  -> IN_PROGRESS -> consume reserved supplies -> COMPLETED/FAILED
  -> release -> RECOVERING -> fatigue/equipment check -> AVAILABLE or OFFLINE
```

All physical changes use the existing virtual clock and stable event queue.
Work cannot start before a versioned travel attempt arrives. Terminal task
events cancel open travel, release the responder, and start bounded recovery;
they do not resolve the related incident. Actual movement proceeds during a
communication outage, while dispatch, route, arrival, task, and recovery
notifications remain pending, delayed, or failed. Delivered observations alone
update command-center knowledge, and observation timestamps prevent stale
messages from replacing newer knowledge. Actual responder state is still the
hard safety check against overlapping assignments.

The scenario runner exercises a flood road closure and alternate route,
collapse/search tasks and competing medical demand, storm power and
communication disruption, fire consumable use, unavailable equipment,
stockpile replenishment, resource shortages, work fatigue, and recovery. These
are deterministic training abstractions, not scientific forecasts or real
dispatch recommendations.

### End-to-end example

```ts
import {
  createResponderIntegrationPreset,
  runResponderIntegrationWorkload,
} from "chaos-engine";

const preset = createResponderIntegrationPreset("CALM");
const result = runResponderIntegrationWorkload(preset.difficulty);

console.log(result.metrics);
console.log(result.invariantViolations);   // []
console.log(result.publicAuditViolations); // []
```

`canonicalizeResponderIntegrationState()` compares responder and task state,
assignments, travel, inventories, delivered communication knowledge, incident
evolution, public emergency observations, and compact causal event history.
Wall-clock duration is deliberately excluded. Resetting an engine and applying
`executeResponderIntegrationWorkload()` again produces the same canonical
state, IDs, ordering, and observations.

`auditPublicSimulationOutputs()` recursively checks the two allowlisted public
projections. Internal incident IDs, actual severity, environment and
infrastructure ground truth, cascade causes, future events, duplicate-family
relationships, contradiction classifications, reliability parameters,
undelivered messages, delivery failures, and private evaluations stay in
privileged diagnostics.

### Phase 6F benchmark results

Run `npm run benchmark:phase6f` to execute all four workloads. The following
measurements are from the verification run on 2026-11-08; execution duration is
real machine-specific wall time, while response delay and virtual duration are
simulation time. They are measurements, not performance guarantees.

| Workload | Real duration (ms) | Final reports | Incidents | Tasks (assigned/completed/failed/pending) | Avg simulated response delay (ms) | Delayed / failed messages | Shortages | Cascades | Peak queue | Processed events |
| --- | ---: | ---: | ---: | --- | ---: | --- | ---: | ---: | ---: | ---: |
| CALM | 161.42 | 102 | 7 | 9 (8/8/0/1) | 181,746 | 5 / 12 | 2 | 21 | 109 | 532 |
| BUSY | 3,269.37 | 1,065 | 10 | 28 (25/23/2/3) | 188,739 | 327 / 12 | 4 | 67 | 1,075 | 2,282 |
| CHAOS | 29,499.89 | 5,437 | 10 | 58 (50/46/4/8) | 193,302 | 653 / 12 | 9 | 66 | 5,474 | 7,762 |
| EXTREME | 120,376.37 | 11,243 | 10 | 120 (100/91/9/20) | 202,823 | 1,307 / 12 | 21 | 66 | 11,346 | 15,792 |

Final report counts include deterministic noisy duplicates and evolution
observations in addition to the exact requested base counts. A shortage is a
task left pending for lack of qualified inventory or a bounded replenishment
that failed conservation checks. Peak queue depth is tracked by the engine and
reset with every run.

Known limitations: routing uses a small fictional graph and nearest-node
projection; work completion remains explicitly scenario-scheduled; fatigue and
radio behavior are bounded training models; no live data, human approval,
optimization solver, or scientific forecast is involved. A future production
JSON format must export separately versioned, allowlisted DTOs and must never
serialize `SimulationSnapshot`, internal reports, private evaluations,
undelivered messages, environment history, or cascade internals directly.

## Secure public JSON export

Phase 7A exports fictional command-center-visible data with
`schemaVersion: "resq.simulation.v1"`. The TypeScript contract and JSON Schema
live in `src/export/`. The root document contains engine/run metadata, fictional
scenario metadata, virtual start/export timestamps, received emergency
observations, delivered operational observations, observable units, public
assignment references, and aggregate counts.

The exporter is an allowlist, not a sanitized internal snapshot. It never
serializes incident, responder, task, infrastructure, cascade, environment,
private report-evaluation, pending-message, or event-queue objects. Public unit
and assignment identifiers are generated independently from internal IDs.
Responder summaries are reconstructed from delivered observations with stale
update protection; actual physical state is not consulted for availability,
travel, task, communication, fatigue, equipment, or inventory knowledge.
Version 1 deliberately exports no confirmed incident-correlation objects,
because public reports alone do not establish their hidden incident grouping.

Emergency observations are sorted by receipt timestamp and report ID. Natural
duplicates and contradictions remain separate. Operational observations are
sorted by receipt timestamp and their generated public observation ID. Every
optional contract field is represented explicitly with `null`; `undefined`,
non-finite numbers, locale formatting, and wall-clock generation timestamps are
forbidden. Canonical serialization recursively sorts object keys and ends with
one newline.

```ts
import {
  createPublicSimulationExport,
  serializePublicSimulationExport,
  validatePublicSimulationExport,
  writePublicSimulationExport,
} from "chaos-engine";

const document = createPublicSimulationExport(engine, {
  difficulty: "CALM",
  scenarioLabel: "Fictional river exercise",
});
const validation = validatePublicSimulationExport(document);
if (!validation.valid) throw new Error("Invalid public export");

const json = serializePublicSimulationExport(document);
await writePublicSimulationExport(document, {
  destinationDirectory: "C:/explicit/export/directory",
  filename: "river-exercise.json",
  overwrite: false,
});
```

A minimal valid document has this shape (real exports contain fully structured
observations):

```json
{
  "assignments": [],
  "emergencyObservations": [],
  "engineVersion": "0.1.0",
  "operationalObservations": [],
  "replayManifest": null,
  "runId": "run_example",
  "scenario": {
    "difficulty": null,
    "fictional": true,
    "label": "Fictional empty exercise",
    "scenarioId": "example",
    "seed": "example-seed"
  },
  "schemaVersion": "resq.simulation.v1",
  "simulationTime": {
    "exportTime": "1970-01-01T00:00:00.000Z",
    "startTime": "1970-01-01T00:00:00.000Z",
    "status": "COMPLETED"
  },
  "summary": {
    "assignmentCount": 0,
    "emergencyObservationCount": 0,
    "firstReceivedAt": null,
    "lastReceivedAt": null,
    "operationalObservationCount": 0,
    "unitCount": 0
  },
  "units": []
}
```

Exports are supported at the engine's current virtual timestamp, whether the
simulation is complete or partially advanced. An earlier timestamp is rejected
after the engine has advanced because Phase 7A does not maintain a historical
command-knowledge index; the caller must pause the engine at the desired time.
Future timestamps are also rejected. Export never advances, resets, or mutates
the engine.

Validation checks version, required and unexpected fields, canonical
timestamps, identifier uniqueness, public references, observation ordering,
fictional coordinates, enumerations, numerical bounds, export-time boundaries,
summary consistency, and recursively forbidden private keys. Serialization and
file writing validate first. File writing requires an existing explicit
destination directory, accepts only a local `.json` filename, rejects traversal,
uses UTF-8 and a same-directory temporary file, refuses overwrite by default,
and cleans up temporary files after failure. Explicit overwrite is required to
replace a file.

`npm.cmd run benchmark:phase7a` produced these measurements on 2026-11-08. They are
machine-specific observations, not production guarantees:

| Reports | Export | Validation | Serialization | UTF-8 bytes |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 15.12 ms | 5.44 ms | 9.22 ms | 141,381 |
| 1,000 | 47.27 ms | 20.90 ms | 40.33 ms | 1,412,601 |
| 5,000 | 215.12 ms | 110.07 ms | 209.54 ms | 7,056,551 |
| 10,000 | 364.35 ms | 274.88 ms | 410.07 ms | 13,880,963 |

A future RES-Q adapter must consume and independently validate only this public
contract. It must not import Chaos Engine private modules or receive a truth-dump
mode. The standalone engine provides no network transport, database connection,
production adapter, or external integration.

## Performance architecture and final hardening

CPU profiling of the unchanged EXTREME CLI configuration took 108,469.80 ms
under the profiler. The dominant sampled self-time was `xmur3`: each new named
RNG stream re-hashed the complete canonical configuration, including 200
responders. Event-queue processing itself was a small fraction of sampled CPU
time, so the stable binary heap was not replaced.

`SeededRng` now caches the xmur3 state after the common `seed + NUL` prefix for
each final stream-name length. It then hashes only the short unique name suffix.
This is algebraically the same hash operation split at the prefix boundary; it
does not shorten, replace, or reseed the random algorithm. Golden legacy stream
tests preserve exact 32-bit outputs, existing named-stream independence tests
remain intact, Phase 6F output counts and operational outcomes are unchanged,
and CLI replay remains byte-identical. The cache is bounded by the number of
distinct stream-name lengths and cannot return stale simulation state.

The comparable Phase 6F benchmark, using the same script, configurations,
seeds, machine, and runtime, measured:

| Workload | Before Phase 7C | After Phase 7C | Approximate speedup |
| --- | ---: | ---: | ---: |
| CALM | 161.42 ms | 80.67 ms | 2.0× |
| BUSY | 3,269.37 ms | 546.79 ms | 6.0× |
| CHAOS | 29,499.89 ms | 3,455.54 ms | 8.5× |
| EXTREME | 120,376.37 ms | 10,745.67 ms | 11.2× |

The post-optimization EXTREME Phase 6F result still contains 10,000 base and
11,243 final reports, 200 responders, 120 tasks, 15,792 processed events, and
an 11,346-event peak queue. No workload size or safety limit was reduced.

`npm.cmd run benchmark:phase7c` measures the independently selectable CLI workload
and public export path. Phase 8 measurements from 2026-11-08 follow:

| Workload | Simulation | Reports | Tasks | Events / peak queue | RSS before/after | Heap before/after | Export / validate / serialize |
| --- | ---: | ---: | ---: | --- | --- | --- | --- |
| CALM | 60.20 ms | 101 | 8 | 439 / 112 | 85.4 / 98.3 MB | 12.1 / 17.2 MB | 9.23 / 4.43 / 7.15 ms |
| BUSY | 366.95 ms | 1,043 | 28 | 2,118 / 1,076 | 98.5 / 168.7 MB | 17.4 / 65.6 MB | 40.33 / 28.58 / 43.62 ms |
| CHAOS | 2,755.29 ms | 5,376 | 58 | 7,509 / 5,442 | 170.3 / 272.3 MB | 67.2 / 138.1 MB | 309.51 / 153.66 / 267.46 ms |
| EXTREME | 12,672.13 ms | 11,264 | 120 | 15,511 / 11,394 | 279.9 / 465.8 MB | 145.7 / 317.5 MB | 633.97 / 352.59 / 596.74 ms |

Memory rows are sequential observations in one benchmark process, not isolated
per-workload peaks; earlier workload allocations can affect later RSS baselines.
The process high-water RSS after all four workloads was 470,392 KiB. JSON size,
public report objects, private evaluation history, and event history remain the
main unavoidable EXTREME memory costs. Removing them would break evaluation,
replay, or public-export requirements. Durations and memory are machine-specific
measurements rather than guarantees.

Safety behavior is unchanged: bounded queue/event/message/resource counts,
stable causal ordering, versioned stale travel suppression, retry and cascade
limits, terminal invalid-event failures, no partial scheduling mutation,
allowlisted public projections, safe file replacement, and current-time export
rules continue to use their existing tested implementations.

## Determinism and safety

The same validated simulation configuration, seed, incident state, and report
scheduling calls reproduce identical IDs, locations, timestamps, claims,
narratives, private annotations, event ordering, and public observations.
Different seeds produce meaningful deterministic variation.

The engine enforces maximum event, incident, responder, task, travel-attempt,
road-node, and road-segment counts; unique entity IDs; crew, capability,
equipment-item, per-item inventory, task effort, coordinates, route duration,
reroute, travel retry, communication retry, communication delay, pending-message,
communication-event, fatigue-rate, recovery-duration, stockpile, replenishment,
resource-event, progress-event, and total inventory bounds; valid references and
transitions; one active task and travel attempt per responder; final report
count; simulated duration; duplicate bounds; and 10,000 base reports per
generation call. Queue operations are logarithmic, and relationship indexes
avoid scanning all prior reports for each generated report.

## Phase 8 verification

The final standalone audit passed 220 automated tests across 49 suites with zero
failures, strict TypeScript typechecking, the combined check, and the production
build. Actual CLI smoke testing covered all seven commands, safe refusal to
overwrite, malformed and missing input, version rejection, valid export,
validation, and byte-identical replay. Recursive public-output tests cover
delayed and contradictory reports, communication outages, hidden evolution,
road closures, delayed task messages, and delivered-only command knowledge.

Phase 8 tightened a genuine contract gap: the shipped JSON Schema now specifies
the nested enums, required fields, bounded values, and unknown-property behavior
already enforced by the TypeScript public contract. The runtime validator also
rejects incompatible root engine versions and manifests that cannot satisfy CLI
replay bounds. Valid generated output and deterministic simulation behavior are
unchanged.

See `RELEASE_READINESS.md` for the evidence and remaining risks, and
`INTEGRATION_HANDOFF.md` for the documentation-only recommended future import
boundary.

## Deliberately deferred

The standalone engine does not implement real emergency dispatch, real roads,
live traffic, turn-by-turn navigation, real communications, human physiology,
equipment wear physics, repair labor, stockpile routing, scientific forecasting,
full disaster physics, malicious misinformation actors, application
adapters, databases, external AI services, or dashboard features. Locations are
snapped to the nearest fictional graph node with simple straight-line connector
legs; congestion and road-condition multipliers are training abstractions rather
than transportation models. Communication range, delay, loss, and tower effects
are fictional scenario abstractions rather than radio-propagation or carrier
models. Task notifications do not cancel tasks when delivery fails.

