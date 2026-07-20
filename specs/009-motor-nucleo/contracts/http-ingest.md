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

Meta lead form (Graph webhook).

- **Auth**: `GET` responde o desafio do verify token; `POST` valida `X-Hub-Signature-256`
  (reusa o modelo da 007/`meta_apps`); inválido → 401 +
  `lead_rejected_events(reason='invalid_signature')`.
- **Efeito**: grava raw; para cada leadgen, resolve os 7 campos de rastreamento;
  **idempotência absoluta por `meta_lead_id`** (FR-018) — reentrega não duplica;
  dedup form_id+phone+email (FR-019); resolve empresa; enfileira ou `pending`.
- **Resposta**: `200` (a Meta exige 200 rápido); processamento pesado via trabalho
  assíncrono/outbox.

## Normalização → canônico (FR-008)

Todo evento vira o modelo canônico único (contato + origem + rastreamento + empresa +
status) gravado em `lead_ingestions.canonical`, independente da origem.
