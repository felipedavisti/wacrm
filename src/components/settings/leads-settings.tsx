'use client';

// ============================================================
// Settings → Leads (spec 009).
//
// Onde a empresa declara O QUE É DELA na captação: os formulários de
// anúncio da Meta e as filiais que o site envia. É o irmão do
// cadastro de números do WhatsApp — mesma ideia, outro canal.
//
// Sem esta tela, cadastrar uma origem exigiria SQL. Com ela, quando
// o marketing cria um formulário novo, o admin da empresa cola o id
// e o lead já cai no funil certo.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Magnet, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RequireRole } from '@/components/auth/require-role';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';

import { SettingsPanelHead } from './settings-panel-head';

interface LeadSource {
  id: string;
  kind: 'form_id' | 'filial';
  value: string;
  label: string | null;
  active: boolean;
  meta_app_id: string | null;
  pipeline_id: string | null;
  stage_id: string | null;
}

interface MetaApp {
  id: string;
  app_id: string;
  has_leads_token: boolean;
}

interface PipelineOption {
  id: string;
  name: string;
}

export function LeadsSettings() {
  const t = useTranslations('Settings.leads');
  const { canManageMembers } = useAuth();

  const [sources, setSources] = useState<LeadSource[]>([]);
  const [apps, setApps] = useState<MetaApp[]>([]);
  const [pipelines, setPipelines] = useState<PipelineOption[]>([]);
  const [loading, setLoading] = useState(true);

  // Formulário de nova origem
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<'form_id' | 'filial'>('form_id');
  const [value, setValue] = useState('');
  const [label, setLabel] = useState('');
  const [metaAppId, setMetaAppId] = useState('');
  const [pipelineId, setPipelineId] = useState('');
  const [saving, setSaving] = useState(false);

  // Token por App
  const [tokenDrafts, setTokenDrafts] = useState<Record<string, string>>({});
  const [savingToken, setSavingToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const supabase = createClient();
      const [sres, ares, pres] = await Promise.all([
        fetch('/api/account/lead-sources', { cache: 'no-store' }),
        canManageMembers
          ? fetch('/api/account/meta-apps', { cache: 'no-store' })
          : Promise.resolve(null),
        // Funis vêm direto pelo cliente RLS — já escopados à empresa ativa.
        supabase.from('pipelines').select('id, name').order('created_at'),
      ]);

      if (!sres.ok) {
        toast.error(t('toastLoadFailed'));
        return;
      }
      setSources(((await sres.json()) as { sources: LeadSource[] }).sources);

      if (ares?.ok) {
        setApps(((await ares.json()) as { apps: MetaApp[] }).apps);
      }
      setPipelines((pres.data ?? []) as PipelineOption[]);
    } catch (err) {
      console.error('[LeadsSettings] load error:', err);
      toast.error(t('toastLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [canManageMembers, t]);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setAdding(false);
    setKind('form_id');
    setValue('');
    setLabel('');
    setMetaAppId('');
    setPipelineId('');
  }

  async function handleCreate() {
    if (!value.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/account/lead-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          value: value.trim(),
          label: label.trim() || undefined,
          meta_app_id: metaAppId || undefined,
          pipeline_id: pipelineId || undefined,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        // 409 = o UNIQUE global; a mensagem do servidor já explica.
        toast.error(payload.error || t('toastFailed'));
        return;
      }
      toast.success(t('toastCreated'));
      resetForm();
      await load();
    } catch (err) {
      console.error('[LeadsSettings] create error:', err);
      toast.error(t('toastFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(source: LeadSource) {
    if (!window.confirm(t('removeConfirm'))) return;
    try {
      const res = await fetch(`/api/account/lead-sources/${source.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        toast.error(t('toastFailed'));
        return;
      }
      toast.success(t('toastRemoved'));
      setSources((prev) => prev.filter((s) => s.id !== source.id));
    } catch (err) {
      console.error('[LeadsSettings] remove error:', err);
      toast.error(t('toastFailed'));
    }
  }

  async function handleSaveToken(app: MetaApp) {
    const draft = tokenDrafts[app.id]?.trim();
    if (!draft) return;
    setSavingToken(app.id);
    try {
      const res = await fetch('/api/account/meta-apps', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: app.id, leads_access_token: draft }),
      });
      if (!res.ok) {
        toast.error(t('toastFailed'));
        return;
      }
      toast.success(t('toastTokenSaved'));
      setTokenDrafts((prev) => ({ ...prev, [app.id]: '' }));
      setApps((prev) =>
        prev.map((a) => (a.id === app.id ? { ...a, has_leads_token: true } : a)),
      );
    } catch (err) {
      console.error('[LeadsSettings] token error:', err);
      toast.error(t('toastFailed'));
    } finally {
      setSavingToken(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <section className="animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
        action={
          <RequireRole min="admin">
            <Button onClick={() => setAdding(true)} disabled={adding}>
              <Plus className="size-4" />
              {t('add')}
            </Button>
          </RequireRole>
        }
      />

      {/* Formulário de nova origem */}
      {adding && (
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t('kind')}</Label>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as 'form_id' | 'filial')}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
                >
                  <option value="form_id">{t('kindFormId')}</option>
                  <option value="filial">{t('kindFilial')}</option>
                </select>
              </div>

              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t('value')}</Label>
                <Input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={
                    kind === 'form_id' ? '1009161721845263' : 'São Luís'
                  }
                  className="border-border bg-muted text-foreground"
                />
                <p className="text-xs text-muted-foreground">
                  {kind === 'form_id'
                    ? t('valueHintFormId')
                    : t('valueHintFilial')}
                </p>
              </div>

              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t('label')}</Label>
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="border-border bg-muted text-foreground"
                />
                <p className="text-xs text-muted-foreground">{t('labelHint')}</p>
              </div>

              {/* App só faz sentido para formulário da Meta */}
              {kind === 'form_id' && (
                <div className="grid gap-2">
                  <Label className="text-muted-foreground">{t('metaApp')}</Label>
                  <select
                    value={metaAppId}
                    onChange={(e) => setMetaAppId(e.target.value)}
                    className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
                  >
                    <option value="">{t('metaAppNone')}</option>
                    {apps.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.app_id}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    {t('metaAppHint')}
                  </p>
                </div>
              )}

              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t('pipeline')}</Label>
                <select
                  value={pipelineId}
                  onChange={(e) => setPipelineId(e.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
                >
                  <option value="">{t('pipelineDefault')}</option>
                  {pipelines.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={resetForm}
                className="border-border text-muted-foreground hover:bg-muted"
              >
                {t('cancel')}
              </Button>
              <Button onClick={handleCreate} disabled={saving || !value.trim()}>
                {saving ? t('saving') : t('save')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Origens cadastradas */}
      <Card>
        <CardContent className="p-0">
          {sources.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Magnet className="size-6 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">{t('empty')}</p>
              <p className="mt-1 max-w-md text-xs text-muted-foreground">
                {t('emptyHint')}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {sources.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-4 px-4 py-3"
                >
                  <span className="inline-flex shrink-0 items-center rounded-md border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {s.kind === 'form_id' ? t('kindFormId') : t('kindFilial')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-sm text-foreground">
                      {s.value}
                    </p>
                    {s.label && (
                      <p className="truncate text-xs text-muted-foreground">
                        {s.label}
                      </p>
                    )}
                  </div>
                  {canManageMembers && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRemove(s)}
                      className="border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:text-red-200"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Token de leads por App — admin+ */}
      <RequireRole min="admin">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {t('tokenTitle')}
          </h3>
          <p className="mb-3 mt-1 text-xs text-muted-foreground">
            {t('tokenDesc')}
          </p>
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {apps.map((a) => (
                  <li key={a.id} className="space-y-2 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-foreground">
                        {a.app_id}
                      </span>
                      <span
                        className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                          a.has_leads_token
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
                            : 'border-amber-500/30 bg-amber-500/10 text-amber-500'
                        }`}
                      >
                        {a.has_leads_token ? t('tokenSet') : t('tokenMissing')}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        type="password"
                        value={tokenDrafts[a.id] ?? ''}
                        onChange={(e) =>
                          setTokenDrafts((prev) => ({
                            ...prev,
                            [a.id]: e.target.value,
                          }))
                        }
                        placeholder={t('tokenPlaceholder')}
                        className="border-border bg-muted text-foreground"
                      />
                      <Button
                        onClick={() => handleSaveToken(a)}
                        disabled={
                          savingToken === a.id || !tokenDrafts[a.id]?.trim()
                        }
                      >
                        {savingToken === a.id ? t('saving') : t('tokenSave')}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </RequireRole>
    </section>
  );
}
