-- ============================================================
-- 514_lead_outbox (spec 009 — resiliência)
--
-- Outbox durável: uma linha por (lead × destino). É a fila e o
-- registro de auditoria da entrega — 5 tentativas com backoff
-- exponencial (~1min, 5min, 15min, 1h, 3h), nada preso e nada
-- perdido num crash (lease reclaimável).
--
-- Agendamento (decisão B5): o worker é um endpoint da aplicação
-- (`POST /api/leads/worker/tick`) chamado por um cron externo —
-- funciona em qualquer tier do Supabase (o free pausa e mataria o
-- pg_cron) e faz a entrega em Node (interna via SQL, externa via
-- fetch), sem depender de pg_net. O que o Postgres precisa prover é
-- só o CLAIM atômico: `FOR UPDATE SKIP LOCKED` não é expressável em
-- PostgREST, então vive na RPC `claim_lead_delivery_jobs`.
--
-- DIVERGÊNCIA: tabelas/RPCs novas, aditivas (Princípio V).
-- ============================================================

CREATE TABLE IF NOT EXISTS lead_delivery_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ingestion_id UUID NOT NULL REFERENCES lead_ingestions(id) ON DELETE CASCADE,

  -- Adaptador de destino (FR-036). 'internal' = contact+deal no
  -- funil; 'external' = destino configurado por conta.
  destination TEXT NOT NULL CHECK (destination IN ('internal', 'external')),

  -- Desnormalizado para o painel/RLS sem join (e para throttling
  -- por empresa no futuro).
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'succeeded', 'failed')),
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Crash safety: um job 'processing' cujo lease expirou volta a ser
  -- reivindicável (o worker morreu no meio).
  locked_by TEXT,
  lease_until TIMESTAMPTZ,

  -- Id criado no destino (deal_id no interno; id externo no outro).
  external_ref TEXT,
  last_error TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Uma perna por (lead, destino) — reprocessar reusa a linha.
  CONSTRAINT uq_lead_delivery_lead_dest UNIQUE (ingestion_id, destination)
);

-- O índice que o claim varre a cada tick.
CREATE INDEX IF NOT EXISTS ix_lead_delivery_jobs_ready
  ON lead_delivery_jobs (next_attempt_at)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS ix_lead_delivery_jobs_ingestion
  ON lead_delivery_jobs (ingestion_id);

DROP TRIGGER IF EXISTS set_updated_at ON lead_delivery_jobs;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON lead_delivery_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE lead_delivery_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_delivery_jobs_select ON lead_delivery_jobs;
CREATE POLICY lead_delivery_jobs_select ON lead_delivery_jobs FOR SELECT
  USING (account_id IS NOT NULL AND is_active_member(account_id));

-- ------------------------------------------------------------
-- Histórico append-only de tentativas (FR-016/029): o painel mostra
-- o erro de CADA tentativa, em linguagem compreensível.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_delivery_attempts (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES lead_delivery_jobs(id) ON DELETE CASCADE,
  attempt_no INT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'error')),
  -- 'retryable' agenda nova tentativa; 'permanent' encerra em falha.
  error_class TEXT CHECK (error_class IN ('retryable', 'permanent')),
  reason TEXT
);

CREATE INDEX IF NOT EXISTS ix_lead_delivery_attempts_job
  ON lead_delivery_attempts (job_id, attempt_no);

ALTER TABLE lead_delivery_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_delivery_attempts_select ON lead_delivery_attempts;
CREATE POLICY lead_delivery_attempts_select ON lead_delivery_attempts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM lead_delivery_jobs j
      WHERE j.id = lead_delivery_attempts.job_id
        AND j.account_id IS NOT NULL
        AND is_active_member(j.account_id)
    )
  );

-- ============================================================
-- claim_lead_delivery_jobs(p_worker, p_limit, p_lease_seconds)
--
-- Reivindica atomicamente até `p_limit` jobs prontos e devolve-os
-- ao worker. `FOR UPDATE SKIP LOCKED` garante que dois ticks
-- concorrentes NUNCA pegam o mesmo job — é também o que impede o
-- reenvio duplo simultâneo do mesmo lead (FR-028).
--
-- "Pronto" = pendente com horário chegado, OU processando com lease
-- expirado (o worker anterior morreu — reclaim).
--
-- service_role apenas: é o worker, não uma ação de usuário.
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_lead_delivery_jobs(
  p_worker TEXT,
  p_limit INT DEFAULT 25,
  p_lease_seconds INT DEFAULT 120
) RETURNS SETOF lead_delivery_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH ready AS (
    SELECT j.id
    FROM lead_delivery_jobs j
    WHERE (
      (j.status = 'pending' AND j.next_attempt_at <= NOW())
      OR (j.status = 'processing' AND j.lease_until IS NOT NULL
          AND j.lease_until < NOW())
    )
    ORDER BY j.next_attempt_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE lead_delivery_jobs j
  SET status = 'processing',
      locked_by = p_worker,
      lease_until = NOW() + make_interval(secs => p_lease_seconds),
      attempts = j.attempts + 1,
      updated_at = NOW()
  FROM ready
  WHERE j.id = ready.id
  RETURNING j.*;
END;
$$;

ALTER FUNCTION public.claim_lead_delivery_jobs(TEXT, INT, INT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_lead_delivery_jobs(TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_lead_delivery_jobs(TEXT, INT, INT)
  TO service_role;

-- ============================================================
-- finish_lead_delivery_job(job, ok, reason, error_class, external_ref)
--
-- Fecha uma tentativa: grava o histórico append-only, aplica o
-- backoff exponencial e recalcula o status do LEAD a partir das
-- suas pernas (pending / sent / partially_sent / failed).
--
-- Backoff: 1min, 5min, 15min, 1h, 3h — a tentativa nº N usa o
-- passo N. Erro 'permanent' ou tentativas esgotadas → 'failed'
-- (reenvio manual pelo painel, FR-016).
-- ============================================================
CREATE OR REPLACE FUNCTION public.finish_lead_delivery_job(
  p_job_id UUID,
  p_ok BOOLEAN,
  p_reason TEXT DEFAULT NULL,
  p_error_class TEXT DEFAULT 'retryable',
  p_external_ref TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job lead_delivery_jobs%ROWTYPE;
  v_backoff INTERVAL;
  v_new_status TEXT;
  v_ing UUID;
  v_total INT;
  v_ok INT;
  v_dead INT;
BEGIN
  SELECT * INTO v_job FROM lead_delivery_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'delivery job % not found', p_job_id
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO lead_delivery_attempts (
    job_id, attempt_no, finished_at, outcome, error_class, reason
  ) VALUES (
    p_job_id,
    v_job.attempts,
    NOW(),
    CASE WHEN p_ok THEN 'success' ELSE 'error' END,
    CASE WHEN p_ok THEN NULL ELSE COALESCE(p_error_class, 'retryable') END,
    p_reason
  );

  IF p_ok THEN
    v_new_status := 'succeeded';
  ELSIF COALESCE(p_error_class, 'retryable') = 'permanent'
        OR v_job.attempts >= v_job.max_attempts THEN
    v_new_status := 'failed';
  ELSE
    v_new_status := 'pending';
  END IF;

  v_backoff := CASE v_job.attempts
    WHEN 1 THEN INTERVAL '1 minute'
    WHEN 2 THEN INTERVAL '5 minutes'
    WHEN 3 THEN INTERVAL '15 minutes'
    WHEN 4 THEN INTERVAL '1 hour'
    ELSE INTERVAL '3 hours'
  END;

  UPDATE lead_delivery_jobs
  SET status = v_new_status,
      locked_by = NULL,
      lease_until = NULL,
      last_error = CASE WHEN p_ok THEN NULL ELSE p_reason END,
      external_ref = COALESCE(p_external_ref, external_ref),
      next_attempt_at = CASE
        WHEN v_new_status = 'pending' THEN NOW() + v_backoff
        ELSE next_attempt_at
      END,
      updated_at = NOW()
  WHERE id = p_job_id;

  -- Status do lead derivado das pernas (FR-034). Com destino único,
  -- 'partially_sent' nunca ocorre — o maquinário fica inerte.
  v_ing := v_job.ingestion_id;
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE status = 'succeeded'),
         COUNT(*) FILTER (WHERE status = 'failed')
  INTO v_total, v_ok, v_dead
  FROM lead_delivery_jobs WHERE ingestion_id = v_ing;

  UPDATE lead_ingestions
  SET overall_status = CASE
        WHEN v_ok = v_total THEN 'sent'
        WHEN v_ok > 0 AND v_ok + v_dead = v_total THEN 'partially_sent'
        WHEN v_dead > 0 AND v_ok = 0 AND v_ok + v_dead = v_total THEN 'failed'
        ELSE 'pending'
      END,
      updated_at = NOW()
  WHERE id = v_ing;
END;
$$;

ALTER FUNCTION public.finish_lead_delivery_job(UUID, BOOLEAN, TEXT, TEXT, TEXT)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finish_lead_delivery_job(UUID, BOOLEAN, TEXT, TEXT, TEXT)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finish_lead_delivery_job(UUID, BOOLEAN, TEXT, TEXT, TEXT)
  TO service_role;
