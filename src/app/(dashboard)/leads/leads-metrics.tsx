'use client';

// ============================================================
// Indicadores do painel de leads (spec 009, US6/FR-030).
//
// Responde a pergunta que o operador faz ao abrir a tela — "está
// tudo entrando e saindo?" — antes de ele precisar ler a lista.
//
// O cartão de falhas só ganha destaque vermelho quando existe
// falha: um "0" gritando em vermelho todo dia treina o olho a
// ignorar a cor, e aí ela não serve quando importa.
// ============================================================

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Inbox } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { MetricCard } from '@/components/dashboard/metric-card';

interface Metrics {
  total: number;
  sent: number;
  partially_sent: number;
  pending: number;
  failed: number;
  failed_pct: number;
  by_source: { site: number; meta_form: number; meta_ctwa: number };
}

const SOURCE_KEY = {
  site: 'sourceSite',
  meta_form: 'sourceMetaForm',
  meta_ctwa: 'sourceMetaCtwa',
} as const;

export function LeadsMetrics({
  days,
  refreshKey,
}: {
  days: string;
  refreshKey: number;
}) {
  const t = useTranslations('Leads');
  const [data, setData] = useState<Metrics | null>(null);

  // `cancelled` descarta a resposta de uma busca que ficou obsoleta:
  // trocar o período rápido dispara duas chamadas, e sem isso a mais
  // lenta (a antiga) poderia chegar por último e sobrescrever a nova.
  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const res = await fetch(`/api/leads/metrics?days=${days}`, {
          cache: 'no-store',
        });
        if (!res.ok) return; // a lista abaixo já sinaliza o erro
        const json = (await res.json()) as Metrics;
        if (!cancelled) setData(json);
      } catch (err) {
        console.error('[LeadsMetrics] load error:', err);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [days, refreshKey]);

  if (!data) return null;

  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title={t('metricTotal')}
          value={String(data.total)}
          icon={Inbox}
          subtitle={t('metricPeriod')}
        />
        <MetricCard
          title={t('metricSent')}
          value={String(data.sent + data.partially_sent)}
          icon={CheckCircle2}
          subtitle={
            data.partially_sent > 0
              ? t('metricPartial', { count: data.partially_sent })
              : undefined
          }
        />
        <MetricCard
          title={t('metricPending')}
          value={String(data.pending)}
          icon={Clock}
          subtitle={data.pending > 0 ? t('metricPendingHint') : undefined}
        />
        <MetricCard
          title={t('metricFailed')}
          value={String(data.failed)}
          icon={AlertTriangle}
          subtitle={
            data.failed > 0
              ? t('metricFailedPct', { pct: data.failed_pct })
              : t('metricNoFailures')
          }
        />
      </div>

      {/* Volume por origem (FR-030). Em linha, não em mais três
          cartões: é um detalhamento do total acima, não um quarto
          indicador de mesma importância. */}
      {data.total > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground">
          {(Object.keys(SOURCE_KEY) as (keyof typeof SOURCE_KEY)[]).map((s) => (
            <span key={s}>
              {t(SOURCE_KEY[s])}{' '}
              <span className="font-medium tabular-nums text-foreground">
                {data.by_source[s] ?? 0}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
