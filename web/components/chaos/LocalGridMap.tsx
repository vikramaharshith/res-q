import { cn } from "@/lib/cn";
import {
  formatGridNumber,
  type LocalGridFrame,
} from "@/lib/chaos/read-model";

const KIND = {
  emergency: { dot: "bg-cyan-300", label: "Emergency observation" },
  operational: { dot: "bg-amber-300", label: "Operational location" },
  unit: { dot: "bg-emerald-300", label: "Unit summary" },
} as const;

export function LocalGridCanvas({
  frame,
  selectedId,
  onSelect,
}: {
  frame: LocalGridFrame;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const plot = frame.plot;
  const hasPoints = plot.points.length > 0;
  return (
    <div className="relative h-full min-h-64 overflow-hidden bg-[#050505]">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.045) 1px, transparent 1px)",
          backgroundSize: "12.5% 12.5%",
        }}
      />
      {hasPoints ? (
        <>
          <p className="pointer-events-none absolute left-3 top-3 font-mono text-[10px] tracking-wide text-zinc-500">
            y {formatGridNumber(plot.yMax)}
          </p>
          <p className="pointer-events-none absolute bottom-3 left-3 font-mono text-[10px] tracking-wide text-zinc-500">
            x {formatGridNumber(plot.xMin)} · y {formatGridNumber(plot.yMin)}
          </p>
          <p className="pointer-events-none absolute right-3 bottom-3 font-mono text-[10px] tracking-wide text-zinc-500">
            x {formatGridNumber(plot.xMax)}
          </p>
          {plot.points.map((point) => {
            const selected = point.id === selectedId;
            const kind = KIND[point.kind];
            return (
              <button
                key={point.id}
                type="button"
                aria-pressed={selected}
                aria-label={`${kind.label} ${point.label}, grid x ${point.xText}, grid y ${point.yText}`}
                onClick={() => onSelect(point.id)}
                className="absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                style={{ left: `${point.left}%`, top: `${point.top}%`, zIndex: selected ? 3 : 1 }}
              >
                <span
                  className={cn(
                    "block h-3.5 w-3.5 shadow-[0_0_18px_rgba(103,232,249,0.28)]",
                    kind.dot,
                    point.kind === "unit" ? "rotate-45 rounded-[3px]" : "rounded-full",
                    selected && "h-4 w-4 ring-2 ring-white/85",
                  )}
                />
              </button>
            );
          })}
        </>
      ) : (
        <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-zinc-500">
          No staged grid points.
        </p>
      )}
    </div>
  );
}

export function LocalGridLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-2 border-t border-white/[0.06] px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
      {Object.entries(KIND).map(([key, kind]) => (
        <li key={key} className="flex items-center gap-2">
          <span
            className={cn(
              "h-2.5 w-2.5",
              kind.dot,
              key === "unit" ? "rotate-45 rounded-[2px]" : "rounded-full",
            )}
            aria-hidden
          />
          {kind.label}
        </li>
      ))}
    </ul>
  );
}
