// ============================================================
// Saudação automática do lead de formulário/site (spec 009, FR-047).
//
// Lead de formulário chega sem conversa: a pessoa nunca escreveu, e
// o WhatsApp proíbe iniciar em texto livre. Um template aprovado é o
// único jeito de abrir o diálogo — e quando ela responde, a janela
// de 24h abre e o atendimento segue normal.
//
// TRÊS GARANTIAS, nesta ordem de importância:
//
// 1. NÃO ENVIA por padrão. A config é por origem e nasce FALSE.
//    Homologação recebe lead sem falar com cliente real.
// 2. NÃO REENVIA. `welcome_sent_at` no lead é checado antes; um
//    reprocessamento de entrega não manda "olá" de novo.
// 3. NÃO DERRUBA A ENTREGA. O negócio já está no funil quando isto
//    roda. Falha de template vira `welcome_error` visível, nunca uma
//    entrega revertida.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveConversationByPhone } from "@/lib/whatsapp/resolve-conversation";
import { sendMessageToConversation } from "@/lib/whatsapp/send-message";

import type { CanonicalLead } from "./canonical";
import { escapeLikePattern } from "./routing";

export interface WelcomeInput {
  ingestionId: string;
  accountId: string;
  lead: CanonicalLead;
  /** Já preenchido quando o lead foi entregue. */
  welcomeSentAt: string | null;
}

/**
 * Envia a saudação se — e só se — a origem deste lead estiver
 * configurada para isso. Silenciosa e sem efeito em qualquer outro
 * caso. Nunca lança.
 */
export async function maybeSendLeadWelcome(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  input: WelcomeInput,
): Promise<void> {
  try {
    // Já saudado — inclusive numa entrega reprocessada.
    if (input.welcomeSentAt) return;

    // CTWA não entra aqui: o cliente já escreveu, e a Meta já mostra
    // a saudação do anúncio. Sem `routingKey` não há origem
    // cadastrada, então a exclusão é estrutural.
    const key = input.lead.routingKey;
    if (!key || (key.kind !== "form_id" && key.kind !== "filial")) return;

    const phone = input.lead.contact.phone;
    if (!phone) return; // sem telefone não há a quem escrever

    const { data: source } = await admin
      .from("account_lead_sources")
      .select(
        "welcome_enabled, welcome_template_name, welcome_template_language, welcome_whatsapp_config_id",
      )
      .eq("account_id", input.accountId)
      .eq("kind", key.kind)
      // Escapado: um `%` na chave casaria com a origem de outra
      // empresa e mandaria uma mensagem REAL, do número dela, para um
      // telefone escolhido por quem postou o evento.
      .ilike("value", escapeLikePattern(key.value))
      .limit(1)
      .maybeSingle();

    if (!source?.welcome_enabled || !source.welcome_template_name) return;

    // A partir daqui vamos MESMO falar com uma pessoa real.
    const resolved = await resolveConversationByPhone(
      admin,
      input.accountId,
      phone,
      input.lead.contact.name ?? null,
    );

    await sendMessageToConversation(admin, input.accountId, {
      conversationId: resolved.conversationId,
      messageType: "template",
      templateName: source.welcome_template_name,
      templateLanguage: source.welcome_template_language ?? "pt_BR",
      // Mensagem de máquina: sem agente humano a quem atribuir.
      senderId: null,
    });

    await admin
      .from("lead_ingestions")
      .update({ welcome_sent_at: new Date().toISOString(), welcome_error: null })
      .eq("id", input.ingestionId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[leads/welcome] falha ao enviar a saudação:", message);

    // O erro fica NO LEAD: "por que esse não recebeu?" é pergunta de
    // operação, e a resposta não pode viver só no log do servidor.
    // `welcome_sent_at` continua nulo de propósito — assim um
    // reprocessamento tenta de novo depois do template corrigido.
    await admin
      .from("lead_ingestions")
      .update({ welcome_error: message.slice(0, 500) })
      .eq("id", input.ingestionId)
      .then(undefined, () => {
        /* best-effort: já logamos acima */
      });
  }
}
