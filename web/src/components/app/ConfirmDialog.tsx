"use client";

/**
 * Custom confirm popup (replaces window.confirm) — stockroom design.
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  danger = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="rounded-none border-ink bg-surface shadow-[var(--shadow-hard)] sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-lg font-bold uppercase tracking-wide">
            {title}
          </AlertDialogTitle>
          {description && (
            <AlertDialogDescription className="text-sm leading-relaxed text-ink-muted">
              {description}
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-0 sm:space-x-0">
          <AlertDialogCancel className="h-9 rounded-none border-ink/30 bg-surface font-display text-xs font-semibold uppercase tracking-widest text-ink hover:border-ink hover:bg-surface focus-visible:outline-2 focus-visible:outline-brand">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            className={cn(
              "h-9 rounded-none border font-display text-xs font-bold uppercase tracking-widest text-white focus-visible:outline-2 focus-visible:outline-brand",
              danger
                ? "border-danger bg-danger hover:bg-danger/85"
                : "border-brand bg-brand hover:bg-brand-deep"
            )}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
