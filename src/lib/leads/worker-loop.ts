// ============================================================
// Worker do outbox rodando DENTRO da aplicação (spec 009, FR-016).
//
// Alternativa ao cron externo, para deploy em processo Node de longa
// duração (`next start` em VPS/container). O argumento do PO:
// depender de um agendador de fora para o CRM entregar lead é
// acoplamento que não deveria existir — se aquele serviço cair, o
// CRM para de entregar por um motivo que não é dele.
//
// Ligado por `LEADS_WORKER_INTERVAL_MS`. Sem a variável, nada roda —
// então um deploy serverless (onde não existe processo vivo entre
// requisições) simplesmente não a define e continua usando o
// endpoint HTTP com cron externo. Os dois caminhos coexistem.
//
// POR QUE É SEGURO TER VÁRIAS INSTÂNCIAS TICANDO JUNTAS:
// o claim é `FOR UPDATE SKIP LOCKED` (migration 514). Dois ticks
// concorrentes nunca pegam o mesmo job — é a mesma garantia que já
// impedia o reenvio duplo. Escalar horizontalmente não duplica
// entrega; só multiplica consultas ociosas, e por isso o intervalo
// tem um piso.
// ============================================================

import { supabaseAdmin } from "./admin-client";
import { runWorkerTick } from "./worker";

/** Piso do intervalo: abaixo disso é marteladas no banco à toa. */
const MIN_INTERVAL_MS = 10_000;

/** Espera antes do primeiro tique, para o processo assentar. */
const INITIAL_DELAY_MS = 5_000;

// `Symbol.for` porque em dev o hot-reload reavalia o módulo e um
// guard local (`let started`) nasceria false de novo — a cada
// recarga sobraria mais um laço vivo.
const GUARD = Symbol.for("wacrm.leads.workerLoopStarted");

export function startLeadsWorkerLoop(intervalMs: number): void {
  const g = globalThis as unknown as Record<symbol, boolean>;
  if (g[GUARD]) return;
  g[GUARD] = true;

  const periodo = Math.max(MIN_INTERVAL_MS, Math.floor(intervalMs));

  // Impede empilhamento: se um tique demorar mais que o intervalo
  // (lote grande, Graph lenta), o seguinte é pulado em vez de
  // concorrer com ele.
  let emCurso = false;

  async function tick() {
    if (emCurso) return;
    emCurso = true;
    try {
      const r = await runWorkerTick(supabaseAdmin());
      // Silencioso quando não há trabalho — senão o log ganha uma
      // linha por minuto e deixa de ser lido.
      if (r.claimed > 0) {
        console.info(
          `[leads/worker-loop] ${r.claimed} reivindicado(s), ` +
            `${r.succeeded} entregue(s), ${r.failed} com falha`,
        );
      }
    } catch (err) {
      // Nunca derruba o processo do servidor por causa da fila.
      console.error("[leads/worker-loop] tique falhou:", err);
    } finally {
      emCurso = false;
    }
  }

  // Jitter de até 5s: com várias instâncias, evita que todas batam
  // no mesmo instante e disputem os mesmos jobs (o SKIP LOCKED
  // resolve a corrida, mas não há motivo de provocá-la).
  const jitter = Math.floor(Math.random() * 5_000);

  const inicio = setTimeout(() => {
    void tick();
    const timer = setInterval(() => void tick(), periodo);
    // `unref` para o laço não segurar um encerramento gracioso.
    timer.unref?.();
  }, INITIAL_DELAY_MS + jitter);
  inicio.unref?.();

  console.info(
    `[leads/worker-loop] ativo — tique a cada ${periodo / 1000}s ` +
      `(primeiro em ~${Math.round((INITIAL_DELAY_MS + jitter) / 1000)}s)`,
  );
}
