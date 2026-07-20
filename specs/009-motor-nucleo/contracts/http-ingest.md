# Contratos — Ingestão (pontos de entrada)

Endpoints públicos que recebem leads. **Fail-closed** na autenticação (FR-037):
evento inválido → 401/403 + registro em `lead_rejected_events`, nunca vira lead.
Todo evento aceito grava `lead_raw_events` **antes** de normalizar (FR-004/009).

## `POST /api/leads/ingest/site`

Formulário/simulação do site. **O site posta direto no nosso sistema** — o n8n é
eliminado (não há mais o webhook intermediário `lead_prd`).

- **Auth**: header com token/secret compartilhado por origem (ex.: `X-Site-Token`);
  inválido → 401 + `lead_rejected_events(reason='invalid_token')`.
- **Body** — os campos do formulário direto no corpo do POST (é o `body` que hoje
  vai ao n8n; sem o embrulho `headers/params/…`, que era representação interna do n8n):

  ```json
  {
    "nome": "Fábio Lennon Moreira Martins",
    "celular": "98984919086",
    "telefone": "",
    "email": "fabiolennon52@gmail.com",
    "cpf": "65861337349",
    "data_nascimento": "1981-05-23",
    "produto": "Plano APH Tradicional",
    "filial": "São Luís",
    "sexo": "M",
    "estado_civil": "Casado"
  }
  ```

- **Mapeamento** (canônico → CRM):
  - `nome` → `contact.name`; `celular` (fallback `telefone`) → `contact.phone`
    (normalizado); `email` → `contact.email`.
  - `cpf`, `data_nascimento`, `sexo`, `estado_civil` → **custom fields** do contato
    (⚠️ `cpf` é PII sensível — LGPD, Constituição I; retido em claro nesta fase,
    protegido pelo acesso restrito por empresa; anonimização = decisão futura).
  - `produto` → custom field + chave de dedup (normalizar removendo o prefixo
    "Plano ", ex.: "Plano APH Tradicional" → "APH Tradicional").
  - **`filial` → empresa (account)**: roteamento **explícito** por filial (ver abaixo);
    não depende de campanha.
- **Roteamento (Site)**: resolve a empresa por **`filial` → account** (de-para
  filial→empresa; account = a empresa "Vitalmed <filial>"). Sem correspondência →
  `routing_status='pending'` (fila central).
- **Efeito**: grava raw (o payload inteiro); normaliza; dedup 24h
  (telefone+e-mail+produto, FR-017); roteia por filial; enfileira entrega ou `pending`.
- **Resposta**: `202 { ingestion_id, dedup: 'created'|'suppressed', routing:
  'resolved'|'pending' }`. Duplicado em 24h → `suppressed` (vinculado ao original).

## `POST /api/leads/ingest/meta` (+ `GET` verify)

Meta lead form (Graph webhook `leadgen`). **O webhook só entrega IDs** — os dados do
lead são buscados depois na Graph API (fluxo confirmado no n8n `RECEBE LEADS`/`fb-leads`).

- **Auth**: `GET` responde o desafio do verify token; `POST` valida `X-Hub-Signature-256`
  (reusa o modelo da 007/`meta_apps`); inválido → 401 +
  `lead_rejected_events(reason='invalid_signature')`.
- **Entrada (webhook)**: `body.entry[].changes[].value` com `leadgen_id`, `form_id`,
  `ad_id`, `adgroup_id`, `page_id`, `created_time` (`field='leadgen'`). **Sem** dados
  pessoais.
- **Enriquecimento (Graph API, token `meta_apps`/`token-facebook_leads`)** — passos:
  1. `GET /{ad_id}?fields=id,name,account_id,campaign_id,adset_id` → conta/campanha/adset.
  2. `GET /{leadgen_id}?fields=field_data,created_time,campaign_name,ad_id,ad_name,adset_name,platform,form_id,campaign_id`
     → **`field_data`** (nome/telefone/e-mail + perguntas do formulário) e nomes de campanha/adset/anúncio.
  3. `GET /{form_id}?fields=id,name` → nome do formulário.
- **Mapeamento dos 7 campos de rastreamento** (confirmado; ex-`ink_new_*`):
  Campanha=`campaign_name`(→utm.campaign) · `ink_new_utmcampanha`=`adset_name` ·
  `ink_new_Id_Campanha`=`adset_id` · `ink_new_ID_Lead`=`leadgen_id` ·
  `ink_new_ID_Formulario`=`form_id` · `ink_new_Id_Criativo`=`ad_id` ·
  `ink_new_Criativo_Facebook`=`ad_name`.
- **Contato**: `nome_completo`/`full_name`, `telefone`/`phone_number` (normalizar p/
  `+55 DDD XXXXX-XXXX` — reusa `phone-utils` do 007), `email` — extraídos do `field_data`
  (nomes de campo variam entre formulários — ver 011/alertas de formato). Perguntas
  extras do form (`pergunta/resposta`) → descrição/custom fields do deal.
- **Roteamento (Meta)**: por **`form_id` → empresa** (cada formulário pertence a uma
  filial/empresa; ex. mapaFilial `1009…`→SSA, `1091…`→FSA, `7467…`→LNAP). É o de-para
  Meta (equivalente ao `filial` do Site).
- **Idempotência**: `meta_lead_id` = `leadgen_id`, unique (FR-018); reentrega = no-op.
  Dedup adicional `form_id`+phone+email (FR-019).
- **Resposta**: `200` rápido à Meta; o enriquecimento (Graph API) e a entrega correm no
  processamento assíncrono/outbox (nunca descartar; retry se a Graph API falhar).

## Normalização → canônico (FR-008)

Todo evento vira o modelo canônico único (contato + origem + rastreamento + empresa +
status) gravado em `lead_ingestions.canonical`, independente da origem. Para Meta, o
`canonical` inclui `field_data` bruto e as perguntas/respostas do formulário.
