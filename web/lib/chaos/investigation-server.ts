import "server-only";

import { callNemotron, getNemotronConfig, NemotronRequestError } from "@/lib/ai/nemotron-client";
import { loadChaosSimulation } from "@/lib/chaos/load-chaos-simulation";
import {
  CHAOS_BOUND_SCENARIO_ID,
  chaosAdvisoryFailure,
  type ChaosAdvisoryDto,
  type ChaosInvestigationRequest,
} from "@/lib/chaos/investigation-contract";
import { bindChaosObservation, interpretChaosAdvisory } from "@/lib/chaos/investigation-payload";

/**
 * One advisory review of one staged Chaos observation.
 * Reads the sample, calls Nemotron, and does not write an approval or an assignment.
 */

const SYSTEM_PROMPT = [
  "You advise a human operator inside RES-Q by B7.",
  "This is a fictional disaster simulation. Your output is advisory.",
  "You do not dispatch, assign, approve, or contact anyone.",
  "You receive one observation. You do not infer a link to any other incident or report.",
].join(" ");

let inFlight = false;

export async function adviseChaosObservation(request: ChaosInvestigationRequest): Promise<{
  httpStatus: number;
  advisory: ChaosAdvisoryDto;
}> {
  if (request.scenario_id !== CHAOS_BOUND_SCENARIO_ID) {
    return {
      httpStatus: 400,
      advisory: chaosAdvisoryFailure({
        observationKind: request.observation_kind,
        observationId: request.observation_id,
        code: "SCENARIO_MISMATCH",
        message: "That scenario is not the staged Chaos sample. Nothing was sent.",
        retryable: false,
      }),
    };
  }
  const loaded = await loadChaosSimulation();
  if (!loaded.ok) {
    return {
      httpStatus: 503,
      advisory: chaosAdvisoryFailure({
        observationKind: request.observation_kind,
        observationId: request.observation_id,
        code: "SAMPLE_UNAVAILABLE",
        message: "The staged Chaos sample could not be read. Nothing was sent to Nemotron.",
        retryable: true,
      }),
    };
  }
  const bound = bindChaosObservation(loaded.board, request);
  if (!bound.ok) {
    return {
      httpStatus: 404,
      advisory: chaosAdvisoryFailure({
        observationKind: request.observation_kind,
        observationId: request.observation_id,
        code: "OBSERVATION_NOT_BOUND",
        message: bound.message,
        retryable: false,
      }),
    };
  }
  const configured = getNemotronConfig();
  if (!configured.ok) {
    return {
      httpStatus: configured.error.httpStatus,
      advisory: chaosAdvisoryFailure({
        observationKind: request.observation_kind,
        observationId: request.observation_id,
        code: configured.error.code,
        message: configured.error.message,
        retryable: configured.error.retryable,
      }),
    };
  }
  if (inFlight) {
    return {
      httpStatus: 429,
      advisory: chaosAdvisoryFailure({
        observationKind: request.observation_kind,
        observationId: request.observation_id,
        modelId: configured.config.modelId,
        code: "BUSY",
        message: "Another Chaos review is still running. Nothing was assigned.",
        retryable: true,
      }),
    };
  }
  inFlight = true;
  const started = performance.now();
  try {
    const turn = await callNemotron({
      config: configured.config,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: bound.bound.prompt },
      ],
      tools: [],
      toolChoice: "none",
      timeoutMs: 45_000,
    });
    console.info(
      `[resq-chaos-agent] kind=${request.observation_kind} id=${request.observation_id} nvidia_ms=${Math.round(performance.now() - started)} tools=${turn.toolCalls.length}`,
    );
    if (turn.toolCalls.length > 0) {
      return {
        httpStatus: 502,
        advisory: chaosAdvisoryFailure({
          observationKind: request.observation_kind,
          observationId: request.observation_id,
          modelId: turn.modelId,
          code: "TOOL_REFUSED",
          message: "Nemotron tried to call a tool. The call was not executed. Nothing was assigned.",
          retryable: true,
        }),
      };
    }
    return {
      httpStatus: 200,
      advisory: interpretChaosAdvisory(turn.content, bound.bound, turn.modelId),
    };
  } catch (error) {
    if (error instanceof NemotronRequestError) {
      return {
        httpStatus: error.httpStatus,
        advisory: chaosAdvisoryFailure({
          observationKind: request.observation_kind,
          observationId: request.observation_id,
          modelId: configured.config.modelId,
          code: error.code,
          message: error.message,
          retryable: error.retryable,
        }),
      };
    }
    console.error("[resq-chaos-agent] unexpected");
    return {
      httpStatus: 500,
      advisory: chaosAdvisoryFailure({
        observationKind: request.observation_kind,
        observationId: request.observation_id,
        code: "UPSTREAM_ERROR",
        message: "The review stopped because of a server error. Nothing was assigned.",
        retryable: true,
      }),
    };
  } finally {
    inFlight = false;
  }
}
