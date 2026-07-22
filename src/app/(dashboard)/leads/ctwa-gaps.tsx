'use client';

// ============================================================
// Conversas de anúncio que NÃO viraram lead (spec 010).
//
// É a falha mais perigosa das três origens porque parece sucesso: a
// conversa está lá na inbox, o atendente responde normalmente, e o
// negócio simplesmente não existe no funil. Ninguém percebe até o
// fechamento do mês não bater com o investido em anúncio.
//
// Some da tela quando não há lacuna — mostrar "0 conversas sem lead"
// todo dia treina o olho a ignorar o bloco.
// ============================================================

import { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Card, CardContent } from '@/components/ui/card';

interface Gap {
  conversation_id: string;
  campaign_name: string | null;
  headline: string | null;
  created_at: string;
}

export function CtwaGaps({
  days,
  refreshKey,
}: {
  days: string;
  refreshKey: number;
}) {
  const t = useTranslations('Leads');
  const [gaps, setGaps] = useState<Gap[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const res = await fetch(`/api/leads/ctwa-gaps?days=${days}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const json = (await res.json()) as { gaps: Gap[] };
        if (!cancelled) setGaps(json.gaps ?? []);
      } catch (err) {
        console.error('[CtwaGaps] load error:', err);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [days, refreshKey]);

  if (gaps.length === 0) return null;

  return (
    <Card className="border-red-500/30">
      <CardContent className="p-0">
        <div className="flex items-start gap-2 border-b border-border px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-400" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {t('gapsTitle', { count: gaps.length })}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('gapsDesc')}
            </p>
          </div>
        </div>

        <ul className="divide-y divide-border">
          {gaps.slice(0, 10).map((g) => (
            <li
              key={g.conversation_id}
              className="flex items-center gap-3 px-4 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">
                  {g.campaign_name ?? g.headline ?? t('gapsUnknownCampaign')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(g.created_at).toLocaleString()}
                </p>
              </div>
              <a
                href={`/inbox?c=${g.conversation_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
              >
                {t('openConversation')}
                <ExternalLink className="size-3" />
              </a>
            </li>
          ))}
        </ul>

        {gaps.length > 10 && (
          <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            {t('gapsMore', { count: gaps.length - 10 })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
