import { redactSecrets } from "@/lib/ai/nemotron-client";
import { adviseChaosObservation } from "@/lib/chaos/investigation-server";
import {
  chaosAdvisoryFailure,
  parseChaosInvestigationRequest,
  type ChaosAdvisoryDto,
} from "@/lib/chaos/investigation-contract";

export const maxDuration = 60;

function respond(advisory: ChaosAdvisoryDto, status: number): Response {
  return Response.json(redactSecrets(advisory), {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  let raw = "";
  try {
    raw = await request.text();
  } catch {
    return respond(
      chaosAdvisoryFailure({
        observationKind: "emergency",
        observationId: "",
        code: "INVALID_REQUEST",
        message: "The review request could not be read.",
        retryable: false,
      }),
      400,
    );
  }
  if (raw.length > 2_000) {
    return respond(
      chaosAdvisoryFailure({
        observationKind: "emergency",
        observationId: "",
        code: "INVALID_REQUEST",
        message: "The review request is too large.",
        retryable: false,
      }),
      400,
    );
  }
  let body: unknown;
  try {
    body = raw.trim() ? JSON.parse(raw) : null;
  } catch {
    return respond(
      chaosAdvisoryFailure({
        observationKind: "emergency",
        observationId: "",
        code: "INVALID_REQUEST",
        message: "The review request was not valid JSON.",
        retryable: false,
      }),
      400,
    );
  }
  const parsed = parseChaosInvestigationRequest(body);
  if (!parsed.ok) {
    return respond(
      chaosAdvisoryFailure({
        observationKind: "emergency",
        observationId: "",
        code: "INVALID_REQUEST",
        message: parsed.message,
        retryable: false,
      }),
      400,
    );
  }
  try {
    const result = await adviseChaosObservation(parsed.request);
    return respond(result.advisory, result.httpStatus);
  } catch {
    return respond(
      chaosAdvisoryFailure({
        observationKind: parsed.request.observation_kind,
        observationId: parsed.request.observation_id,
        code: "UPSTREAM_ERROR",
        message: "The review stopped because of a server error. Nothing was assigned.",
        retryable: true,
      }),
      500,
    );
  }
}
