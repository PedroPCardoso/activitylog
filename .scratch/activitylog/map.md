# Wayfinder: activitylog → 0.1 (TypeORM) + 0.2 (Prisma) no npm

Label: `wayfinder:map`

## Destination

`activitylog-core` + `activitylog-nestjs` (módulo Nest + adapter TypeORM, iff-committed ponta a ponta) publicado como **0.1**, e `activitylog-nextjs/prisma` (via `auditedTransaction` + `$extends` best-effort) publicado como **0.2** fast-follow — ambos no npm. Chegar ao fim do mapa = essas duas versões publicadas, verdes em CI, com paridade Spatie nos caminhos cobertos.

## Notes

- **Domínio:** trilha de auditoria de entidades, core agnóstico de ORM + adapters específicos, DX do spatie/laravel-activitylog. Baseline de design **já travado**: ver [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) (decisões D1–D17), glossário/invariantes em [`CONTEXT.md`](../../CONTEXT.md), plano em [`docs/PLAN.md`](../../docs/PLAN.md), rota em [`docs/NEXT-STEPS.md`](../../docs/NEXT-STEPS.md).
- **Execução carregada no mapa (override do "plan, don't do"):** o destino é "publicado", então tickets `task` de build fazem parte do mapa — não só decisões. As fases de build ainda não fatiadas vivem na fog e graduam conforme as decisões e o bootstrap resolvem.
- **Skills por sessão:** decisões → `/grilling` + `/domain-modeling`; forma de API/UX → `/prototype`; build → `/tdd`.
- **Preferências permanentes:** perguntas em **PT-BR**; segurança da org (redaction deny-by-default, `assertSafeIdentifier` como choke point, fail-secure); **KISS + consistência com o `nestjs-metrics`** (regra do três antes de abstrair); **TypeORM-first** (D17); core nunca bundled nos leaves (D5).

## Decisions so far

<!-- vazio: sessão de charting. Baseline D1–D17 está em ARCHITECTURE.md, não é ticket deste mapa. -->

## Not yet specified

Fog em direção ao destino — em escopo, ainda não afiado o bastante pra ticket. Gradua conforme a frontier avança.

- **Build do core (ex-Fase 1):** logger manual fluente, `SqlExecutorStore`, dialects pg/mysql/sqlite, schema + migrations de referência, exceptions. Grande demais para um ticket; fatiar depois que `created_at/timezone` e o bootstrap resolverem.
- **Build do contexto (ex-Fase 2):** ALS singleton, causer lazy, batch, `withoutLogging`, `serializeContext`/`runWithContext`.
- **Build da Query API (ex-Fase 3):** depende da decisão de tipagem da query API.
- **Build do módulo NestJS (ex-Fase 4):** `forRoot`/`forFeature`, service façade, middleware + interceptor.
- **Build do adapter TypeORM + publish 0.1 (ex-Fase 5):** `@LogsActivity` + subscriber + `auditedUpdate`; depende de `LogOptions`.
- **Build do adapter Prisma + publish 0.2 (ex-Fase 6):** `$extends` + `auditedTransaction`; depende da decisão de dialeto/bulk do Prisma.
- **Estratégia bulk/nested detalhada do Prisma:** mapeamento operação→Activity agregada por operação Prisma (`updateMany`, nested writes); afia depois que a store e o adapter base existirem.

## Out of scope

Além do destino 0.1+0.2 — não é fog, não gradua; volta só se o destino for redesenhado.

- **Adapter Drizzle (0.3):** posterior ao destino 0.1+0.2.
- **Modo outbox/async (1.0):** D12.
- **Mongoose (fase 8+):** só sob demanda.
- **`prune()` + CLI + docs de launch (fase 8):** feature de operação, não requisito de publicar 0.1/0.2 (o publish em si — Changesets/CI/provenance — está no bootstrap/build).
