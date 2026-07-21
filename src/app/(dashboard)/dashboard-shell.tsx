"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { NoAccountScreen } from "@/components/layout/no-account";
import { PresenceHeartbeat } from "@/components/presence/presence-heartbeat";

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading, profile, profileLoading } = useAuth();
  const router = useRouter();

  // Sidebar drawer state — only used on mobile. On lg+ the sidebar is
  // always visible and this stays at `false` (ignored by the component).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  // "Sem empresa" gate (spec 008, FR-023). A NULL active-account
  // pointer has two very different meanings:
  //   - the user has memberships but the pointer broke (active
  //     company deleted/revoked) → self-heal by switching to one
  //     and reloading;
  //   - the user belongs to NO company → neutral NoAccountScreen.
  // `null` = still deciding; only render the screen once we know.
  const [noAccount, setNoAccount] = useState<boolean | null>(null);

  useEffect(() => {
    // Reset is handled at render time (the screen only shows while
    // the pointer is still NULL) — no synchronous setState here.
    if (profileLoading || !profile || profile.account_id) return;
    let cancelled = false;
    fetch("/api/account/memberships")
      .then((res) => (res.ok ? res.json() : null))
      .then(async (data) => {
        if (cancelled) return;
        const first = data?.memberships?.[0]?.account_id ?? null;
        if (!first) {
          setNoAccount(true);
          return;
        }
        // Pointer broke but the user has companies — activate the
        // first and restart the app under it (mirrors the server-side
        // self-heal in getCurrentAccount).
        await fetch("/api/account/switch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account_id: first }),
        }).catch(() => {});
        window.location.reload();
      })
      .catch(() => {
        // Network hiccup — don't lock the user out on a guess.
        if (!cancelled) setNoAccount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [profileLoading, profile]);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  // Authenticated but company-less (FR-023): neutral dead-end screen,
  // no app chrome, no data of any company reachable. The extra
  // pointer check makes the state self-resetting: as soon as the
  // profile gains an active company (invite accepted elsewhere +
  // refresh), the screen stops rendering without bookkeeping.
  if (noAccount === true && profile && !profile.account_id) {
    return <NoAccountScreen />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Reports this tab's online/away presence once we know a user is
          signed in. Headless — renders nothing. */}
      <PresenceHeartbeat />
      <Sidebar open={sidebarOpen} onClose={closeSidebar} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onOpenSidebar={() => setSidebarOpen(true)} />
        {/* Thinner horizontal padding on mobile so cards have room to breathe. */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DashboardShellInner>{children}</DashboardShellInner>
    </AuthProvider>
  );
}
