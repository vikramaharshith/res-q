/**
 * Request and response shape for one Chaos observation review.
 * This file is safe to import from the browser. It has no secrets.
 */

export const CHAOS_BOUND_SCENARIO_ID = "scn_chaos_sample";

const REQUEST_KEYS = ["mode", "observation_id", "observation_kind", "scenario_id"] as const;
const OBSERVATION_ID = /^[A-Za-z0-9_-]{1,200}$/;

export type ChaosObservationKind = "emergency" | "operational";

export interface ChaosInvestigationRequest {
  readonly mode: "advise";
  readonly scenario_id: typeof CHAOS_BOUND_SCENARIO_ID;
  readonly observation_kind: ChaosObservationKind;
  readonly observation_id: string;
}

export interface ChaosAdvisoryDto {
  advisory: true;
  assignment_created: false;
  approval_recorded: false;
  dispatch: false;
  scenario_id: typeof CHAOS_BOUND_SCENARIO_ID;
  observation_kind: ChaosObservationKind;
  observation_id: string;
  model_id: string | null;
  status: "COMPLETED" | "FAILED";
  validated: boolean;
  summary: string | null;
  uncertainty: string | null;
  note: string | null;
  error: { code: string; message: string; retryable: boolean } | null;
}

export function chaosAdvisoryFailure(input: {
  observationKind: ChaosObservationKind;
  observationId: string;
  code: string;
  message: string;
  retryable: boolean;
  modelId?: string | null;
}): ChaosAdvisoryDto {
  return {
    advisory: true,
    assignment_created: false,
    approval_recorded: false,
    dispatch: false,
    scenario_id: CHAOS_BOUND_SCENARIO_ID,
    observation_kind: input.observationKind,
    observation_id: input.observationId,
    model_id: input.modelId ?? null,
    status: "FAILED",
    validated: false,
    summary: null,
    uncertainty: null,
    note: null,
    error: {
      code: input.code,
      message: input.message,
      retryable: input.retryable,
    },
  };
}

export function isChaosAdvisoryDto(value: unknown): value is ChaosAdvisoryDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const error = record.error;
  const errorOk =
    error === null ||
    (!!error &&
      typeof error === "object" &&
      !Array.isArray(error) &&
      typeof (error as { code?: unknown }).code === "string" &&
      typeof (error as { message?: unknown }).message === "string");
  return (
    record.advisory === true &&
    record.assignment_created === false &&
    record.approval_recorded === false &&
    record.dispatch === false &&
    record.scenario_id === CHAOS_BOUND_SCENARIO_ID &&
    (record.observation_kind === "emergency" || record.observation_kind === "operational") &&
    typeof record.observation_id === "string" &&
    (record.model_id === null || typeof record.model_id === "string") &&
    (record.status === "COMPLETED" || record.status === "FAILED") &&
    typeof record.validated === "boolean" &&
    (record.summary === null || typeof record.summary === "string") &&
    (record.uncertainty === null || typeof record.uncertainty === "string") &&
    (record.note === null || typeof record.note === "string") &&
    errorOk
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Accepts only the four binding fields. Extra fields are refused. */
export function parseChaosInvestigationRequest(
  value: unknown,
): { ok: true; request: ChaosInvestigationRequest } | { ok: false; message: string } {
  if (!isRecord(value)) return { ok: false, message: "The review request must be a JSON object." };
  const keys = Object.keys(value);
  if (keys.length !== REQUEST_KEYS.length || REQUEST_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    return { ok: false, message: "The review request has fields outside the scenario binding." };
  }
  if (value.mode !== "advise") return { ok: false, message: 'mode must be "advise".' };
  if (value.scenario_id !== CHAOS_BOUND_SCENARIO_ID) {
    return { ok: false, message: "That scenario is not the staged Chaos sample." };
  }
  if (value.observation_kind !== "emergency" && value.observation_kind !== "operational") {
    return { ok: false, message: "Choose one public emergency observation or one delivered operational observation." };
  }
  if (typeof value.observation_id !== "string" || !OBSERVATION_ID.test(value.observation_id)) {
    return { ok: false, message: "The observation id is not a public identifier." };
  }
  return {
    ok: true,
    request: {
      mode: "advise",
      scenario_id: CHAOS_BOUND_SCENARIO_ID,
      observation_kind: value.observation_kind,
      observation_id: value.observation_id,
    },
  };
}
