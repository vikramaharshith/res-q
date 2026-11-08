import { Suspense } from "react";
import { connection } from "next/server";

import { LargeChaosCommandCenter } from "@/components/chaos/LargeChaosCommandCenter";
import { ChaosRunSelector } from "@/components/chaos/ChaosRunSelector";
import { loadChaosRuns, loadLargeChaos } from "@/lib/chaos/load-large-chaos";
import { CHAOS_SAMPLE_IMPORT_RUN_ID } from "@/lib/chaos/read-model";
import type { ChaosRunOption } from "@/lib/chaos/large-read-model";
import { ChaosCommandCenter } from "@/components/chaos/ChaosCommandCenter";
import { CommandCenter } from "@/components/dashboard/CommandCenter";
import { loadDashboard } from "@/lib/dashboard/load-dashboard";
import { parseDashboardScenario } from "@/lib/dashboard/scenario-selection";

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<CommandCenterFallback />}>
      <LoadedCommandCenter searchParams={searchParams} />
    </Suspense>
  );
}

async function LoadedCommandCenter({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const query = await searchParams;
  const selection = parseDashboardScenario(query.scenario);
  if (selection === "chaos") {
    let runs: ChaosRunOption[] = [];
    try {
      runs = await loadChaosRuns();
    } catch {
      /* Old sample remains usable before migration. */
    }
    const selected =
      typeof query.run === "string"
        ? query.run
        : (runs[0]?.id ?? CHAOS_SAMPLE_IMPORT_RUN_ID);
    if (
      (query.run !== undefined && typeof query.run !== "string") ||
      selected !== CHAOS_SAMPLE_IMPORT_RUN_ID ||
      query.page !== undefined ||
      query.search !== undefined ||
      query.category !== undefined ||
      query.urgency !== undefined
    ) {
      return (
        <LargeChaosCommandCenter
          runs={runs}
          selected={selected}
          loaded={await loadLargeChaos(query, selected)}
        />
      );
    }
    const sample = await loadDashboard("chaos");
    if (sample.kind === "chaos")
      return (
        <ChaosCommandCenter
          loaded={sample.chaos}
          runSelector={<ChaosRunSelector runs={runs} selected={selected} />}
        />
      );
  }
  const loaded = await loadDashboard(selection);
  if (loaded.kind === "chaos") {
    return <ChaosCommandCenter loaded={loaded.chaos} />;
  }
  return (
    <CommandCenter
      scenario={loaded.scenario}
      history={loaded.history}
      approvalsOptIn={process.env.RESQ_LOCAL_APPROVALS === "1"}
    />
  );
}

function CommandCenterFallback() {
  return (
    <div className="command-fallback flex min-h-dvh flex-col bg-[#050505] text-zinc-100">
      <p className="p-6 text-sm text-zinc-500">Loading the command center…</p>
    </div>
  );
}
