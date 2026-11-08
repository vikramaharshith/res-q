import { LargeChaosReady } from "@/components/chaos/LargeChaosReady";
import Link from "next/link";
import { ChaosRunSelector } from "@/components/chaos/ChaosRunSelector";
import { ScenarioSelector } from "@/components/dashboard/ScenarioSelector";
import {
  chaosPageHref,
  type ChaosLargeLoad,
  type ChaosRunOption,
} from "@/lib/chaos/large-read-model";
import {
  REPORT_CATEGORIES,
  URGENCY_LEVELS,
} from "@/lib/simulation-import/types";
export function LargeChaosCommandCenter({
  loaded,
  runs,
  selected,
}: {
  loaded: ChaosLargeLoad;
  runs: ChaosRunOption[];
  selected: string;
}) {
  const data = loaded.ok ? loaded.data : null,
    query = loaded.ok ? loaded.query : null;
  const pages = data ? Math.max(1, Math.ceil(data.matched / 50)) : 1;
  const peak = Math.max(1, ...(data?.cells.map((c) => c.n) ?? []));
  return (
    <div
      className="min-h-dvh bg-[#050505] text-zinc-200"
      data-scenario="chaos-large"
    >
      <LargeChaosReady />
      <header className="border-b border-white/10 px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <h1 className="text-2xl tracking-[0.2em] text-white">
            RES-Q <span className="text-xs text-zinc-500">by B7</span>
          </h1>
          <p className="my-3 text-sm text-zinc-400">
            Chaos Simulation · Fictional emergency observations
          </p>
          <ScenarioSelector active="chaos" />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <ChaosRunSelector runs={runs} selected={selected} />
        {!loaded.ok ? (
          <p role="alert" className="py-10 text-amber-200">
            {loaded.message}
          </p>
        ) : null}
        {data && query ? (
          <>
            <section
              aria-label="Actual imported record counts"
              className="my-8 grid grid-cols-2 gap-5 lg:grid-cols-4"
            >
              <div className="col-span-2 lg:col-span-1">
                <p className="text-xs uppercase tracking-widest text-zinc-500">
                  Emergency observations
                </p>
                <p
                  data-testid="emergency-count"
                  className="mt-2 font-mono text-6xl font-semibold tracking-tight text-white sm:text-7xl"
                >
                  {data.counts.emergency.toLocaleString("en-US")}
                </p>
                <p className="mt-2 text-xs text-zinc-500">
                  Counted from imported database records
                </p>
              </div>
              {(
                [
                  ["Operational observations", data.counts.operational],
                  ["Responder units", data.counts.units],
                  ["Public assignments", data.counts.assignments],
                ] as const
              ).map(([label, count]) => (
                <div key={label} className="border-l border-white/10 pl-5">
                  <p className="text-xs text-zinc-500">{label}</p>
                  <p className="mt-3 font-mono text-3xl text-white">
                    {count.toLocaleString("en-US")}
                  </p>
                </div>
              ))}
            </section>
            <p className="mb-6 break-all text-xs leading-6 text-zinc-500">
              Run {data.run.runId}. Public assignments are simulation history.
              This view cannot dispatch responders or create approvals. Nemotron
              review remains available in the original sample.
            </p>
            <form
              method="get"
              action="/"
              aria-label="Filter emergency observations"
              className="flex flex-wrap items-end gap-3 rounded-xl border border-white/10 bg-[#0a0a0a] p-4"
            >
              <input type="hidden" name="scenario" value="chaos" />
              <input type="hidden" name="run" value={query.run} />
              <label className="flex min-w-0 flex-1 basis-56 flex-col gap-2 text-xs text-zinc-400">
                Search words or report ID
                <input
                  type="search"
                  name="search"
                  maxLength={120}
                  defaultValue={query.search}
                  className="rounded-lg border border-white/15 bg-black p-3 text-sm text-white"
                />
              </label>
              <label className="flex flex-col gap-2 text-xs text-zinc-400">
                Category
                <select
                  name="category"
                  defaultValue={query.category}
                  className="rounded-lg border border-white/15 bg-black p-3 text-sm text-white"
                >
                  <option value="">All categories</option>
                  {REPORT_CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-2 text-xs text-zinc-400">
                Urgency
                <select
                  name="urgency"
                  defaultValue={query.urgency}
                  className="rounded-lg border border-white/15 bg-black p-3 text-sm text-white"
                >
                  <option value="">All urgencies</option>
                  {URGENCY_LEVELS.map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </select>
              </label>
              <button className="rounded-lg border border-white/25 px-5 py-3 text-sm hover:bg-white/10">
                Search / filter
              </button>
            </form>
            <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <section
                aria-label="Aggregated fictional grid"
                className="rounded-xl border border-white/10 bg-[#080808] p-4 lg:sticky lg:top-4"
              >
                <h2 className="text-sm text-white">Fictional local grid</h2>
                <p className="mt-2 text-xs leading-5 text-zinc-500">
                  {data.matched.toLocaleString("en-US")} matching reports
                  aggregated into {data.cells.length} cells. Higher y is upward.
                  Coordinates remain simulated x/y.
                </p>
                <svg
                  viewBox="0 0 420 440"
                  role="img"
                  aria-label="Report density on simulated local grid"
                  className="mt-4 w-full"
                >
                  <rect
                    x="10"
                    y="10"
                    width="400"
                    height="400"
                    fill="#101010"
                    stroke="#333"
                  />
                  {data.cells.map((c) => (
                    <rect
                      key={`${c.cx}:${c.cy}`}
                      data-grid-cell=""
                      x={11 + c.cx * 20}
                      y={11 + (19 - c.cy) * 20}
                      width="18"
                      height="18"
                      fill="#a5e5e3"
                      opacity={0.15 + 0.8 * Math.sqrt(c.n / peak)}
                    >
                      <title>
                        {c.n} reports · cell {c.cx},{c.cy}
                      </title>
                    </rect>
                  ))}
                  <text x="10" y="432" fill="#888" fontSize="10">
                    x: {data.bounds.xmin ?? "—"} → {data.bounds.xmax ?? "—"}
                  </text>
                </svg>
                <p className="break-words font-mono text-xs text-zinc-500">
                  y: {data.bounds.ymin ?? "—"} → {data.bounds.ymax ?? "—"}
                </p>
              </section>
              <section aria-label="Emergency observations" className="min-w-0">
                <div className="mb-4 flex flex-wrap justify-between gap-2 text-sm">
                  <h2>
                    {data.matched.toLocaleString("en-US")} matching observations
                  </h2>
                  <span className="text-zinc-500">
                    Page {data.page + 1} of {pages}
                  </span>
                </div>
                <div className="flex flex-col gap-3">
                  {data.reports.map((r) => (
                    <article
                      key={r.report_id}
                      data-emergency-report=""
                      className="min-w-0 rounded-xl border border-white/10 bg-[#0b0b0b] p-4"
                    >
                      <div className="flex flex-wrap justify-between gap-2 text-xs">
                        <span className="text-zinc-300">{r.category}</span>
                        <span className="text-cyan-100/80">
                          {r.urgency ?? "Unspecified urgency"}
                        </span>
                      </div>
                      <p className="mt-3 break-words text-sm leading-6">
                        {r.narrative}
                      </p>
                      <details className="mt-3 text-xs text-zinc-500">
                        <summary className="cursor-pointer">
                          Source and fictional location
                        </summary>
                        <dl className="mt-3 space-y-2 break-all">
                          <div>
                            <dt>Report ID</dt>
                            <dd>{r.report_id}</dd>
                          </div>
                          <div>
                            <dt>Received</dt>
                            <dd>{r.received_at}</dd>
                          </div>
                          <div>
                            <dt>Grid x / y</dt>
                            <dd>
                              {r.grid_x} / {r.grid_y}
                            </dd>
                          </div>
                          <div>
                            <dt>District</dt>
                            <dd>{r.district ?? "—"}</dd>
                          </div>
                        </dl>
                      </details>
                    </article>
                  ))}
                </div>
                {!data.reports.length ? (
                  <p className="py-8 text-sm text-zinc-500">
                    No observations on this page. Adjust filters or return to
                    the first page.
                  </p>
                ) : null}
                <nav
                  aria-label="Report pages"
                  className="mt-6 flex flex-wrap gap-3"
                >
                  {data.page > 0 ? (
                    <Link
                      prefetch={false}
                      href={chaosPageHref(query, data.page - 1)}
                      className="rounded-lg border border-white/15 px-4 py-3 text-sm"
                    >
                      Previous
                    </Link>
                  ) : null}
                  {data.page + 1 < pages ? (
                    <Link
                      prefetch={false}
                      href={chaosPageHref(query, data.page + 1)}
                      className="rounded-lg border border-white/15 px-4 py-3 text-sm"
                    >
                      Next
                    </Link>
                  ) : null}
                  {data.page > 0 ? (
                    <Link
                      prefetch={false}
                      href={chaosPageHref(query, 0)}
                      className="px-4 py-3 text-sm text-zinc-400"
                    >
                      First page
                    </Link>
                  ) : null}
                </nav>
              </section>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}
