// ============================================================
// Gancho de inicialização do Next (roda uma vez por instância do
// servidor, antes de aceitar requisições).
//
// Uso aqui: subir o laço do worker de leads DENTRO da aplicação,
// quando `LEADS_WORKER_INTERVAL_MS` estiver definida. Sem ela, nada
// acontece — o endpoint HTTP `/api/leads/worker/tick` continua
// disponível para cron externo, que é o caminho obrigatório em
// deploy serverless (onde não existe processo vivo entre
// requisições).
//
// `register` precisa retornar rápido: o servidor só começa a
// atender depois dela. Por isso o laço é agendado, nunca aguardado.
// ============================================================

export async function register() {
  // O gancho também é avaliado no runtime Edge, onde não há timer de
  // longa duração nem acesso ao driver do Postgres.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const intervalo = Number(process.env.LEADS_WORKER_INTERVAL_MS);
  if (!Number.isFinite(intervalo) || intervalo <= 0) return;

  // Import dinâmico: sem a variável, o worker (e toda a árvore de
  // entrega que ele puxa) nem é carregado.
  const { startLeadsWorkerLoop } = await import("@/lib/leads/worker-loop");
  startLeadsWorkerLoop(intervalo);
}
