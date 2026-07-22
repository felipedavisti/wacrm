'use client';

// ============================================================
// /leads — Operação de leads (spec 009, US3).
//
// O coração do valor da spec: transformar falha silenciosa em falha
// VISÍVEL e RECUPERÁVEL. Lista tudo que chegou, mostra o payload
// bruto e o erro de cada tentativa, e reenvia — individual ou "todas
// as falhas do filtro" (num incidente ninguém clica 50 vezes).
//
// Acesso: owner. O gate real está em `requireRole('owner')` nas
// rotas; aqui a página só evita mostrar uma tela quebrada a quem
// receberia 403.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Loader2,
  MessageSquare,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/hooks/use-auth';
import type { CanonicalLead } from '@/lib/leads/canonical';

import { CtwaGaps } from './ctwa-gaps';
import { LeadDetailSheet } from './lead-detail-sheet';
import { LeadsMetrics } from './leads-metrics';
import { UnroutedQueue } from './unrouted-queue';

export interface LeadRow {
  id: string;
  source: 'site' | 'meta_form' | 'meta_ctwa';
  medium: string | null;
  canonical: CanonicalLead;
  routing_status: 'pending' | 'resolved';
  overall_status: 'pending' | 'sent' | 'partially_sent' | 'failed';
  contact_id: string | null;
  deal_id: string | null;
  /** Só CTWA: a conversa que originou o lead (migration 519). */
  conversation_id: string | null;
  created_at: string;
}

const STATUS_CLASS: Record<LeadRow['overall_status'], string> = {
  pending: 'border-amber-500/30 bg-amber-500/10 text-amber-500',
  sent: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500',
  partially_sent: 'border-sky-500/30 bg-sky-500/10 text-sky-500',
  failed: 'border-red-500/30 bg-red-500/10 text-red-400',
};

const STATUS_KEY: Record<LeadRow['overall_status'], string> = {
  pending: 'statusPending',
  sent: 'statusSent',
  partially_sent: 'statusPartiallySent',
  failed: 'statusFailed',
};

const SOURCE_KEY: Record<LeadRow['source'], string> = {
  site: 'sourceSite',
  meta_form: 'sourceMetaForm',
  meta_ctwa: 'sourceMetaCtwa',
};

export default function LeadsPage() {
  const t = useTranslations('Leads');
  const { accountRole, profileLoading } = useAuth();

  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState('');
  const [status, setStatus] = useState('');
  const [days, setDays] = useState('30');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [openLead, setOpenLead] = useState<LeadRow | null>(null);
  // Incrementado por qualquer ação que mude os números (reenvio,
  // vínculo de origem, refresh manual). Recarrega os indicadores
  // junto com a lista — sem isso o topo mostraria "3 falhas" logo
  // depois de você reenviar as 3.
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ days });
      if (source) params.set('source', source);
      if (status) params.set('status', status);

      const res = await fetch(`/api/leads?${params}`, { cache: 'no-store' });
      if (!res.ok) {
        toast.error(t('toastLoadFailed'));
        return;
      }
      const data = (await res.json()) as { leads: LeadRow[]; total: number };
      setLeads(data.leads);
      setTotal(data.total);
      setSelected(new Set());
    } catch (err) {
      console.error('[LeadsPage] load error:', err);
      toast.error(t('toastLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [source, status, days, t]);

  useEffect(() => {
    if (accountRole === 'owner') void load();
  }, [load, accountRole]);

  // Lista + indicadores. Usado pelas ações; o carregamento inicial
  // fica com `load`/o efeito próprio de cada componente.
  const refresh = useCallback(async () => {
    setTick((t) => t + 1);
    await load();
  }, [load]);

  const failedCount = useMemo(
    () => leads.filter((l) => l.overall_status === 'failed').length,
    [leads],
  );

  async function reprocess(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch('/api/leads/reprocess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        toast.error(t('toastFailed'));
        return;
      }
      const { requeued } = (await res.json()) as { requeued: number };
      if (requeued === 0) toast.info(t('toastNothingToRequeue'));
      else toast.success(t('toastRequeued', { count: requeued }));
      await refresh();
    } catch (err) {
      console.error('[LeadsPage] reprocess error:', err);
      toast.error(t('toastFailed'));
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Gate cosmético — a autorização real vive nas rotas.
  if (!profileLoading && accountRole !== 'owner') {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertTriangle className="size-7 text-muted-foreground" />
        <p className="mt-3 max-w-sm text-sm text-muted-foreground">
          {t('ownerOnly')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {t('title')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
      </div>

      {/* Leads órfãos primeiro: são os que ninguém está trabalhando
          e que somem de qualquer filtro por empresa (FR-022). */}
      <UnroutedQueue onResolved={refresh} />

      {/* Conversa de anúncio sem lead: falha que parece sucesso. */}
      <CtwaGaps days={days} refreshKey={tick} />

      {/* Indicadores do período selecionado (FR-030). */}
      <LeadsMetrics days={days} refreshKey={tick} />

      {/* Filtros combináveis (FR-027) */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          aria-label={t('filterSource')}
          className="h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
        >
          <option value="">{t('allSources')}</option>
          <option value="site">{t('sourceSite')}</option>
          <option value="meta_form">{t('sourceMetaForm')}</option>
          <option value="meta_ctwa">{t('sourceMetaCtwa')}</option>
        </select>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label={t('filterStatus')}
          className="h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
        >
          <option value="">{t('allStatuses')}</option>
          <option value="pending">{t('statusPending')}</option>
          <option value="sent">{t('statusSent')}</option>
          <option value="failed">{t('statusFailed')}</option>
        </select>

        <select
          value={days}
          onChange={(e) => setDays(e.target.value)}
          aria-label={t('filterPeriod')}
          className="h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
        >
          <option value="1">{t('days1')}</option>
          <option value="7">{t('days7')}</option>
          <option value="30">{t('days30')}</option>
          <option value="90">{t('days90')}</option>
        </select>

        <Button
          variant="outline"
          size="sm"
          onClick={() => refresh()}
          disabled={loading}
          className="border-border"
        >
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>

        <span className="ml-auto text-xs text-muted-foreground">
          {t('total', { count: total })}
        </span>
      </div>

      {/* Ações de reenvio. "Todas as falhas do filtro" resolve o
          incidente: a seleção acontece no servidor, então cobre além
          da página visível (FR-028/SC-003). */}
      {(selected.size > 0 || failedCount > 0) && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
          {selected.size > 0 && (
            <>
              <span className="text-xs text-muted-foreground">
                {t('selected', { count: selected.size })}
              </span>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => reprocess({ ids: [...selected] })}
              >
                {busy ? t('reprocessing') : t('reprocess')}
              </Button>
            </>
          )}
          {failedCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              className="border-border"
              onClick={() =>
                reprocess({
                  all_failed: true,
                  source: source || undefined,
                  days: Number(days),
                })
              }
            >
              {t('reprocessAllFailed')}
            </Button>
          )}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : leads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-sm text-muted-foreground">{t('empty')}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('emptyHint')}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {leads.map((lead) => {
                const c = lead.canonical?.contact ?? {};
                const who = c.name || c.phone || c.email || '—';
                return (
                  <li
                    key={lead.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <Checkbox
                      checked={selected.has(lead.id)}
                      onCheckedChange={() => toggle(lead.id)}
                      aria-label={who}
                    />
                    <button
                      type="button"
                      onClick={() => setOpenLead(lead)}
                      className="flex min-w-0 flex-1 flex-col items-start text-left"
                    >
                      <span className="truncate text-sm font-medium text-foreground">
                        {who}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {t(SOURCE_KEY[lead.source])}
                        {lead.canonical?.tracking?.campaign_name
                          ? ` · ${lead.canonical.tracking.campaign_name}`
                          : lead.canonical?.product
                            ? ` · ${lead.canonical.product}`
                            : ''}
                      </span>
                    </button>

                    {/* Atalho direto para a conversa (CTWA). Na
                        linha, não só no detalhe: "abrir a conversa"
                        é a ação mais frequente sobre um lead de
                        anúncio, e não deveria custar dois cliques. */}
                    {lead.conversation_id && (
                      <a
                        href={`/inbox?c=${lead.conversation_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={t('openConversation')}
                        aria-label={t('openConversation')}
                        className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <MessageSquare className="size-4" />
                      </a>
                    )}

                    {lead.routing_status === 'pending' && (
                      <span className="hidden shrink-0 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-500 sm:inline">
                        {t('routingPending')}
                      </span>
                    )}

                    <span
                      className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[lead.overall_status]}`}
                    >
                      {t(STATUS_KEY[lead.overall_status])}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <LeadDetailSheet
        lead={openLead}
        onOpenChange={(open) => !open && setOpenLead(null)}
        onReprocessed={refresh}
      />
    </div>
  );
}
