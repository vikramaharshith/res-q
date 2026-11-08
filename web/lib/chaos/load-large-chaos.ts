import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  parseChaosLargePage,
  parseChaosPageQuery,
  parseChaosRuns,
  type ChaosLargeLoad,
  type ChaosRunOption,
} from "@/lib/chaos/large-read-model";
export async function loadChaosRuns(): Promise<ChaosRunOption[]> {
  const { data, error } = await createSupabaseServerClient().rpc(
    "chaos_dashboard_runs",
  );
  if (error)
    throw new Error(
      "Imported run list unavailable. The additive large-Chaos migration may be pending.",
    );
  return parseChaosRuns(data);
}
export async function loadLargeChaos(
  params: Record<string, unknown>,
  run: string,
): Promise<ChaosLargeLoad> {
  try {
    const query = parseChaosPageQuery(params, run);
    const { data, error } = await createSupabaseServerClient().rpc(
      "chaos_dashboard_page",
      {
        p_run: query.run,
        p_page: query.page,
        p_search: query.search,
        p_category: query.category,
        p_urgency: query.urgency,
      },
    );
    if (error || !data)
      throw new Error(
        "This imported run is unavailable. Check the run selection and database migration.",
      );
    return { ok: true, query, data: parseChaosLargePage(data, query) };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Chaos read failed.",
    };
  }
}
