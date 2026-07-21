"use client";

// ============================================================
// "Origem do lead" — a certidão de nascimento do negócio.
//
// Mostra de onde a oportunidade veio: os campos que antes viviam no
// Odoo como `ink_new_*` e hoje moram em `deals.tracking` (spec 009,
// migration 516).
//
// Escolha de leitura: os NOMES na frente (campanha, conjunto,
// criativo) e os IDs recolhidos num bloco secundário. Quem trabalha
// o funil raciocina por "qual anúncio trouxe esse lead", não por
// `120249037631560167` — mas o ID precisa estar acessível para
// conferência com o gerenciador da Meta.
//
// Dois usos: `TrackingBadge` (selo compacto no card do funil) e
// `DealTrackingPanel` (bloco no detalhe do negócio).
// ============================================================

import { useState } from "react";
import { ChevronDown, Globe, Megaphone, MessageCircle } from "lucide-react";
import { useTranslations } from "next-intl";

import type { DealTracking } from "@/types";

/** Um negócio criado à mão tem `{}` — não há origem para mostrar. */
export function hasTracking(tracking?: DealTracking | null): boolean {
  return !!tracking && Object.values(tracking).some((v) => v != null && v !== "");
}

type SourceKey = NonNullable<DealTracking["source"]>;

const SOURCE_META: Record<
  SourceKey,
  { icon: typeof Globe; labelKey: string; className: string }
> = {
  site: {
    icon: Globe,
    labelKey: "sourceSite",
    className: "border-sky-500/30 bg-sky-500/10 text-sky-500",
  },
  meta_form: {
    icon: Megaphone,
    labelKey: "sourceMetaForm",
    className: "border-violet-500/30 bg-violet-500/10 text-violet-500",
  },
  meta_ctwa: {
    icon: MessageCircle,
    labelKey: "sourceMetaCtwa",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
  },
};

/** Selo compacto de origem — usado no card do funil. */
export function TrackingBadge({ tracking }: { tracking?: DealTracking | null }) {
  const t = useTranslations("Pipelines.tracking");
  const source = tracking?.source;
  if (!source || !SOURCE_META[source]) return null;

  const meta = SOURCE_META[source];
  const Icon = meta.icon;
  // O título dá o contexto completo sem ocupar espaço no card.
  const detail = tracking?.campaign_name ?? tracking?.product ?? undefined;

  return (
    <span
      title={detail ? `${t(meta.labelKey)} · ${detail}` : t(meta.labelKey)}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${meta.className}`}
    >
      <Icon className="h-3 w-3" />
      {t(meta.labelKey)}
    </span>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right text-xs font-medium text-foreground">
        {value}
      </dd>
    </div>
  );
}

/** Bloco "Origem do lead" — usado no detalhe do negócio. */
export function DealTrackingPanel({
  tracking,
}: {
  tracking?: DealTracking | null;
}) {
  const t = useTranslations("Pipelines.tracking");
  const [showIds, setShowIds] = useState(false);

  if (!hasTracking(tracking)) return null;
  const tr = tracking as DealTracking;

  const hasIds =
    tr.campaign_id || tr.adset_id || tr.ad_id || tr.form_id || tr.leadgen_id;

  return (
    <section className="rounded-lg border border-border bg-muted/40 p-3">
      <div className="mb-2 flex items-center gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("title")}
        </h4>
        <TrackingBadge tracking={tr} />
      </div>

      <dl className="divide-y divide-border/60">
        <Row label={t("campaign")} value={tr.campaign_name} />
        <Row label={t("adset")} value={tr.adset_name} />
        <Row label={t("ad")} value={tr.ad_name} />
        <Row label={t("form")} value={tr.form_name} />
        <Row label={t("product")} value={tr.product} />
        <Row label={t("medium")} value={tr.medium} />
      </dl>

      {hasIds && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowIds((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDown
              className={`h-3 w-3 transition-transform ${showIds ? "rotate-180" : ""}`}
            />
            {t("technicalIds")}
          </button>
          {showIds && (
            <dl className="mt-1 divide-y divide-border/60">
              <Row label={t("campaignId")} value={tr.campaign_id} />
              <Row label={t("adsetId")} value={tr.adset_id} />
              <Row label={t("adId")} value={tr.ad_id} />
              <Row label={t("formId")} value={tr.form_id} />
              <Row label={t("leadId")} value={tr.leadgen_id} />
            </dl>
          )}
        </div>
      )}
    </section>
  );
}
