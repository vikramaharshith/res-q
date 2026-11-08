import { readFileSync, statSync } from "node:fs";
import {
  executeLargeChaosImport,
  largeImportApproved,
  LARGE_CHAOS_RPC,
  prepareLargeChaosImport,
} from "@/lib/simulation-import/large-chaos-import";

const args = process.argv.slice(2);
const options: Record<string, string> = {};
let mode = "dry-run";
try {
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (seen.has(key)) throw new Error("Duplicate argument.");
    seen.add(key);
    if (key === "--apply" || key === "--dry-run") {
      if (seen.has(key === "--apply" ? "--dry-run" : "--apply"))
        throw new Error("Conflicting modes.");
      mode = key.slice(2);
    } else if (
      ["--file", "--destination", "--sha256"].includes(key) &&
      args[i + 1] &&
      !args[i + 1].startsWith("--")
    ) {
      options[key] = args[++i];
    } else
      throw new Error(
        "Use --file PATH --destination scn_chaos_large_NAME [--dry-run | --apply --sha256 DIGEST].",
      );
  }
  if (!options["--file"] || !options["--destination"])
    throw new Error("--file and --destination are required.");
  const stat = statSync(options["--file"]);
  if (!stat.isFile() || stat.size > 32 * 1024 * 1024)
    throw new Error("Input exceeds the public export byte limit.");
  const prepared = prepareLargeChaosImport(
    readFileSync(options["--file"], "utf8"),
    options["--destination"],
  );
  console.log(
    JSON.stringify(
      { mode, ...prepared.summary, remoteChecked: false },
      null,
      2,
    ),
  );
  if (mode === "apply") {
    if (
      options["--sha256"] !== prepared.summary.sha256 ||
      !largeImportApproved(
        mode,
        prepared.summary.sha256,
        prepared.summary.destination,
        process.env.RESQ_CHAOS_LARGE_IMPORT_APPROVED,
      )
    ) {
      throw new Error(
        "Apply refused: --sha256 and digest:destination approval must match this exact dry-run artifact.",
      );
    }
    // Credentials are supplied by the operator's environment, never loaded or printed by dry-run.
    const { createSupabaseServerClient } =
      await import("@/lib/supabase/server");
    const result = await executeLargeChaosImport(prepared, async (payload) => {
      const { data, error } = await createSupabaseServerClient().rpc(
        LARGE_CHAOS_RPC,
        { payload },
      );
      return { data, error };
    });
    console.log(
      JSON.stringify({ code: result.code, importRunId: result.import_run_id }),
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Import stopped.");
  process.exitCode = 1;
}
