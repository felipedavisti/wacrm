# Espelhos do n8n → CRM

Pernas adicionais nos fluxos de produção do n8n que enviam **uma cópia**
de cada evento para o CRM, sem alterar o que já roda. Servem para validar
a captação com tráfego real antes da homologação.

| Arquivo | Fluxo no n8n (path do Webhook) | Endpoint do CRM |
|---|---|---|
| `espelho-site.json` | `lead_prd` | `/api/leads/ingest/site` |
| `espelho-meta-form.json` | `fb-leads` | `/api/leads/ingest/meta` |
| `espelho-ctwa.json` | `payload_meta` | `/api/whatsapp/webhook` |

## Como aplicar

1. Abra o arquivo, selecione tudo (Ctrl+A) e copie (Ctrl+C)
2. No n8n, abra o fluxo correspondente, clique numa área **vazia** do
   canvas e cole (Ctrl+V)
3. Substitua o segredo indicado no nó (veja a tabela abaixo)
4. Ligue o nó **Webhook** ao primeiro nó novo — o Webhook passa a ter
   duas saídas, e a original continua intacta

O nó Webhook **não** vem nos arquivos de propósito: se viesse, o n8n
criaria um segundo Webhook duplicado.

## Segredos a substituir

| Arquivo | Campo | Onde achar |
|---|---|---|
| `espelho-site.json` | `x-site-token` | `LEADS_SITE_TOKEN` do `.env` |
| `espelho-meta-form.json` | Secret do nó Crypto | `META_APP_SECRET` do `.env` |
| `espelho-ctwa.json` | Secret do nó Crypto | `META_APP_SECRET` do `.env` |

## Por que os dois da Meta têm três nós

Os endpoints da Meta validam a assinatura HMAC sobre os **bytes exatos**
do corpo. O n8n já desmontou o JSON original, então reencaminhar quebra a
assinatura — daria 401 em tudo.

Solução: o n8n **reassina** o corpo que ele mesmo vai enviar, com o mesmo
App Secret que o CRM conhece.

```
Webhook → preparar corpo → assinar (HMAC) → enviar
          JSON.stringify   SHA256 hex       raw + header
```

A regra que não pode ser quebrada: **o nó que assina e o que envia têm de
usar a mesma string**. Se divergirem, o CRM devolve 401 — em silêncio,
porque o webhook original nunca vê essa resposta.

O do site não precisa disso: autentica por token no header, então basta
um nó.

## O filtro do CTWA

O espelho do `payload_meta` recebe **tudo** que chega no Chatwoot. O
primeiro nó filtra e só deixa passar a primeira mensagem de conversa
iniciada por anúncio:

```javascript
const b = $('Webhook').item.json.body;
const m = b?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
return m?.referral?.source_id ? [{ json: { raw: JSON.stringify(b) } }] : [];
```

| Evento | Passa? |
|---|---|
| 1ª mensagem vinda de anúncio (com `referral`) | sim |
| Mensagens seguintes da mesma conversa | não |
| Mensagem de quem chegou por outro caminho | não |
| Status de entrega | não |

Quando o nó devolve `[]`, o n8n não executa os seguintes e a execução
aparece como concluída **sem erro** — é o comportamento esperado, não
falha.

**Consequência**: a conversa no CRM fica com uma mensagem só. Para validar
atribuição de campanha isso não atrapalha (lead, negócio e campanha nascem
todos da primeira mensagem), mas a inbox parece morta. Para validar
atendimento, o filtro precisa afrouxar — trocar a condição por `if (!m)
return []`, que corta só os status e mantém as conversas completas.

## Proteções em todos os três

- **`onError: continueRegularOutput`** — CRM fora do ar não derruba o
  fluxo de produção
- **`timeout`** — CRM lento não segura o webhook

Os timeouts diferem porque os endpoints diferem:

| Endpoint | Timeout | Por quê |
|---|---|---|
| site | 5s | só grava |
| meta form | 15s | faz três chamadas à Graph antes de responder |
| ctwa | 10s | responde na hora; processa em segundo plano |

## Se a colagem não funcionar

Monte os nós na mão — os valores estão nos arquivos. O único ponto
sensível é o nome do nó de preparar: o campo *Body* do HTTP Request
referencia esse nome (`$('CRM preparar corpo')`). Se renomear um, renomeie
a referência também.
