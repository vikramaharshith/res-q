import type { InfrastructureStatus } from "../evolution/evolution.js";
import { SimulationConfigError, SimulationEventError } from "./errors.js";
import type { SimulatedLocation } from "./config.js";

export const ROAD_ACCESS_STATES = [
  "ACCESSIBLE",
  "DEGRADED",
  "BLOCKED",
  "UNKNOWN",
] as const;

export const TRAVEL_STATUSES = [
  "EN_ROUTE",
  "ARRIVED",
  "BLOCKED",
  "INTERRUPTED",
  "CANCELLED",
] as const;

export type RoadAccessState = (typeof ROAD_ACCESS_STATES)[number];
export type TravelStatus = (typeof TRAVEL_STATUSES)[number];

export const MAX_ROAD_NODE_COUNT = 1_000;
export const MAX_ROAD_SEGMENT_COUNT = 5_000;
export const MAX_TRAVEL_PROGRESS_EVENTS = 32;
export const MAX_TRAVEL_REROUTES = 8;
export const MAX_TRAVEL_RETRIES = 3;
export const MAX_TRAVEL_DURATION_MS = 7 * 24 * 60 * 60 * 1_000;
export const DEFAULT_TRAVEL_PROGRESS_INTERVAL_MS = 60_000;
export const MAX_FICTIONAL_COORDINATE = 1_000_000;

const MAX_SEGMENT_DISTANCE_UNITS = 1_000_000;
const MAX_SPEED_UNITS_PER_SECOND = 10_000;
const MAX_CONGESTION_PERMILLE = 5_000;

export interface FictionalTravelLocation {
  readonly fictional: true;
  readonly coordinateSystem: "SIMULATED_LOCAL_GRID";
  readonly x: number;
  readonly y: number;
  readonly label?: string;
}

export interface RoadNodeDefinition {
  readonly id: string;
  readonly location: FictionalTravelLocation;
}

export interface RoadSegmentDefinition {
  readonly id: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly distanceUnits: number;
  readonly speedUnitsPerSecond: number;
  readonly congestionPermille?: number;
  readonly bidirectional?: boolean;
  readonly initialState?: RoadAccessState;
  readonly infrastructureType?: "ROAD";
}

export interface RoadNetworkConfig {
  readonly nodes: readonly RoadNodeDefinition[];
  readonly segments: readonly RoadSegmentDefinition[];
}

export interface RoadStateHistoryEntry {
  readonly eventId: string;
  readonly causeEventId?: string;
  readonly atMs: number;
  readonly previousState: RoadAccessState;
  readonly state: RoadAccessState;
}

export interface RoadNode {
  readonly id: string;
  readonly location: FictionalTravelLocation;
}

export interface RoadSegment {
  readonly id: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly distanceUnits: number;
  readonly speedUnitsPerSecond: number;
  readonly congestionPermille: number;
  readonly bidirectional: boolean;
  readonly state: RoadAccessState;
  readonly infrastructureType?: "ROAD";
  readonly history: readonly RoadStateHistoryEntry[];
}

export interface RoadNetworkSnapshot {
  readonly nodes: readonly RoadNode[];
  readonly segments: readonly RoadSegment[];
}

export interface TravelRouteLeg {
  readonly from: FictionalTravelLocation;
  readonly to: FictionalTravelLocation;
  readonly distanceUnits: number;
  readonly durationMs: number;
  readonly segmentId?: string;
}

export interface TravelRoute {
  readonly nodeIds: readonly string[];
  readonly segmentIds: readonly string[];
  readonly legs: readonly TravelRouteLeg[];
  readonly distanceUnits: number;
  readonly durationMs: number;
}

export type TravelHistoryAction =
  | "DEPARTED"
  | "PROGRESSED"
  | "REROUTED"
  | "BLOCKED"
  | "ARRIVED"
  | "INTERRUPTED"
  | "CANCELLED"
  | "RETRY_STARTED";

export interface TravelHistoryEntry {
  readonly eventId: string;
  readonly causeEventId?: string;
  readonly atMs: number;
  readonly action: TravelHistoryAction;
  readonly routeVersion: number;
  readonly location: FictionalTravelLocation;
  readonly state: TravelStatus;
}

export interface TravelSnapshot {
  readonly id: string;
  readonly taskId: string;
  readonly responderId: string;
  readonly status: TravelStatus;
  readonly routeVersion: number;
  readonly startLocation: FictionalTravelLocation;
  readonly destination: FictionalTravelLocation;
  readonly currentLocation: FictionalTravelLocation;
  readonly route?: TravelRoute;
  readonly routeStartedAtMs: number;
  readonly departedAtMs?: number;
  readonly estimatedArrivalAtMs?: number;
  readonly arrivedAtMs?: number;
  readonly lastUpdatedAtMs: number;
  readonly progressPermille: number;
  readonly distanceTravelledUnits: number;
  readonly remainingDistanceUnits: number;
  readonly responderSpeedUnitsPerSecond: number;
  readonly progressIntervalMs: number;
  readonly rerouteCount: number;
  readonly retryCount: number;
  readonly eventHistory: readonly TravelHistoryEntry[];
}

export interface TravelChange {
  readonly kind:
    | "TRAVEL_DEPARTED"
    | "TRAVEL_PROGRESSED"
    | "TRAVEL_REROUTED"
    | "TRAVEL_BLOCKED"
    | "TRAVEL_ARRIVED"
    | "TRAVEL_INTERRUPTED"
    | "TRAVEL_CANCELLED"
    | "TRAVEL_EVENT_IGNORED";
  readonly travelId: string;
  readonly taskId: string;
  readonly responderId: string;
  readonly routeVersion: number;
  readonly status: TravelStatus;
  readonly reason?: string;
}

export interface RoadStateChangedChange {
  readonly kind: "ROAD_STATE_CHANGED";
  readonly segmentId: string;
  readonly previousState: RoadAccessState;
  readonly state: RoadAccessState;
}

export function defaultRoadNetworkConfig(): RoadNetworkConfig {
  const node = (id: string, x: number, y: number): RoadNodeDefinition =>
    Object.freeze({
      id,
      location: freezeLocation({
        fictional: true,
        coordinateSystem: "SIMULATED_LOCAL_GRID",
        x,
        y,
        label: `Fictional road node ${id}`,
      }),
    });
  const segment = (
    id: string,
    fromNodeId: string,
    toNodeId: string,
    infrastructureType?: "ROAD",
  ): RoadSegmentDefinition =>
    Object.freeze({
      id,
      fromNodeId,
      toNodeId,
      distanceUnits: 10,
      speedUnitsPerSecond: 10,
      congestionPermille: 1_000,
      bidirectional: true,
      initialState: "ACCESSIBLE",
      ...(infrastructureType === undefined ? {} : { infrastructureType }),
    });
  return Object.freeze({
    nodes: Object.freeze([
      node("node_sw", 0, 0),
      node("node_s", 10, 0),
      node("node_se", 20, 0),
      node("node_w", 0, 10),
      node("node_c", 10, 10),
      node("node_e", 20, 10),
      node("node_nw", 0, 20),
      node("node_n", 10, 20),
      node("node_ne", 20, 20),
    ]),
    segments: Object.freeze([
      segment("road_south_w", "node_sw", "node_s"),
      segment("road_south_e", "node_s", "node_se"),
      segment("road_middle_w", "node_w", "node_c", "ROAD"),
      segment("road_middle_e", "node_c", "node_e"),
      segment("road_north_w", "node_nw", "node_n"),
      segment("road_north_e", "node_n", "node_ne"),
      segment("road_west_s", "node_sw", "node_w"),
      segment("road_west_n", "node_w", "node_nw"),
      segment("road_center_s", "node_s", "node_c", "ROAD"),
      segment("road_center_n", "node_c", "node_n"),
      segment("road_east_s", "node_se", "node_e"),
      segment("road_east_n", "node_e", "node_ne"),
    ]),
  });
}

export function validateRoadNetworkConfig(input: unknown): RoadNetworkConfig {
  if (!isRecord(input)) {
    throw new SimulationConfigError("roadNetwork must be an object.");
  }
  if (!Array.isArray(input.nodes) || input.nodes.length < 1) {
    throw new SimulationConfigError("roadNetwork.nodes must be a non-empty array.");
  }
  if (input.nodes.length > MAX_ROAD_NODE_COUNT) {
    throw new SimulationConfigError(`roadNetwork.nodes must not exceed ${MAX_ROAD_NODE_COUNT}.`);
  }
  if (!Array.isArray(input.segments)) {
    throw new SimulationConfigError("roadNetwork.segments must be an array.");
  }
  if (input.segments.length > MAX_ROAD_SEGMENT_COUNT) {
    throw new SimulationConfigError(
      `roadNetwork.segments must not exceed ${MAX_ROAD_SEGMENT_COUNT}.`,
    );
  }

  const nodeIds = new Set<string>();
  const nodes = input.nodes.map((raw, index) => {
    if (!isRecord(raw)) throw new SimulationConfigError(`roadNetwork.nodes[${index}] must be an object.`);
    const id = validateId(raw.id, `roadNetwork.nodes[${index}].id`, "node");
    if (nodeIds.has(id)) throw new SimulationConfigError(`Duplicate road node ID: ${id}.`);
    nodeIds.add(id);
    return Object.freeze({ id, location: validateTravelLocation(raw.location, `roadNetwork.nodes[${index}].location`) });
  });

  const segmentIds = new Set<string>();
  const segments = input.segments.map((raw, index) => {
    if (!isRecord(raw)) throw new SimulationConfigError(`roadNetwork.segments[${index}] must be an object.`);
    const label = `roadNetwork.segments[${index}]`;
    const id = validateId(raw.id, `${label}.id`, "road");
    if (segmentIds.has(id)) throw new SimulationConfigError(`Duplicate road segment ID: ${id}.`);
    segmentIds.add(id);
    const fromNodeId = requireString(raw.fromNodeId, `${label}.fromNodeId`);
    const toNodeId = requireString(raw.toNodeId, `${label}.toNodeId`);
    if (!nodeIds.has(fromNodeId) || !nodeIds.has(toNodeId) || fromNodeId === toNodeId) {
      throw new SimulationConfigError(`${label} must connect two distinct existing nodes.`);
    }
    const distanceUnits = boundedInteger(raw.distanceUnits, `${label}.distanceUnits`, 1, MAX_SEGMENT_DISTANCE_UNITS);
    const speedUnitsPerSecond = boundedInteger(raw.speedUnitsPerSecond, `${label}.speedUnitsPerSecond`, 1, MAX_SPEED_UNITS_PER_SECOND);
    const congestionPermille = raw.congestionPermille === undefined ? 1_000 : boundedInteger(raw.congestionPermille, `${label}.congestionPermille`, 1_000, MAX_CONGESTION_PERMILLE);
    const bidirectional = raw.bidirectional ?? true;
    if (typeof bidirectional !== "boolean") throw new SimulationConfigError(`${label}.bidirectional must be a boolean.`);
    const initialState = raw.initialState ?? "ACCESSIBLE";
    if (!isRoadAccessState(initialState)) throw new SimulationConfigError(`${label}.initialState is unsupported.`);
    const infrastructureType = raw.infrastructureType;
    if (infrastructureType !== undefined && infrastructureType !== "ROAD") throw new SimulationConfigError(`${label}.infrastructureType may only be ROAD.`);
    return Object.freeze({ id, fromNodeId, toNodeId, distanceUnits, speedUnitsPerSecond, congestionPermille, bidirectional, initialState, ...(infrastructureType === undefined ? {} : { infrastructureType }) });
  });
  return Object.freeze({ nodes: Object.freeze(nodes), segments: Object.freeze(segments) });
}

export function createRoadNetwork(config: RoadNetworkConfig): RoadNetworkSnapshot {
  return freezeRoadNetwork({
    nodes: config.nodes.map((item) => Object.freeze({ id: item.id, location: freezeLocation(item.location) })),
    segments: config.segments.map((item) => Object.freeze({
      id: item.id,
      fromNodeId: item.fromNodeId,
      toNodeId: item.toNodeId,
      distanceUnits: item.distanceUnits,
      speedUnitsPerSecond: item.speedUnitsPerSecond,
      congestionPermille: item.congestionPermille ?? 1_000,
      bidirectional: item.bidirectional ?? true,
      state: item.initialState ?? "ACCESSIBLE",
      ...(item.infrastructureType === undefined ? {} : { infrastructureType: item.infrastructureType }),
      history: Object.freeze([]),
    })),
  });
}

export function updateRoadSegmentState(
  network: RoadNetworkSnapshot,
  segmentId: string,
  state: RoadAccessState,
  eventId: string,
  atMs: number,
  causeEventId?: string,
): { network: RoadNetworkSnapshot; change: RoadStateChangedChange } {
  const current = network.segments.find((segment) => segment.id === segmentId);
  if (current === undefined) throw new SimulationEventError(`Road segment ${segmentId} does not exist.`);
  const entry = Object.freeze({ eventId, ...(causeEventId === undefined ? {} : { causeEventId }), atMs, previousState: current.state, state });
  const segments = network.segments.map((segment) =>
    segment.id === segmentId
      ? Object.freeze({ ...segment, state, history: Object.freeze([...segment.history, entry]) })
      : segment,
  );
  return {
    network: freezeRoadNetwork({ nodes: network.nodes, segments }),
    change: Object.freeze({ kind: "ROAD_STATE_CHANGED", segmentId, previousState: current.state, state }),
  };
}

export function infrastructureStatusToRoadState(status: InfrastructureStatus): RoadAccessState {
  switch (status) {
    case "OPERATIONAL": return "ACCESSIBLE";
    case "DEGRADED":
    case "RECOVERING": return "DEGRADED";
    case "OFFLINE": return "BLOCKED";
  }
}

export function projectIncidentLocation(location: Readonly<SimulatedLocation>): FictionalTravelLocation {
  return freezeLocation({
    fictional: true,
    coordinateSystem: "SIMULATED_LOCAL_GRID",
    x: roundCoordinate(location.longitude),
    y: roundCoordinate(location.latitude),
    label: location.label === undefined ? "Fictional incident destination" : `Fictional destination: ${location.label}`,
  });
}

export function findShortestRoute(
  network: RoadNetworkSnapshot,
  start: FictionalTravelLocation,
  destination: FictionalTravelLocation,
  responderSpeedUnitsPerSecond: number,
): TravelRoute | undefined {
  validateTravelLocation(start, "start");
  validateTravelLocation(destination, "destination");
  boundedInteger(responderSpeedUnitsPerSecond, "responderSpeedUnitsPerSecond", 1, MAX_SPEED_UNITS_PER_SECOND);
  const startNode = nearestNode(network.nodes, start);
  const destinationNode = nearestNode(network.nodes, destination);
  if (startNode === undefined || destinationNode === undefined) return undefined;

  const adjacency = new Map<string, Array<{ nodeId: string; segment: RoadSegment }>>();
  for (const node of network.nodes) adjacency.set(node.id, []);
  for (const segment of network.segments) {
    if (segment.state === "BLOCKED") continue;
    adjacency.get(segment.fromNodeId)?.push({ nodeId: segment.toNodeId, segment });
    if (segment.bidirectional) adjacency.get(segment.toNodeId)?.push({ nodeId: segment.fromNodeId, segment });
  }
  for (const edges of adjacency.values()) edges.sort((a, b) => compareText(a.segment.id, b.segment.id) || compareText(a.nodeId, b.nodeId));

  const best = new Map<string, { cost: number; pathKey: string; previousNode?: string; previousSegment?: RoadSegment }>();
  best.set(startNode.id, { cost: 0, pathKey: "" });
  const unsettled = new Set(network.nodes.map((node) => node.id));
  while (unsettled.size > 0) {
    let currentId: string | undefined;
    for (const candidate of unsettled) {
      const candidateBest = best.get(candidate);
      if (candidateBest === undefined) continue;
      if (currentId === undefined) currentId = candidate;
      else {
        const currentBest = best.get(currentId)!;
        if (candidateBest.cost < currentBest.cost || (candidateBest.cost === currentBest.cost && (compareText(candidateBest.pathKey, currentBest.pathKey) < 0 || (candidateBest.pathKey === currentBest.pathKey && compareText(candidate, currentId) < 0)))) currentId = candidate;
      }
    }
    if (currentId === undefined) break;
    unsettled.delete(currentId);
    if (currentId === destinationNode.id) break;
    const currentBest = best.get(currentId)!;
    for (const edge of adjacency.get(currentId) ?? []) {
      if (!unsettled.has(edge.nodeId)) continue;
      const cost = currentBest.cost + segmentDurationMs(edge.segment, responderSpeedUnitsPerSecond);
      const pathKey = `${currentBest.pathKey}/${edge.segment.id}`;
      const existing = best.get(edge.nodeId);
      if (existing === undefined || cost < existing.cost || (cost === existing.cost && compareText(pathKey, existing.pathKey) < 0)) {
        best.set(edge.nodeId, { cost, pathKey, previousNode: currentId, previousSegment: edge.segment });
      }
    }
  }
  if (!best.has(destinationNode.id)) return undefined;

  const reversedSegments: RoadSegment[] = [];
  const reversedNodes: string[] = [destinationNode.id];
  let cursor = destinationNode.id;
  while (cursor !== startNode.id) {
    const item = best.get(cursor);
    if (item?.previousNode === undefined || item.previousSegment === undefined) return undefined;
    reversedSegments.push(item.previousSegment);
    cursor = item.previousNode;
    reversedNodes.push(cursor);
  }
  const segments = reversedSegments.reverse();
  const nodeIds = reversedNodes.reverse();
  const nodeById = new Map(network.nodes.map((node) => [node.id, node]));
  const legs: TravelRouteLeg[] = [];
  addConnectorLeg(legs, start, startNode.location, responderSpeedUnitsPerSecond);
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    const from = nodeById.get(nodeIds[index]!)!.location;
    const to = nodeById.get(nodeIds[index + 1]!)!.location;
    legs.push(Object.freeze({ from, to, distanceUnits: segment.distanceUnits, durationMs: segmentDurationMs(segment, responderSpeedUnitsPerSecond), segmentId: segment.id }));
  }
  addConnectorLeg(legs, destinationNode.location, destination, responderSpeedUnitsPerSecond);
  const distanceUnits = legs.reduce((sum, leg) => sum + leg.distanceUnits, 0);
  const durationMs = legs.reduce((sum, leg) => sum + leg.durationMs, 0);
  if (durationMs > MAX_TRAVEL_DURATION_MS) throw new SimulationConfigError("Calculated travel duration exceeds the safety limit.");
  return freezeRoute({ nodeIds, segmentIds: segments.map((segment) => segment.id), legs, distanceUnits, durationMs });
}

export function createTravel(
  id: string,
  taskId: string,
  responderId: string,
  startLocation: FictionalTravelLocation,
  destination: FictionalTravelLocation,
  route: TravelRoute | undefined,
  responderSpeedUnitsPerSecond: number,
  progressIntervalMs: number,
  eventId: string,
  atMs: number,
  causeEventId?: string,
): TravelSnapshot {
  const active = route !== undefined;
  const status: TravelStatus = active ? "EN_ROUTE" : "BLOCKED";
  const action: TravelHistoryAction = active ? "DEPARTED" : "BLOCKED";
  const history = travelHistory(eventId, causeEventId, atMs, action, 1, startLocation, status);
  return freezeTravelSnapshot({
    id, taskId, responderId, status, routeVersion: 1,
    startLocation, destination, currentLocation: startLocation,
    ...(route === undefined ? {} : { route }),
    routeStartedAtMs: atMs,
    ...(active ? { departedAtMs: atMs, estimatedArrivalAtMs: atMs + route.durationMs } : {}),
    lastUpdatedAtMs: atMs,
    progressPermille: 0,
    distanceTravelledUnits: 0,
    remainingDistanceUnits: route?.distanceUnits ?? 0,
    responderSpeedUnitsPerSecond,
    progressIntervalMs,
    rerouteCount: 0,
    retryCount: 0,
    eventHistory: [history],
  });
}

export function projectTravel(travel: TravelSnapshot, atMs: number): TravelSnapshot {
  if (travel.status !== "EN_ROUTE" || travel.route === undefined) return freezeTravelSnapshot(travel);
  if (atMs <= travel.routeStartedAtMs) return freezeTravelSnapshot(travel);
  const elapsed = Math.max(0, Math.min(travel.route.durationMs, atMs - travel.routeStartedAtMs));
  const projected = locationAtElapsed(travel.route, elapsed);
  const progressPermille = travel.route.durationMs === 0 ? 1_000 : Math.min(1_000, Math.floor((elapsed * 1_000) / travel.route.durationMs));
  const routeTravelled = distanceAtElapsed(travel.route, elapsed);
  const priorTravelled = travel.distanceTravelledUnits - distanceAtElapsed(travel.route, Math.max(0, Math.min(travel.route.durationMs, travel.lastUpdatedAtMs - travel.routeStartedAtMs)));
  return freezeTravelSnapshot({
    ...travel,
    currentLocation: projected,
    lastUpdatedAtMs: Math.max(travel.lastUpdatedAtMs, Math.min(atMs, travel.estimatedArrivalAtMs ?? atMs)),
    progressPermille,
    distanceTravelledUnits: roundDistance(priorTravelled + routeTravelled),
    remainingDistanceUnits: roundDistance(Math.max(0, travel.route.distanceUnits - routeTravelled)),
  });
}

export function recordTravelProgress(travel: TravelSnapshot, eventId: string, atMs: number, causeEventId?: string): TravelSnapshot {
  const projected = projectTravel(travel, atMs);
  const history = travelHistory(eventId, causeEventId, atMs, "PROGRESSED", projected.routeVersion, projected.currentLocation, projected.status);
  return freezeTravelSnapshot({ ...projected, eventHistory: [...projected.eventHistory, history] });
}

export function rerouteTravel(travel: TravelSnapshot, route: TravelRoute, eventId: string, atMs: number, retry: boolean, causeEventId?: string): TravelSnapshot {
  const projected = projectTravel(travel, atMs);
  const nextVersion = travel.routeVersion + 1;
  const action: TravelHistoryAction = retry ? "RETRY_STARTED" : "REROUTED";
  const history = travelHistory(eventId, causeEventId, atMs, action, nextVersion, projected.currentLocation, "EN_ROUTE");
  return freezeTravelSnapshot({
    ...projected,
    status: "EN_ROUTE",
    routeVersion: nextVersion,
    route,
    routeStartedAtMs: atMs,
    ...(travel.departedAtMs === undefined ? { departedAtMs: atMs } : {}),
    estimatedArrivalAtMs: atMs + route.durationMs,
    lastUpdatedAtMs: atMs,
    progressPermille: 0,
    remainingDistanceUnits: route.distanceUnits,
    rerouteCount: travel.rerouteCount + (retry ? 0 : 1),
    retryCount: travel.retryCount + (retry ? 1 : 0),
    eventHistory: [...travel.eventHistory, history],
  });
}

export function blockTravel(travel: TravelSnapshot, eventId: string, atMs: number, retry: boolean, causeEventId?: string): TravelSnapshot {
  const projected = projectTravel(travel, atMs);
  const nextVersion = travel.routeVersion + 1;
  const history = travelHistory(eventId, causeEventId, atMs, "BLOCKED", nextVersion, projected.currentLocation, "BLOCKED");
  const { route: _route, estimatedArrivalAtMs: _arrival, ...withoutRoute } = projected;
  return freezeTravelSnapshot({ ...withoutRoute, status: "BLOCKED", routeVersion: nextVersion, lastUpdatedAtMs: atMs, progressPermille: projected.progressPermille, remainingDistanceUnits: 0, rerouteCount: travel.rerouteCount + (retry ? 0 : 1), retryCount: travel.retryCount + (retry ? 1 : 0), eventHistory: [...travel.eventHistory, history] });
}

export function arriveTravel(travel: TravelSnapshot, eventId: string, atMs: number, causeEventId?: string): TravelSnapshot {
  if (travel.status !== "EN_ROUTE") throw new SimulationEventError(`Travel ${travel.id} is not en route.`);
  const history = travelHistory(eventId, causeEventId, atMs, "ARRIVED", travel.routeVersion, travel.destination, "ARRIVED");
  return freezeTravelSnapshot({ ...travel, status: "ARRIVED", currentLocation: travel.destination, arrivedAtMs: atMs, lastUpdatedAtMs: atMs, progressPermille: 1_000, distanceTravelledUnits: roundDistance(travel.distanceTravelledUnits + travel.remainingDistanceUnits), remainingDistanceUnits: 0, eventHistory: [...travel.eventHistory, history] });
}

export function terminateTravel(travel: TravelSnapshot, status: "INTERRUPTED" | "CANCELLED", eventId: string, atMs: number, causeEventId?: string): TravelSnapshot {
  const projected = projectTravel(travel, atMs);
  const nextVersion = travel.routeVersion + 1;
  const action: TravelHistoryAction = status === "INTERRUPTED" ? "INTERRUPTED" : "CANCELLED";
  const history = travelHistory(eventId, causeEventId, atMs, action, nextVersion, projected.currentLocation, status);
  const { route: _route, estimatedArrivalAtMs: _arrival, ...withoutRoute } = projected;
  return freezeTravelSnapshot({ ...withoutRoute, status, routeVersion: nextVersion, lastUpdatedAtMs: atMs, remainingDistanceUnits: 0, eventHistory: [...travel.eventHistory, history] });
}

export function remainingRouteSegmentIds(travel: TravelSnapshot, atMs: number): readonly string[] {
  if (travel.status !== "EN_ROUTE" || travel.route === undefined) return Object.freeze([]);
  const elapsed = Math.max(0, atMs - travel.routeStartedAtMs);
  let accumulated = 0;
  const ids: string[] = [];
  for (const leg of travel.route.legs) {
    accumulated += leg.durationMs;
    if (accumulated > elapsed && leg.segmentId !== undefined) ids.push(leg.segmentId);
  }
  return Object.freeze(ids);
}

export function travelProgressEventTimes(travel: TravelSnapshot): readonly number[] {
  if (travel.status !== "EN_ROUTE" || travel.estimatedArrivalAtMs === undefined) return Object.freeze([]);
  const duration = travel.estimatedArrivalAtMs - travel.routeStartedAtMs;
  if (duration <= 1) return Object.freeze([]);
  const count = Math.min(MAX_TRAVEL_PROGRESS_EVENTS, Math.max(0, Math.ceil(duration / travel.progressIntervalMs) - 1));
  const times: number[] = [];
  for (let index = 1; index <= count; index += 1) {
    const atMs = travel.routeStartedAtMs + Math.floor((duration * index) / (count + 1));
    if (atMs > travel.routeStartedAtMs && atMs < travel.estimatedArrivalAtMs && times.at(-1) !== atMs) times.push(atMs);
  }
  return Object.freeze(times);
}

export function freezeRoadNetwork(network: RoadNetworkSnapshot): RoadNetworkSnapshot {
  return Object.freeze({
    nodes: Object.freeze(network.nodes.map((node) => Object.freeze({ id: node.id, location: freezeLocation(node.location) }))),
    segments: Object.freeze(network.segments.map((segment) => Object.freeze({ ...segment, history: Object.freeze(segment.history.map((entry) => Object.freeze({ ...entry }))) }))),
  });
}

export function freezeTravelSnapshot(travel: TravelSnapshot): TravelSnapshot {
  return Object.freeze({
    ...travel,
    startLocation: freezeLocation(travel.startLocation),
    destination: freezeLocation(travel.destination),
    currentLocation: freezeLocation(travel.currentLocation),
    ...(travel.route === undefined ? {} : { route: freezeRoute(travel.route) }),
    eventHistory: Object.freeze(travel.eventHistory.map((entry) => Object.freeze({ ...entry, location: freezeLocation(entry.location) }))),
  });
}

export function validateTravelLocation(input: unknown, label = "location"): FictionalTravelLocation {
  if (!isRecord(input) || input.fictional !== true || input.coordinateSystem !== "SIMULATED_LOCAL_GRID") throw new SimulationConfigError(`${label} must be explicitly fictional and use SIMULATED_LOCAL_GRID.`);
  if (typeof input.x !== "number" || !Number.isFinite(input.x) || Math.abs(input.x) > MAX_FICTIONAL_COORDINATE) throw new SimulationConfigError(`${label}.x is outside the fictional coordinate bounds.`);
  if (typeof input.y !== "number" || !Number.isFinite(input.y) || Math.abs(input.y) > MAX_FICTIONAL_COORDINATE) throw new SimulationConfigError(`${label}.y is outside the fictional coordinate bounds.`);
  const locationLabel = input.label;
  if (locationLabel !== undefined && (typeof locationLabel !== "string" || locationLabel.trim().length === 0 || locationLabel.length > 256)) throw new SimulationConfigError(`${label}.label must contain 1 to 256 characters.`);
  return freezeLocation({ fictional: true, coordinateSystem: "SIMULATED_LOCAL_GRID", x: roundCoordinate(input.x), y: roundCoordinate(input.y), ...(locationLabel === undefined ? {} : { label: locationLabel }) });
}

export function isRoadAccessState(value: unknown): value is RoadAccessState {
  return typeof value === "string" && (ROAD_ACCESS_STATES as readonly string[]).includes(value);
}

function segmentDurationMs(segment: RoadSegment, responderSpeed: number): number {
  const speed = Math.min(segment.speedUnitsPerSecond, responderSpeed);
  const statePermille = segment.state === "DEGRADED" ? 2_000 : segment.state === "UNKNOWN" ? 1_500 : 1_000;
  const numerator = segment.distanceUnits * 1_000 * segment.congestionPermille * statePermille;
  const duration = Math.ceil(numerator / (speed * 1_000_000));
  return Math.max(1, duration);
}

function addConnectorLeg(legs: TravelRouteLeg[], from: FictionalTravelLocation, to: FictionalTravelLocation, speed: number): void {
  const distanceUnits = coordinateDistance(from, to);
  if (distanceUnits === 0) return;
  legs.push(Object.freeze({ from, to, distanceUnits, durationMs: Math.max(1, Math.ceil((distanceUnits * 1_000) / speed)) }));
}

function nearestNode(nodes: readonly RoadNode[], location: FictionalTravelLocation): RoadNode | undefined {
  return [...nodes].sort((left, right) => coordinateDistance(left.location, location) - coordinateDistance(right.location, location) || compareText(left.id, right.id))[0];
}

function coordinateDistance(left: FictionalTravelLocation, right: FictionalTravelLocation): number {
  return Math.ceil(Math.hypot(right.x - left.x, right.y - left.y));
}

function locationAtElapsed(route: TravelRoute, elapsedMs: number): FictionalTravelLocation {
  if (route.legs.length === 0) return freezeLocation({ fictional: true, coordinateSystem: "SIMULATED_LOCAL_GRID", x: 0, y: 0 });
  if (elapsedMs <= 0) return route.legs[0]!.from;
  let remaining = elapsedMs;
  for (const leg of route.legs) {
    if (remaining >= leg.durationMs) {
      remaining -= leg.durationMs;
      continue;
    }
    const fraction = leg.durationMs === 0 ? 1 : remaining / leg.durationMs;
    return freezeLocation({ fictional: true, coordinateSystem: "SIMULATED_LOCAL_GRID", x: roundCoordinate(leg.from.x + (leg.to.x - leg.from.x) * fraction), y: roundCoordinate(leg.from.y + (leg.to.y - leg.from.y) * fraction), label: "Fictional in-transit position" });
  }
  return route.legs.at(-1)!.to;
}

function distanceAtElapsed(route: TravelRoute, elapsedMs: number): number {
  let remaining = elapsedMs;
  let distance = 0;
  for (const leg of route.legs) {
    if (remaining >= leg.durationMs) {
      distance += leg.distanceUnits;
      remaining -= leg.durationMs;
    } else {
      distance += leg.durationMs === 0 ? leg.distanceUnits : (leg.distanceUnits * remaining) / leg.durationMs;
      break;
    }
  }
  return roundDistance(distance);
}

function travelHistory(eventId: string, causeEventId: string | undefined, atMs: number, action: TravelHistoryAction, routeVersion: number, location: FictionalTravelLocation, state: TravelStatus): TravelHistoryEntry {
  return Object.freeze({ eventId, ...(causeEventId === undefined ? {} : { causeEventId }), atMs, action, routeVersion, location: freezeLocation(location), state });
}

function freezeRoute(route: TravelRoute): TravelRoute {
  return Object.freeze({ nodeIds: Object.freeze([...route.nodeIds]), segmentIds: Object.freeze([...route.segmentIds]), legs: Object.freeze(route.legs.map((leg) => Object.freeze({ ...leg, from: freezeLocation(leg.from), to: freezeLocation(leg.to) }))), distanceUnits: route.distanceUnits, durationMs: route.durationMs });
}

function freezeLocation(location: FictionalTravelLocation): FictionalTravelLocation {
  return Object.freeze({ fictional: true, coordinateSystem: "SIMULATED_LOCAL_GRID", x: roundCoordinate(location.x), y: roundCoordinate(location.y), ...(location.label === undefined ? {} : { label: location.label }) });
}

function roundCoordinate(value: number): number { return Math.round(value * 1_000) / 1_000; }
function roundDistance(value: number): number { return Math.round(value * 1_000) / 1_000; }
function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function validateId(value: unknown, label: string, prefix: string): string { const id = requireString(value, label); if (!new RegExp(`^${prefix}_[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`).test(id)) throw new SimulationConfigError(`${label} must use the ${prefix}_ prefix.`); return id; }
function requireString(value: unknown, label: string): string { if (typeof value !== "string" || value.length === 0 || value.length > 128) throw new SimulationConfigError(`${label} must be a non-empty string no longer than 128 characters.`); return value; }
function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new SimulationConfigError(`${label} must be an integer from ${minimum} to ${maximum}.`); return value; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
