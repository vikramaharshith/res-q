import type { ReactNode } from "react";

export function SectionHeader({
  title,
  subtitle,
  aside,
  level = 2,
}: {
  title: string;
  subtitle?: string;
  aside?: ReactNode;
  level?: 2 | 3;
}) {
  const Tag = level === 3 ? "h3" : "h2";
  return (
    <div className="flex flex-col gap-3 border-b border-white/[0.06] px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
      <div className="min-w-0">
        <Tag className="text-xs font-semibold uppercase tracking-[0.2em] text-white">
          {title}
        </Tag>
        {subtitle ? (
          <p className="mt-1.5 text-sm leading-6 text-zinc-400">{subtitle}</p>
        ) : null}
      </div>
      {aside}
    </div>
  );
}
