"use client";

// Company switcher (spec 008 — multi-conta, FR-010/011/013).
//
// Lists every company the user belongs to and switches the ACTIVE
// one. Renders nothing for users with a single membership — the
// single-company experience must not regress (FR-013).
//
// Zero-residue rule (FR-016): after a successful switch we do a FULL
// page navigation to /dashboard instead of any in-place state update.
// This app fetches per-component (no shared query cache), so a hard
// navigation is the one mechanism that guarantees every server
// component and client fetch restarts under the new active account —
// nothing from the previous company can survive in memory.

import { useEffect, useState } from "react";
import { Building2, Check, ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface MembershipEntry {
  account_id: string;
  account_name: string;
  role: string;
  position: string | null;
}

export function AccountSwitcher() {
  const t = useTranslations("AccountSwitcher");
  const [memberships, setMemberships] = useState<MembershipEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/account/memberships")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setMemberships(data.memberships ?? []);
        setActiveId(data.active_account_id ?? null);
      })
      .catch(() => {
        // Silent: the switcher is auxiliary chrome — a failed load
        // just leaves it hidden rather than breaking the header.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // FR-013: with 0 or 1 companies there is nothing to switch — hide.
  if (memberships.length <= 1) return null;

  const active = memberships.find((m) => m.account_id === activeId);

  const onSwitch = async (accountId: string) => {
    if (accountId === activeId || switching) return;
    setSwitching(true);
    try {
      const res = await fetch("/api/account/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: accountId }),
      });
      if (!res.ok) throw new Error(`switch failed: ${res.status}`);
      // Full navigation — see zero-residue note at the top.
      window.location.assign("/dashboard");
    } catch (err) {
      console.error("[AccountSwitcher] switch failed:", err);
      toast.error(t("toastSwitchFailed"));
      setSwitching(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex h-9 max-w-44 items-center gap-1.5 rounded-md border border-border px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/70 focus:bg-muted/70 focus:outline-none data-popup-open:bg-muted/70 sm:max-w-56"
        aria-label={t("switchTo")}
        disabled={switching}
      >
        <Building2 className="size-4 shrink-0 text-muted-foreground" />
        <span className="hidden truncate sm:inline">
          {active?.account_name ?? t("label")}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="min-w-56 bg-popover text-popover-foreground ring-border"
      >
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          {t("switchTo")}
        </div>
        <DropdownMenuSeparator className="bg-border" />
        {memberships.map((m) => (
          <DropdownMenuItem
            key={m.account_id}
            onClick={() => onSwitch(m.account_id)}
            className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
          >
            <Building2 className="size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{m.account_name}</span>
            {m.account_id === activeId ? (
              <Check className="size-4 shrink-0 text-primary" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
