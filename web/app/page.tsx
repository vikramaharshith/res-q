import { Suspense } from "react";
import { connection } from "next/server";

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
  const loaded = await loadDashboard(parseDashboardScenario(query.scenario));
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
