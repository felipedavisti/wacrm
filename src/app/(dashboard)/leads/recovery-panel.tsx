'use client';

// ============================================================
// Recuperação ativa (spec 011, US1).
//
// "A Meta tem algum lead que nunca chegou aqui?" — a pergunta que
// dá segurança para homologar. Confere primeiro, importa depois:
// ninguém deveria clicar "importar" sem antes ver quantos são e de
// qual formulário.
//
// Fica recolhido por padrão. É ferramenta de contingência, não de
// rotina; ocupar o topo do painel todo dia tiraria espaço do que
// realmente exige ação.
// ============================================================

import { useState } from 'react';
import { ChevronDown, LifeBuoy, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface FormResult {
  form_id: string;
  label: string | null;
  found: number;
  missing: number;
  imported: number;
  error: string | null;
}

interface RecoveryResponse {
  mode: 'scan' | 'import';
  days: number;
  totals: { forms: number; found: number; missing: number; imported: number };
  forms: FormResult[];
}

export function RecoveryPanel({ onImported }: { onImported: () => void }) {
  const t = useTranslations('Leads');
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState('7');
  const [busy, setBusy] = useState<'scan' | 'import' | null>(null);
  const [result, setResult] = useState<RecoveryResponse | null>(null);

  async function run(mode: 'scan' | 'import') {
    setBusy(mode);
    try {
      const res = await fetch('/api/leads/recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, days: Number(days) }),
      });
      if (!res.ok) {
        toast.error(t('recoveryFailed'));
        return;
      }
      const data = (await res.json()) as RecoveryResponse;
      setResult(data);

      if (mode === 'import') {
        toast.success(t('recoveryImported', { count: data.totals.imported }));
        onImported();
      } else if (data.totals.missing === 0) {
        toast.success(t('recoveryNothingMissing'));
      }
    } catch (err) {
      console.error('[RecoveryPanel] error:', err);
      toast.error(t('recoveryFailed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardContent className="p-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 px-4 py-3 text-left"
        >
          <LifeBuoy className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <span className="text-sm font-medium text-foreground">
              {t('recoveryTitle')}
            </span>
            <p className="text-xs text-muted-foreground">{t('recoveryDesc')}</p>
          </div>
          <ChevronDown
            className={`size-4 shrink-0 text-muted-foreground transition-transform ${
              open ? 'rotate-180' : ''
            }`}
            aria-hidden
          />
        </button>

        {open && (
          <div className="space-y-3 border-t border-border px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
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
                size="sm"
                variant="outline"
                className="border-border"
                disabled={busy !== null}
                onClick={() => run('scan')}
              >
                {busy === 'scan' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  t('recoveryScan')
                )}
              </Button>

              {/* O botão de importar só existe DEPOIS de conferir, e
                  só quando há o que importar. */}
              {result && result.totals.missing > 0 && (
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => run('import')}
                >
                  {busy === 'import' ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    t('recoveryImport', { count: result.totals.missing })
                  )}
                </Button>
              )}
            </div>

            {result && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  {t('recoverySummary', {
                    forms: result.totals.forms,
                    found: result.totals.found,
                    missing: result.totals.missing,
                  })}
                </p>

                {result.forms.length === 0 && (
                  // Sem formulário cadastrado não há o que conferir —
                  // e o operador precisa saber que a causa é essa, e
                  // não "não faltou nada".
                  <p className="text-xs text-amber-500">
                    {t('recoveryNoForms')}
                  </p>
                )}

                <ul className="space-y-1">
                  {result.forms.map((f) => (
                    <li
                      key={f.form_id}
                      className="flex flex-wrap items-center gap-x-2 text-xs"
                    >
                      <span className="font-mono text-muted-foreground">
                        {f.label ?? f.form_id}
                      </span>
                      {f.error ? (
                        <span className="text-red-400">{f.error}</span>
                      ) : (
                        <span
                          className={
                            f.missing > 0
                              ? 'text-amber-500'
                              : 'text-muted-foreground'
                          }
                        >
                          {t('recoveryFormLine', {
                            found: f.found,
                            missing: f.missing,
                          })}
                          {f.imported > 0
                            ? ` · ${t('recoveryFormImported', { count: f.imported })}`
                            : ''}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
