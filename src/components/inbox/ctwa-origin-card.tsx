"use client";

// ============================================================
// De qual anúncio veio esta conversa (spec 010).
//
// O dado da campanha já existia — mas só no funil. Quem está
// atendendo NÃO abre o funil no meio de uma conversa; ele responde
// no WhatsApp. Saber que a pessoa clicou em "Receba Informações a
// Respeito" da campanha de APH muda a primeira frase do atendente.
//
// Lê direto pelo client do Supabase: o RLS de `ctwa_referrals` já
// libera SELECT para membro da empresa ativa, então uma rota de API
// só somaria uma camada sem somar segurança.
//
// Só aparece em conversa de anúncio. Conversa comum não ganha um
// bloco vazio dizendo "sem campanha".
// ============================================================

import { useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
import { useTranslations } from "next-intl";

import { createClient } from "@/lib/supabase/client";

interface CtwaOrigin {
  campaign_name: string | null;
  adset_name: string | null;
  ad_name: string | null;
  headline: string | null;
  source_id: string | null;
  created_at: string;
}

export function CtwaOriginCard({
  conversationId,
}: {
  conversationId: string | null;
}) {
  const t = useTranslations("Inbox.ctwa");
  // Guardado JUNTO com a conversa a que pertence. Assim trocar de
  // conversa já mostra o vazio certo, em vez de piscar o anúncio da
  // conversa anterior enquanto a nova carrega.
  const [state, setState] = useState<{
    id: string;
    origin: CtwaOrigin | null;
  } | null>(null);

  const origin = state && state.id === conversationId ? state.origin : null;

  useEffect(() => {
    let cancelled = false;
    if (!conversationId) return;
    const id = conversationId;

    async function run() {
      const { data, error } = await createClient()
        .from("ctwa_referrals")
        .select(
          "campaign_name, adset_name, ad_name, headline, source_id, created_at",
        )
        // A conversa pode ter mais de um referral (o cliente clicou em
        // dois anúncios). O mais recente é o que trouxe a pessoa de
        // volta — é o contexto útil para quem vai responder agora.
        .eq("conversation_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        console.error("[CtwaOriginCard] load error:", error);
        return;
      }
      setState({ id, origin: (data as CtwaOrigin | null) ?? null });
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  if (!origin) return null;

  return (
    // A margem vive aqui (e não num wrapper no sidebar) porque o
    // componente devolve null em conversa comum — um wrapper deixaria
    // um espaço fantasma.
    <div className="mb-4 rounded-lg border border-primary/25 bg-primary/5 p-3">
      <div className="flex items-center gap-1.5">
        <Megaphone className="size-3.5 text-primary" />
        <h4 className="text-xs font-semibold uppercase tracking-wide text-primary">
          {t("title")}
        </h4>
      </div>

      {/* O título do anúncio primeiro: é a frase que a pessoa leu
          antes de clicar, e o que ela espera que você saiba. */}
      {origin.headline && (
        <p className="mt-2 text-sm font-medium text-foreground">
          &ldquo;{origin.headline}&rdquo;
        </p>
      )}

      <dl className="mt-2 space-y-1 text-xs">
        {origin.campaign_name ? (
          <Row label={t("campaign")} value={origin.campaign_name} />
        ) : (
          // Sem nome de campanha o bloco continua útil (o anúncio
          // está identificado) e a pendência fica explícita.
          <p className="text-muted-foreground">
            {t("campaignPending", { id: origin.source_id ?? "?" })}
          </p>
        )}
        {origin.adset_name && (
          <Row label={t("adset")} value={origin.adset_name} />
        )}
        {origin.ad_name && <Row label={t("ad")} value={origin.ad_name} />}
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words text-foreground">{value}</dd>
    </div>
  );
}
