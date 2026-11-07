import type { ReactNode } from "react";

export function SectionHeader({
  title,
  subtitle,
  aside,
}: {
  title: string;
  subtitle?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
      <div>
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/80">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-1 text-xs leading-5 text-slate-400">{subtitle}</p>
        ) : null}
      </div>
      {aside}
    </div>
  );
}
