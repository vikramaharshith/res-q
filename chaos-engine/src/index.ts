export { EventPriorityQueue } from "./core/event-priority-queue.js";
export type { QueuedEvent, ScheduledEvent } from "./core/event-priority-queue.js";
export { SeededRng } from "./core/random.js";
export type { RandomStream } from "./core/random.js";
export { VirtualClock } from "./core/virtual-clock.js";
export type { VirtualClockOptions } from "./core/virtual-clock.js";
export { CASCADE_RULE_IDS, planEvolution, validateEvolutionConfig } from "./evolution/evolution.js";
export type { CascadeApplication, DisasterType, EnvironmentState, EvolutionConfig, EvolutionMutation, InfrastructureEntity, InfrastructureHistoryEntry, InfrastructureStatus, InfrastructureType } from "./evolution/evolution.js";
export {
  MAX_NORMAL_REPORT_DELAY_MS,
  MAX_REPORTS_PER_GENERATION,
  ReportGenerator,
} from "./reporting/report-generator.js";
export {
  InformationNoiseProcessor,
  validateNoiseConfig,
} from "./reporting/noise.js";
export type {
  GeneratedReportPlan,
  InformationNoiseConfig,
  InformationTransformation,
  NoiseKind,
  PrivateReportEvaluation,
  PrivateSourceQuality,
  SourceQualityAdjustment,
  ValidatedNoiseConfig,
} from "./reporting/noise.js";
export {
  REPORT_CATEGORIES,
  REPORT_SOURCE_TYPES,
  projectPublicObservation,
} from "./reporting/types.js";
export type {
  EmergencyReport,
  FictionalGeographyConfig,
  FictionalReportLocation,
  ObservableClaim,
  ClaimConfidence,
  ClaimDetailStatus,
  ObservableUrgency,
  PublicEmergencyObservation,
  PublicSourceMetadata,
  ReportCategory,
  ReportGenerationConfig,
  ReportSourceType,
  ReportStatus,
} from "./reporting/types.js";
export {
  MAX_INCIDENT_SEVERITY,
  MIN_INCIDENT_SEVERITY,
  validateSimulationConfig,
} from "./simulation/config.js";
export type {
  InitialIncidentDefinition,
  SimulatedLocation,
  SimulationConfig,
  ValidatedSimulationConfig,
} from "./simulation/config.js";
export {
  MAX_RESPONDER_CAPABILITY_COUNT,
  MAX_RESPONDER_CREW_CAPACITY,
  MAX_RESPONDER_INVENTORY_ITEM_TYPES,
  MAX_RESPONDER_INVENTORY_QUANTITY_PER_ITEM,
  MAX_RESPONDER_TOTAL_INVENTORY_QUANTITY,
  RESPONDER_AVAILABILITY_STATES,
  RESPONDER_TYPES,
  isValidResponderTransition,
  validateResponderDefinition,
} from "./simulation/responder.js";
export {
  ACTIVE_TASK_STATUSES,
  MAX_TASK_CAPABILITY_COUNT,
  MAX_TASK_EQUIPMENT_ITEM_TYPES,
  MAX_TASK_EQUIPMENT_QUANTITY_PER_ITEM,
  MAX_TASK_ESTIMATED_EFFORT_MS,
  MAX_TASK_REQUIRED_CREW_CAPACITY,
  MAX_TASK_TOTAL_EQUIPMENT_QUANTITY,
  TASK_ASSIGNMENT_ORIGINS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  isActiveTaskStatus,
  isResponderQualifiedForTask,
  isValidTaskTransition,
  matchRespondersForTask,
  taskAssignmentEventPriority,
  validateTaskDefinition,
} from "./simulation/task.js";
export {
  DEFAULT_TRAVEL_PROGRESS_INTERVAL_MS,
  MAX_FICTIONAL_COORDINATE,
  MAX_ROAD_NODE_COUNT,
  MAX_ROAD_SEGMENT_COUNT,
  MAX_TRAVEL_DURATION_MS,
  MAX_TRAVEL_PROGRESS_EVENTS,
  MAX_TRAVEL_REROUTES,
  MAX_TRAVEL_RETRIES,
  ROAD_ACCESS_STATES,
  TRAVEL_STATUSES,
  createRoadNetwork,
  defaultRoadNetworkConfig,
  findShortestRoute,
  infrastructureStatusToRoadState,
  isRoadAccessState,
  projectIncidentLocation,
  projectTravel,
  remainingRouteSegmentIds,
  travelProgressEventTimes,
  validateRoadNetworkConfig,
  validateTravelLocation,
} from "./simulation/travel.js";
export {
  COMMUNICATION_STATES,
  MAX_COMMUNICATION_DELAY_MS,
  MAX_COMMUNICATION_RETRIES,
  MAX_PENDING_OPERATIONAL_MESSAGES,
  MAX_TOTAL_COMMUNICATION_EVENTS,
  OPERATIONAL_MESSAGE_TYPES,
  CommunicationDeliveryPlanner,
  communicationTransitionPath,
  isCommunicationState,
  isOperationalMessageType,
  isValidCommunicationTransition,
  validateCommunicationConfig,
  validateOperationalMessageRequest,
} from "./simulation/communication.js";
export {
  EQUIPMENT_CONDITIONS,
  MAX_FATIGUE,
  MAX_RECOVERY_DURATION_MS,
  MAX_REPLENISHMENT_DELAY_MS,
  MAX_REPLENISHMENT_QUANTITY,
  MAX_RESOURCE_RATE_PER_HOUR,
  MAX_STOCKPILES,
  MAX_STOCKPILE_ITEM_QUANTITY,
  MAX_STOCKPILE_TOTAL_QUANTITY,
  MAX_TOTAL_RESOURCE_EVENTS,
  RESOURCE_CATEGORIES,
  isEquipmentCondition,
  validateResourceConfig,
  validateStockpileDefinition,
  validateTransferQuantities,
} from "./simulation/resources.js";
export type {
  EquipmentCondition,
  FatigueMode,
  ReplenishmentSnapshot,
  ResourceCategory,
  ResourceChange,
  ResourceConfig,
  ResourceDefinition,
  ResourceHistoryEntry,
  ResponderResourceSnapshot,
  StockpileDefinition,
  StockpileSnapshot,
  TaskResourceSnapshot,
  ValidatedResourceConfig,
} from "./simulation/resources.js";
export type {
  CommandCenterKnowledge,
  CommunicationConfig,
  CommunicationInfrastructureLinkConfig,
  CommunicationState,
  CommunicationStateChangedChange,
  CommunicationStateHistoryEntry,
  OperationalDeliveryStatus,
  OperationalMessageChange,
  OperationalMessageContent,
  OperationalMessageRequest,
  OperationalMessageSnapshot,
  OperationalMessageSource,
  OperationalMessageType,
  PublicOperationalObservation,
  ResponderCommunicationSnapshot,
  ValidatedCommunicationConfig,
} from "./simulation/communication.js";
export type {
  FictionalTravelLocation,
  RoadAccessState,
  RoadNetworkConfig,
  RoadNetworkSnapshot,
  RoadNode,
  RoadNodeDefinition,
  RoadSegment,
  RoadSegmentDefinition,
  RoadStateChangedChange,
  RoadStateHistoryEntry,
  TravelChange,
  TravelHistoryAction,
  TravelHistoryEntry,
  TravelRoute,
  TravelRouteLeg,
  TravelSnapshot,
  TravelStatus,
} from "./simulation/travel.js";
export type {
  TaskAssignedChange,
  TaskAssignmentOrigin,
  TaskAssignmentSkippedChange,
  TaskChange,
  TaskCreatedChange,
  TaskDefinition,
  TaskHistoryAction,
  TaskHistoryEntry,
  TaskPriority,
  TaskSnapshot,
  TaskStateChangedChange,
  TaskStatus,
  ValidatedTaskDefinition,
} from "./simulation/task.js";
export type {
  FictionalResponderLocation,
  InitialResponderDefinition,
  ResponderAvailabilityState,
  ResponderChange,
  ResponderRegisteredChange,
  ResponderSnapshot,
  ResponderStateChangedChange,
  ResponderStateHistoryEntry,
  ResponderType,
  ValidatedResponderDefinition,
} from "./simulation/responder.js";
export {
  SimulationConfigError,
  SimulationEventError,
  SimulationLimitError,
  SimulationStateError,
} from "./simulation/errors.js";
export type {
  SimulationEvent,
  SimulationEventRequest,
  SimulationEventType,
} from "./simulation/events.js";
export type {
  IncidentChange,
  IncidentSnapshot,
  IncidentStatus,
} from "./simulation/incident.js";
export { SimulationEngine } from "./simulation/simulation-engine.js";
export {
  INTEGRATION_DIFFICULTIES,
  auditPublicSimulationOutputs,
  canonicalizeResponderIntegrationState,
  createResponderIntegrationPreset,
  executeResponderIntegrationWorkload,
  runResponderIntegrationWorkload,
  validateResponderIntegrationInvariants,
} from "./simulation/integration.js";
export type {
  IntegrationDifficulty,
  ResponderIntegrationMetrics,
  ResponderIntegrationPreset,
  ResponderIntegrationRun,
} from "./simulation/integration.js";
export {
  CHAOS_ENGINE_VERSION,
  PUBLIC_EXPORT_DIFFICULTIES,
  PUBLIC_SIMULATION_SCHEMA_VERSION,
  PublicSimulationExportError,
  createPublicSimulationExport,
  createSafeExportFilename,
  serializePublicSimulationExport,
  validatePublicSimulationExport,
  writePublicSimulationExport,
} from "./export/public-simulation-export.js";
export { CLI_DIFFICULTIES, CLI_SCENARIOS, runChaosCli, runCliSimulation } from "./cli/chaos-cli.js";
export type { CliIo, CliRunResult, CliScenarioKey } from "./cli/chaos-cli.js";
export type {
  PublicExportAssignment,
  PublicExportClaim,
  PublicExportDifficulty,
  PublicExportEmergencyObservation,
  PublicExportLocation,
  PublicExportOperationalContent,
  PublicExportOperationalObservation,
  PublicReplayManifest,
  PublicExportUnit,
  PublicExportValidationError,
  PublicExportValidationResult,
  PublicSimulationExport,
  PublicSimulationExportOptions,
  WritePublicSimulationExportOptions,
} from "./export/public-simulation-export.js";
export type {
  ProcessedEventRecord,
  ReportCreatedChange,
  EvolutionAppliedChange,
  SimulationChange,
  SimulationFailure,
  SimulationSnapshot,
  SimulationStatus,
  ResponderDepartureOptions,
} from "./simulation/simulation-engine.js";

