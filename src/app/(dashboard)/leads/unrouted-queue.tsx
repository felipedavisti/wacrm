'use client';

// ============================================================
// Fila de leads sem empresa (spec 009, US4).
//
// É a rede que impede a perda quando a agência cria um formulário
// novo e ninguém avisa: o lead entra, fica visível aqui, e o
// operador resolve dizendo de quem é a origem — o que cadastra o
// de-para E libera de uma vez todos os leads parados daquela chave.
//
// Agrupado por origem de propósito: a decisão é "de quem é este
// formulário", não "para onde vai este lead". 23 leads parados do
// mesmo formulário são UMA decisão.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { Inbox, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface UnroutedGroup {
  kind: 'form_id' | 'filial';
  value: string;
  source: string;
  count: number;
  first_seen: string;
  last_seen: string;
}

interface AccountOption {
  id: string;
  name: string;
}

export function UnroutedQueue({ onResolved }: { onResolved: () => void }) {
  const t = useTranslations('Leads');
  const [groups, setGroups] = useState<UnroutedGroup[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [unkeyed, setUnkeyed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/leads/unrouted', { cache: 'no-store' });
      if (!res.ok) return; // 403 para não-owner: some silenciosamente
      const data = (await res.json()) as {
        groups: UnroutedGroup[];
        accounts: AccountOption[];
        unkeyed: number;
      };
      setGroups(data.groups);
      setAccounts(data.accounts);
      setUnkeyed(data.unkeyed);
    } catch (err) {
      console.error('[UnroutedQueue] load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function resolve(g: UnroutedGroup) {
    const key = `${g.kind}:${g.value}`;
    const accountId = choice[key];
    if (!accountId) return;
    setBusy(key);
    try {
      const res = await fetch('/api/leads/unrouted/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: g.kind,
          value: g.value,
          account_id: accountId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 409 = origem já pertence a outra empresa; a mensagem do
        // servidor explica o que fazer.
        toast.error(data.error || t('unroutedToastFailed'));
        return;
      }
      if (data.adopted > 0) {
        toast.success(t('unroutedToast', { count: data.adopted }));
      } else {
        toast.success(t('unroutedToastRegistered'));
      }
      await load();
      onResolved();
    } catch (err) {
      console.error('[UnroutedQueue] resolve error:', err);
      toast.error(t('unroutedToastFailed'));
    } finally {
      setBusy(null);
    }
  }

  if (loading) return null;
  // Nada parado → a fila não ocupa espaço na tela.
  if (groups.length === 0 && unkeyed === 0) return null;

  return (
    <div>
      <h2 className="text-sm font-semibold text-foreground">
        {t('unroutedTitle')}
      </h2>
      <p className="mb-2 mt-0.5 text-xs text-muted-foreground">
        {t('unroutedDesc')}
      </p>

      <Card className="border-amber-500/30">
        <CardContent className="p-0">
          {groups.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <Inbox className="size-5 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                {t('unroutedEmpty')}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {groups.map((g) => {
                const key = `${g.kind}:${g.value}`;
                return (
                  <li
                    key={key}
                    className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                          {g.kind === 'form_id'
                            ? t('unroutedKindFormId')
                            : t('unroutedKindFilial')}
                        </span>
                        <span className="truncate font-mono text-sm text-foreground">
                          {g.value}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-amber-500">
                        {t('unroutedCount', { count: g.count })} ·{' '}
                        {t('unroutedSince', {
                          date: new Date(g.first_seen).toLocaleDateString(),
                        })}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <select
                        value={choice[key] ?? ''}
                        onChange={(e) =>
                          setChoice((prev) => ({
                            ...prev,
                            [key]: e.target.value,
                          }))
                        }
                        aria-label={t('unroutedAssign')}
                        className="h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
                      >
                        <option value="">{t('unroutedChoose')}</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        disabled={!choice[key] || busy === key}
                        onClick={() => resolve(g)}
                      >
                        {busy === key ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          t('unroutedConfirm')
                        )}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {unkeyed > 0 && (
            <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
              {t('unkeyed', { count: unkeyed })}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
