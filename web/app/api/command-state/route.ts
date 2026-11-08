import { connection } from "next/server";

import { reloadCommandScenario } from "@/lib/demo/load-scenario";
import { redactServerText } from "@/lib/security/redact";
import { toCommandSnapshot } from "@/lib/approval/snapshot";

export async function GET(): Promise<Response> {
  await connection();
  try {
    const loaded = await reloadCommandScenario();
    if (loaded.source !== "supabase") {
      return Response.json(
        {
          ok: false,
          code: "DATABASE_UNAVAILABLE",
          message:
            "The live scenario could not be reloaded. The board was left unchanged. Nothing was assigned by this request.",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json(
      { ok: true, snapshot: toCommandSnapshot(loaded.scenario) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    console.error(`[resq-approval] command_state=${name}`);
    return Response.json(
      {
        ok: false,
        code: "DATABASE_UNAVAILABLE",
        message: redactServerText(
          "The live scenario could not be reloaded. The board was left unchanged.",
        ),
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
