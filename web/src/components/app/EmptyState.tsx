"use client";

import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, hint, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 border border-dashed border-line-strong bg-surface px-6 py-16 text-center">
      <div className="flex h-12 w-12 -rotate-3 items-center justify-center border-2 border-line-strong text-ink-muted">
        {icon}
      </div>
      <p className="font-display text-base font-semibold uppercase tracking-wide text-ink">{title}</p>
      {hint && <p className="max-w-sm text-sm text-ink-muted">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
