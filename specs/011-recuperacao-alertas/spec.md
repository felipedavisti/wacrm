# Especificação de Feature: Motor de Leads — Recuperação Ativa + Alertas de Formato

**Feature Branch**: autoria em `008-multi-conta` (programa Motor de Leads); implementação em branch própria.

**Created**: 2026-07-20

**Status**: Draft

**Input**: As duas "redes de segurança" da spec externa do Motor: **recuperação ativa** de leads direto na Meta (contingência quando a Meta não entregou ou a app ficou fora) e **alertas de mudança de formato** das origens. Última feature do programa; empilha sobre o núcleo (009).

## Contexto e Problema

O núcleo (009) transforma falha de **entrega** em falha visível e recuperável. Mas há dois buracos que ele não cobre:

1. **O lead nem entrou no motor** — a Meta não entregou o webhook, ou a aplicação ficou fora por uma janela. A US4 do 009 (reprocessar falhas) não alcança um lead que nunca chegou. Precisa de uma **busca ativa** na Meta, por período, importando só os ausentes, sem duplicar.
2. **A origem mudou o formato** silenciosamente (campo novo, removido ou renomeado). Sem detecção, o dado degrada aos poucos. Precisa **detectar e sinalizar**, preservando sempre o bruto.

Depende de: **009** (ledger, idempotência por `meta_lead_id`, entrega) e **008** (empresa=account).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Recuperar leads perdidos buscando direto na Meta (Priority: P1)

Como operação, quero, após uma janela de indisponibilidade, buscar os leads gerados na Meta no período, comparar com o já ingerido e importar só os ausentes, sem duplicar.

**Why this priority**: é a rede de segurança da rede de segurança — cobre o lead que nem entrou no motor (fora do alcance da US4 do 009).

**Independent Test**: gerar leads de teste na Meta com o recebimento desativado, executar a busca pelo período e verificar que só os ausentes são importados, com rastreamento completo e sem duplicar.

**Acceptance Scenarios**:

1. **Given** uma janela com leads gerados na Meta e não recebidos, **When** o operador busca pelo período, **Then** o sistema lista os leads da Meta indicando quais já existem e quais estão ausentes (comparação por `meta_lead_id`).
2. **Given** a lista de ausentes, **When** o operador aciona a importação, **Then** só os ausentes são criados (via 009), com os campos de rastreamento, e os já existentes ficam intocados.
3. **Given** a mesma busca executada duas vezes, **When** a 2ª importação roda, **Then** nenhum lead é duplicado (idempotência por `meta_lead_id`).
4. **Given** qualquer execução, **When** conclui, **Then** fica registrado quem executou, quando, o período e quantos foram encontrados/recuperados.

---

### User Story 2 — Detectar e sinalizar mudança de formato da origem (Priority: P2)

Como time responsável, quero que mudanças no formato dos dados de uma origem (campo novo, removido ou renomeado) sejam detectadas e sinalizadas, preservando sempre o bruto, para que nada se perca enquanto ajustamos.

**Why this priority**: protege contra degradação silenciosa ao longo do tempo; não bloqueia o go-live do motor.

**Independent Test**: enviar um payload com campo novo/renomeado e verificar que o lead é criado normalmente e a mudança é sinalizada.

> **Caso real (Meta Form)**: as **perguntas do formulário mudam de nome** entre versões — ex.: `qual_o_principal_motivo_do_seu_interesse…` (antiga) → `o_que_fez_você_buscar_mais_segurança…` (nova). O fluxo atual (n8n `RECEBE LEADS`) trata isso com `if/else` hardcoded por versão. É exatamente o que os alertas de formato detectam (campo renomeado/novo), evitando perder a resposta silenciosamente.

**Acceptance Scenarios**:

1. **Given** uma origem passa a enviar um campo desconhecido, **When** o lead é processado, **Then** o lead é criado normalmente, o bruto é preservado e um **alerta de formato** é registrado.
2. **Given** uma origem deixa de enviar um campo esperado, **When** o lead é processado, **Then** o lead é criado com os dados disponíveis e a ausência é sinalizada.
3. **Given** alertas registrados, **When** o time abre a tela de alertas, **Then** vê a origem, o tipo (novo/removido/renomeado), o campo e um exemplo.

---

### Edge Cases

- **Recuperação enquanto os webhooks voltam**: importação idempotente por `meta_lead_id` — evento e recuperação sobre o mesmo lead não duplicam.
- **Janela além da retenção da Meta** (formulário: ~90 dias): o que estiver fora da retenção não é recuperável; o sistema informa claramente.
- **Alerta repetido** (mesmo campo novo em N leads): agrupar/deduplicar o alerta para não inundar.
- **Recuperação sem de-para de empresa**: os importados seguem a mesma regra do 009 (pendência de roteamento visível, nunca perda).

## Requirements *(mandatory)*

### Functional Requirements

**Recuperação ativa (contingência)**

- **FR-023**: O sistema DEVE oferecer uma **busca ativa** de leads direto na plataforma Meta, por período, para contingência.
- **FR-024**: Ao buscar, DEVE comparar os leads retornados com os já ingeridos, usando `meta_lead_id` como chave, e apresentar quais estão ausentes.
- **FR-025**: A operação DEVE poder importar os ausentes em uma ação, com garantia de não-duplicação (existentes apenas confirmados, nunca recriados), preservando os campos de rastreamento (via 009).
- **FR-026**: Cada execução de recuperação DEVE ser **auditada**: quem executou, quando, período consultado, quantos encontrados/recuperados. Disponível a usuários autorizados (papel de admin/operação da empresa ativa).
- **FR-044**: A recuperação roda no escopo da **empresa ativa** (008); importa para o account correto (reusa o roteamento/entrega do 009).

**Alertas de mudança de formato**

- **FR-031**: O sistema DEVE **detectar e sinalizar** mudanças no formato dos dados das origens (campo novo, removido ou renomeado), **sem interromper** o processamento — o lead é sempre criado e o bruto preservado.
- **FR-045**: Os alertas DEVEM ser **agrupados/deduplicados** por origem+tipo+campo para não inundar; cada alerta guarda um exemplo e a 1ª/última ocorrência.
- **FR-046**: Uma tela DEVE listar os alertas de formato (origem, tipo, campo, exemplo, ocorrências), escopada por empresa ativa quando aplicável (alertas de origem podem ser de nível de deployment — ver Assumptions).

### Key Entities

- **Registro de Recuperação Ativa**: auditoria de cada busca/importação (executor, período, encontrados, recuperados, empresa).
- **Alerta de Formato**: origem, tipo (novo/removido/renomeado), campo, exemplo, contagem/ocorrências, 1ª/última vez.
- **Lead (009)**: a importação e a detecção reusam o ledger/idempotência do núcleo.

## Success Criteria *(mandatory)*

- **SC-009**: Após indisponibilidade, 100% dos leads gerados na Meta no período (dentro da retenção) são recuperáveis por uma única execução, sem duplicidade.
- **SC-RA-1**: Toda execução de recuperação é auditável (executor, período, encontrados, recuperados).
- **SC-FMT-1**: 100% das mudanças de formato detectadas são sinalizadas sem interromper o processamento nem perder o bruto.
- **SC-FMT-2**: Alertas do mesmo campo/origem são agrupados (não inundam a tela).

## Assumptions

- A recuperação ativa pressupõe **retenção da Meta** (formulário: ~90 dias); janelas dentro disso são recuperáveis. É para a origem **Meta Formulário** (leads com `meta_lead_id`); CTWA (010) e Site (009) não têm o mesmo mecanismo de "lista por período" na Meta.
- Idempotência reusa o unique `meta_lead_id` do 009 — importar o que já existe é no-op.
- O "formato esperado" de cada origem é um **conjunto conhecido/declarado** de campos (Site: os campos do formulário — 009; Meta: os campos do leadgen). Campo fora do conjunto → alerta "novo"; campo esperado ausente → alerta "removido"; heurística simples de renomeado (novo+removido correlacionados) é best-effort.
- Alertas de formato podem ser de **nível de deployment** (a origem é a mesma para todas as empresas); a tela pode ser central (admin) ou por empresa — decisão de UX menor, default: central admin com filtro.
- Acesso à Graph API da Meta com permissão de leitura de leads dos formulários (reusa credenciais/`meta_apps` da 007/009).

## Fora de Escopo (da 011)

- Ingestão em tempo real (009) e CTWA (010).
- Correção automática do mapeamento quando o formato muda (só detecta/sinaliza; o ajuste é humano).
- Recuperação ativa para Site/CTWA (não há "lista por período" equivalente na Meta).

## Dependências

- **009** (ledger, idempotência `meta_lead_id`, normalização/entrega, roteamento).
- **008** (empresa=account; escopo da recuperação).
- Credenciais Meta (Graph API leads) — reusa `meta_apps` (007).
