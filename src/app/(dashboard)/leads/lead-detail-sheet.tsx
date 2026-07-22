'use client';

// ============================================================
// Detalhe do lead (spec 009, FR-029).
//
// Mostra o que o operador precisa para ENTENDER a falha sem chamar
// alguém técnico: o payload bruto exatamente como chegou, e o erro
// de cada tentativa em linguagem compreensível. Daí o botão de
// reenviar fica a um clique do diagnóstico.
// ============================================================

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

import type { LeadRow } from './page';

interface RawEvent {
  id: number;
  payload: unknown;
  suppressed: boolean;
  received_at: string;
}

interface DeliveryJob {
  id: string;
  destination: string;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  external_ref: string | null;
}

interface Attempt {
  job_id: string;
  attempt_no: number;
  outcome: 'success' | 'error';
  error_class: string | null;
  reason: string | null;
  finished_at: string | null;
}

interface Detail {
  lead: LeadRow;
  events: RawEvent[];
  jobs: DeliveryJob[];
  attempts: Attempt[];
}

export function LeadDetailSheet({
  lead,
  onOpenChange,
  onReprocessed,
}: {
  lead: LeadRow | null;
  onOpenChange: (open: boolean) => void;
  onReprocessed: () => void;
}) {
  const t = useTranslations('Leads');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!lead) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/leads/${lead.id}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err) => console.error('[LeadDetail] load error:', err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lead]);

  async function handleReprocess() {
    if (!lead) return;
    setBusy(true);
    try {
      const res = await fetch('/api/leads/reprocess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [lead.id] }),
      });
      if (!res.ok) {
        toast.error(t('toastFailed'));
        return;
      }
      const { requeued } = (await res.json()) as { requeued: number };
      toast.success(t('toastRequeued', { count: requeued }));
      onReprocessed();
      onOpenChange(false);
    } catch (err) {
      console.error('[LeadDetail] reprocess error:', err);
      toast.error(t('toastFailed'));
    } finally {
      setBusy(false);
    }
  }

  const contact = lead?.canonical?.contact;

  return (
    <Sheet open={!!lead} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full bg-popover p-0 text-popover-foreground sm:max-w-xl"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-border/50 p-4">
            <SheetTitle className="text-popover-foreground">
              {t('detailTitle')}
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 space-y-5 overflow-y-auto p-4">
            {loading || !detail ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="size-6 animate-spin text-primary" />
              </div>
            ) : (
              <>
                {/* Contato + estado */}
                <section className="space-y-1">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('contact')}
                  </h4>
                  <p className="text-sm font-medium text-foreground">
                    {contact?.name || '—'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[contact?.phone, contact?.email].filter(Boolean).join(' · ')}
                  </p>
                  <p className="pt-1 text-xs text-muted-foreground">
                    {t('createdAt')}:{' '}
                    {new Date(detail.lead.created_at).toLocaleString()}
                  </p>
                  {detail.lead.deal_id ? (
                    <Link
                      href="/pipelines"
                      className="inline-block pt-1 text-xs text-primary hover:underline"
                    >
                      {t('openDeal')}
                    </Link>
                  ) : (
                    <p className="pt-1 text-xs text-amber-500">
                      {detail.lead.routing_status === 'pending'
                        ? t('routingPending')
                        : t('noDeal')}
                    </p>
                  )}

                  {/* Só o CTWA tem conversa. Abre em outra guia de
                      propósito: quem está triando leads não quer
                      perder a lista para ler uma conversa. */}
                  {detail.lead.conversation_id && (
                    <a
                      href={`/inbox?c=${detail.lead.conversation_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 pt-1 text-xs text-primary hover:underline"
                    >
                      <MessageSquare className="size-3.5" />
                      {t('openConversation')}
                    </a>
                  )}
                </section>

                {/* Tentativas de entrega — o "por que falhou" */}
                <section className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('attempts')}
                  </h4>
                  {detail.attempts.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {t('noAttempts')}
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {detail.attempts.map((a) => (
                        <li
                          key={`${a.job_id}-${a.attempt_no}`}
                          className="rounded-md border border-border bg-muted/40 px-3 py-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-foreground">
                              {t('attemptNo', { n: a.attempt_no })}
                            </span>
                            <span
                              className={`text-[11px] font-medium ${
                                a.outcome === 'success'
                                  ? 'text-emerald-500'
                                  : 'text-red-400'
                              }`}
                            >
                              {a.outcome === 'success'
                                ? t('attemptSuccess')
                                : t('attemptError')}
                            </span>
                          </div>
                          {a.reason && (
                            <p className="mt-1 break-words text-xs text-muted-foreground">
                              {a.reason}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {/* Payload bruto — a prova de que nada se perdeu */}
                <section className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('rawPayload')}
                  </h4>
                  {detail.events.map((ev) => (
                    <div key={ev.id} className="space-y-1">
                      {ev.suppressed && (
                        <p className="text-[11px] text-amber-500">
                          {t('rawSuppressed')}
                        </p>
                      )}
                      <pre className="max-h-64 overflow-auto rounded-md border border-border bg-muted/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
                        {JSON.stringify(ev.payload, null, 2)}
                      </pre>
                    </div>
                  ))}
                </section>
              </>
            )}
          </div>

          <div className="flex gap-2 border-t border-border/50 bg-popover/80 p-4">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1 border-border bg-transparent text-muted-foreground hover:bg-muted"
            >
              {t('close')}
            </Button>
            <Button
              onClick={handleReprocess}
              disabled={busy}
              className="flex-1"
            >
              {busy ? t('reprocessing') : t('reprocess')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
