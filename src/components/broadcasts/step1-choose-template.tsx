'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Loader2, FileText, ArrowRight, Phone } from 'lucide-react';
import { wabaLabelMap, templateWabaLabel } from '@/lib/whatsapp/number-name';
import { useTranslations } from 'next-intl';

const categoryColors: Record<string, string> = {
  Marketing: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  Utility: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  Authentication: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
};

interface Step1Props {
  selectedTemplate: MessageTemplate | null;
  onSelect: (template: MessageTemplate) => void;
  onNext: () => void;
  onBack: () => void;
}

export function Step1ChooseTemplate({ selectedTemplate, onSelect, onNext, onBack }: Step1Props) {
  const t = useTranslations('Broadcasts.wizard');
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // waba_id → friendly number name, to group templates by number/App
  // (spec 007) when the account has more than one.
  const [wabaLabels, setWabaLabels] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    async function fetchTemplates() {
      try {
        const supabase = createClient();
        // Only APPROVED templates can be sent via Meta — anything else
        // would 400 at broadcast time. Hide them rather than letting
        // the user pick a template that will fail.
        const { data, error: fetchError } = await supabase
          .from('message_templates')
          .select('*')
          .eq('status', 'APPROVED')
          .order('created_at', { ascending: false });

        if (fetchError) throw fetchError;
        setTemplates(data ?? []);

        const { data: cfgs } = await supabase
          .from('whatsapp_config')
          .select('waba_id, label, verified_name, display_phone_number, phone_number_id');
        if (cfgs) setWabaLabels(wabaLabelMap(cfgs));
      } catch (err) {
        setError(err instanceof Error ? err.message : t('chooseTemplate.errorLoad'));
      } finally {
        setLoading(false);
      }
    }

    fetchTemplates();
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  const renderCard = (template: MessageTemplate) => {
    const isSelected = selectedTemplate?.id === template.id;
    const catColor = categoryColors[template.category] ?? categoryColors.Utility;
    return (
      <button
        key={template.id}
        onClick={() => onSelect(template)}
        className={`flex flex-col gap-3 rounded-xl border p-4 text-left transition-all ${
          isSelected
            ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
            : 'border-border bg-card/50 hover:border-border hover:bg-card'
        }`}
      >
        <div className="flex items-start justify-between">
          <h3 className="text-sm font-medium text-foreground">{template.name}</h3>
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${catColor}`}
          >
            {template.category}
          </span>
        </div>
        <p className="line-clamp-3 text-xs text-muted-foreground">{template.body_text}</p>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{template.language ?? 'en_US'}</span>
        </div>
      </button>
    );
  };

  // Group templates by the number/WABA they belong to (spec 007), so the
  // list isn't a mixed pile when the account has several numbers. Numbered
  // WABAs first; templates without a WABA (legacy/global) go in a last group.
  const groups = (() => {
    const byWaba = new Map<string, MessageTemplate[]>();
    const noWaba: MessageTemplate[] = [];
    for (const tpl of templates) {
      if (tpl.waba_id) {
        const arr = byWaba.get(tpl.waba_id) ?? [];
        arr.push(tpl);
        byWaba.set(tpl.waba_id, arr);
      } else {
        noWaba.push(tpl);
      }
    }
    const out = [...byWaba.entries()].map(([waba, tpls]) => ({
      key: waba,
      label: templateWabaLabel(waba, wabaLabels) ?? waba,
      templates: tpls,
    }));
    if (noWaba.length)
      out.push({ key: '__none__', label: t('chooseTemplate.noNumber'), templates: noWaba });
    return out;
  })();

  const gridClass = 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('chooseTemplate.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('chooseTemplate.subtitle')}
        </p>
      </div>

      {templates.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-border bg-card/50">
          <FileText className="mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t('chooseTemplate.noTemplates')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('chooseTemplate.createFirst')}</p>
        </div>
      ) : wabaLabels.size >= 2 ? (
        // Grouped by number/WABA (spec 007) — one section per number.
        <div className="space-y-6">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Phone className="size-3 shrink-0" />
                {g.label}
              </div>
              <div className={gridClass}>{g.templates.map(renderCard)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className={gridClass}>{templates.map(renderCard)}</div>
      )}

      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button variant="outline" onClick={onBack} className="border-border text-muted-foreground">
          {t('back')}
        </Button>
        <Button
          onClick={onNext}
          disabled={!selectedTemplate}
          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {t('next')}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
