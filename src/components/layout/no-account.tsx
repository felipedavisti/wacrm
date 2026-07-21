"use client";

// Neutral "no company" screen (spec 008, FR-023).
//
// Shown when an authenticated user belongs to NO account: a fresh
// signup without an invite, or someone removed from every company.
// Deliberately a dead end with a single exit (sign out): no data of
// any company is reachable from here, and there is NO "create
// company" affordance — companies are provisioned by IT only
// (FR-019/FR-021).

import { Building2, LogOut } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

export function NoAccountScreen() {
  const t = useTranslations("NoAccount");
  const { signOut } = useAuth();

  return (
    <div className="flex h-screen items-center justify-center bg-background p-6">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-muted">
          <Building2 className="size-7 text-muted-foreground" />
        </div>
        <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
        <Button variant="outline" onClick={signOut} className="mt-2">
          <LogOut className="size-4" />
          {t("signOut")}
        </Button>
      </div>
    </div>
  );
}
