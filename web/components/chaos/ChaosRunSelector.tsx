import type { ChaosRunOption } from "@/lib/chaos/large-read-model";
import { CHAOS_SAMPLE_IMPORT_RUN_ID } from "@/lib/chaos/read-model";
export function ChaosRunSelector({
  runs,
  selected,
}: {
  runs: readonly ChaosRunOption[];
  selected: string;
}) {
  const options = runs.some((r) => r.id === CHAOS_SAMPLE_IMPORT_RUN_ID)
    ? runs
    : [
        ...runs,
        {
          id: CHAOS_SAMPLE_IMPORT_RUN_ID,
          label: "Original two-report sample",
          runId: "sample",
          destination: null,
        },
      ];
  return (
    <form
      action="/"
      method="get"
      className="flex flex-wrap items-end gap-3 border-b border-white/10 bg-[#080808] px-4 py-4 sm:px-6"
    >
      <input type="hidden" name="scenario" value="chaos" />
      <label className="flex min-w-0 flex-1 flex-col gap-2 text-xs text-zinc-400">
        Imported Chaos run{" "}
        <span className="text-zinc-600">Latest 100 runs · fictional data</span>
        <select
          name="run"
          aria-label="Imported Chaos run"
          defaultValue={selected}
          className="w-full rounded-lg border border-white/15 bg-black p-3 text-sm text-white"
        >
          {options.map((r) => (
            <option key={r.id} value={r.id}>
              {r.id === CHAOS_SAMPLE_IMPORT_RUN_ID
                ? "Original two-report sample"
                : `${r.label} · ${r.runId}`}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        className="rounded-lg border border-white/20 px-5 py-3 text-sm text-zinc-100 hover:bg-white/10"
      >
        Open run
      </button>
    </form>
  );
}
