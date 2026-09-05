"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Lock, Boxes, Images, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { clearAppPassword } from "@/lib/auth";
import { toast } from "@/hooks/use-toast";

export function TopBar() {
  const pathname = usePathname();
  const router = useRouter();

  const links = [
    { href: "/sessions", label: "Sessions", icon: Boxes },
    { href: "/images", label: "Images", icon: Images },
    { href: "/prompt", label: "Agent prompts", icon: Wand2 },
  ];

  function lock() {
    clearAppPassword();
    toast({ title: "Locked", description: "Session ended — the password will be asked again." });
    router.push("/");
  }

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Link href="/sessions" className="group flex items-center gap-2.5" aria-label="Stock Room home">
          <span className="flex h-7 w-7 -rotate-3 items-center justify-center bg-brand font-display text-[13px] font-bold text-white shadow-[var(--shadow-hard-sm)] transition-transform group-hover:rotate-0">
            SR
          </span>
          <span className="font-display text-lg font-bold uppercase tracking-tight">Stock Room</span>
        </Link>

        <nav className="flex items-center gap-1" aria-label="Main">
          {links.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 border-b-2 px-3 py-1.5 font-display text-sm font-semibold uppercase tracking-wide transition-colors",
                  active
                    ? "border-brand text-ink"
                    : "border-transparent text-ink-muted hover:border-line-strong hover:text-ink"
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden font-mono text-[11px] uppercase tracking-wider text-ink-muted md:block">
            AI asset dispatch
          </span>
          <button
            type="button"
            onClick={lock}
            className="flex h-8 w-8 items-center justify-center border border-line-strong bg-surface text-ink-muted transition-colors hover:border-ink hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
            aria-label="Lock the app (end session)"
            title="Lock the app"
          >
            <Lock className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    </header>
  );
}
