# Próximos passos — activitylog

Documento vivo de execução, derivado da sessão de grilling. Fonte das decisões: [`ARCHITECTURE.md`](./ARCHITECTURE.md) (D1–D17) · glossário/invariantes: [`../CONTEXT.md`](../CONTEXT.md) · plano completo: [`PLAN.md`](./PLAN.md).

## Sequência de execução (reordenada por D17)

Pacotes (D15): `activitylog-core` · `activitylog-nestjs` (módulo Nest + TypeORM como subpath) · `activitylog-nextjs` (Prisma + Drizzle como subpaths).

| Ordem | Entrega | Pacote | Marco |
|---|---|---|---|
| 1 | **Bootstrap do monorepo** (espelha tooling do metrics, nomes novos) | — | — |
| 2 | Core: logger manual + `SqlExecutorStore` (dialects pg/mysql/sqlite) | `activitylog-core` | — |
| 3 | Contexto: ALS singleton, causer lazy, batch, `withoutLogging` | `activitylog-core` | — |
| 4 | Query API tipada | `activitylog-core` | — |
| 5 | ✅ Módulo NestJS (`forRoot`/`forFeature`, service, middleware+interceptor) | `activitylog-nestjs` | — |
| 6 | ✅ **Adapter TypeORM** (`@LogsActivity` + subscriber + `auditedUpdate`) | `activitylog-nestjs` | **0.1** |
| 7 | **Adapter Prisma** (`$extends` best-effort + `auditedTransaction` iff) | `activitylog-nextjs` | **0.2** (fast-follow) |
| 8 | Adapter Drizzle (RETURNING) | `activitylog-nextjs` | 0.3 |
| 9 | Operação: `prune()` + CLI + docs + smoke + release | todos | 0.x → launch |

**Mudança-chave vs PLAN.md:** o TypeORM (antes fase 5) passa a ancorar o 0.1; o Prisma (antes o MVP) vira fast-follow 0.2. Racional em D17.

---

## 🎯 Issue próxima a executar

### `#19 — Publish 0.2 (nextjs/prisma)`

O contrato Prisma foi congelado em `#7` e o adapter `$extends` best-effort,
`auditedTransaction` iff-committed, rollback e Aggregate activities foram
entregues em `#18`. O consumer smoke instalado foi preparado para CI/release;
a publicação 0.2 ainda depende da publicação 0.1, que permanece no PR de versão
#30 aguardando a credencial npm necessária para concluir `#17` e desbloquear o
release público seguinte.

---

## Perguntas ainda em aberto (não grelhadas)

Branches menores que não foram cravados nesta sessão — resolver antes das fases correspondentes:

- **Profundidade da tipagem da Query API** (fase 4): decidido em D18.
- **`created_at` / timezone**: decidido em D19.
- **`dontSubmitEmptyLogs` × iff**: diff vazio dentro de uma tx → simplesmente não emite `persist` (nenhuma linha), confirmado como no-op seguro.
- **`LogOptions`**: decidido em D20.
- **Interop nestjs-cls**: decidido e documentado em [`NESTJS_CLS.md`](./NESTJS_CLS.md); nestjs-cls permanece a fonte de identidade e o resolver lazy evita cópia eager.
