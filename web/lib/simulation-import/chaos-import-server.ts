import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  SAMPLE_CHAOS_DESTINATION,
  STAGE_CHAOS_IMPORT_RPC,
  chaosServerCallAllowed,
  runControlledChaosImport,
  type ChaosImportAttempt,
  type ChaosImportExecutor,
} from "@/lib/simulation-import/chaos-import";

/**
 * Server entry for the two-report sample.
 * Dry-run returns before a Supabase client exists.
 * Apply creates the service-role client only after the approval token matches.
 */
export async function importChaosOnServer(
  text: string,
  options: {
    readonly mode?: "dry-run" | "apply";
    readonly destinationScenarioId?: string;
  } = {},
): Promise<ChaosImportAttempt> {
  const mode = options.mode ?? "dry-run";
  const destinationScenarioId = options.destinationScenarioId ?? SAMPLE_CHAOS_DESTINATION;
  if (!chaosServerCallAllowed(mode, process.env.RESQ_CHAOS_IMPORT_APPROVED)) {
    return runControlledChaosImport({
      text,
      destinationScenarioId,
      mode: mode === "apply" ? "apply" : "dry-run",
    });
  }
  const execute: ChaosImportExecutor = async (payload) => {
    const { data, error } = await createSupabaseServerClient().rpc(STAGE_CHAOS_IMPORT_RPC, {
      payload,
    });
    return {
      data,
      error: error ? { code: error.code, message: error.message } : null,
    };
  };
  return runControlledChaosImport({
    text,
    destinationScenarioId,
    mode: "apply",
    execute,
  });
}
