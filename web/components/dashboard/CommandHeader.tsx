import type { Scenario } from "@/lib/demo/types";
import type { DashboardScenarioId } from "@/lib/dashboard/scenario-selection";
import { ScenarioSelector } from "@/components/dashboard/ScenarioSelector";

const FLOOD_LINKS = [
  { href: "#operations-map", label: "Map" },
  { href: "#incident-queue", label: "Incidents" },
  { href: "#case-file", label: "Case file" },
] as const;

export function CommandTopBar({
  subtitle,
  active,
  links,
  onReplayIntro,
}: {
  subtitle: string;
  active: DashboardScenarioId;
  links: readonly { href: string; label: string }[];
  onReplayIntro: () => void;
}) {
  return (
    <header
      data-scenario={active}
      className="startup-chrome-top sticky top-0 z-[1200] border-b border-white/[0.06] bg-[#050505]/88 backdrop-blur-md"
    >
      <div className="mx-auto flex w-full max-w-[90rem] flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-[1.65rem] font-medium leading-none tracking-[0.22em] text-white sm:text-3xl">
              RES-Q
              <span className="ml-3 align-middle text-[10px] font-medium tracking-[0.34em] text-zinc-500 sm:text-[11px]">
                {" by B7"}
              </span>
            </h1>
            <p className="mt-2 truncate text-sm text-zinc-300 sm:text-base">{subtitle}</p>
          </div>
          <div className="flex items-center justify-between gap-4 lg:justify-end">
            <nav aria-label="Command center sections" className="flex items-center gap-4">
              {links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400 transition-colors duration-200 hover:text-cyan-100"
                >
                  {link.label}
                </a>
              ))}
            </nav>
            <button
              type="button"
              className="intro-replay"
              onClick={onReplayIntro}
              aria-label="Replay introduction"
            >
              Replay
            </button>
          </div>
        </div>
        <ScenarioSelector active={active} />
      </div>
    </header>
  );
}

export function CommandHeader({
  scenario,
  onReplayIntro,
}: {
  scenario: Scenario;
  onReplayIntro: () => void;
}) {
  return (
    <CommandTopBar
      subtitle={scenario.name}
      active="flood"
      links={FLOOD_LINKS}
      onReplayIntro={onReplayIntro}
    />
  );
}
