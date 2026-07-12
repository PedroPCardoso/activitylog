# Próximos passos — activitylog

Documento vivo de execução, derivado da sessão de grilling. Fonte das decisões: [`ARCHITECTURE.md`](./ARCHITECTURE.md) (D1–D17) · glossário/invariantes: [`../CONTEXT.md`](../CONTEXT.md) · plano completo: [`PLAN.md`](./PLAN.md).

> **Nota:** este diretório ainda não é um repositório git. As "issues" abaixo estão em formato pronto para colar no GitHub; quando o repo/remote existir, posso abri-las via `gh` de fato.

## Sequência de execução (reordenada por D17)

Pacotes (D15): `activitylog-core` · `activitylog-nestjs` (módulo Nest + TypeORM como subpath) · `activitylog-nextjs` (Prisma + Drizzle como subpaths).

| Ordem | Entrega | Pacote | Marco |
|---|---|---|---|
| 1 | **Bootstrap do monorepo** (espelha tooling do metrics, nomes novos) | — | — |
| 2 | Core: logger manual + `SqlExecutorStore` (dialects pg/mysql/sqlite) | `activitylog-core` | — |
| 3 | Contexto: ALS singleton, causer lazy, batch, `withoutLogging` | `activitylog-core` | — |
| 4 | Query API tipada | `activitylog-core` | — |
| 5 | Módulo NestJS (`forRoot`/`forFeature`, service, middleware+interceptor) | `activitylog-nestjs` | — |
| 6 | **Adapter TypeORM** (`@LogsActivity` + subscriber + `auditedUpdate`) | `activitylog-nestjs` | **0.1** |
| 7 | **Adapter Prisma** (`$extends` best-effort + `auditedTransaction` iff) | `activitylog-nextjs` | **0.2** (fast-follow) |
| 8 | Adapter Drizzle (RETURNING) | `activitylog-nextjs` | 0.3 |
| 9 | Operação: `prune()` + CLI + docs + smoke + release | todos | 0.x → launch |

**Mudança-chave vs PLAN.md:** o TypeORM (antes fase 5) passa a ancorar o 0.1; o Prisma (antes o MVP) vira fast-follow 0.2. Racional em D17.

---

## 🎯 Issue próxima a executar

### `#1 — Bootstrap do monorepo (Fase 0)`

**Objetivo:** esqueleto do monorepo espelhando a tooling do `nestjs-metrics`, já com os nomes de pacote definidos em D15 e a restrição de empacotamento de D5.

**Escopo:**
- [ ] `package.json` raiz (`private`, npm workspaces), `tsconfig.base.json` (ES2021, CJS, strict, decorators), `tsconfig.json` (noEmit + paths → src).
- [ ] `vitest.config.ts` (aliases → src, `globals:false`, `fileParallelism:false`), `.eslintrc.json`, `.changeset/config.json`.
- [ ] `docker-compose.yml` + `Dockerfile.dev`; `.github/workflows/{ci.yml,release.yml}`.
- [ ] Três pacotes vazios com tsup CJS-only + subpaths + stubs físicos: `activitylog-core`, `activitylog-nestjs`, `activitylog-nextjs`.
- [ ] **D5:** `activitylog-core` marcado `external` no tsup dos leaves (nunca bundled) — validar que só existe **uma** instância em `node_modules`.
- [ ] Vendorizar `laravel-activitylog` como referência de paridade.
- [ ] `docs/ARCHITECTURE.md` já existe (D1–D17); linkar no README raiz.

**Definition of Done:** `npm run lint/typecheck/test/build` verdes no Docker; `changeset` publica `0.0.1` em dry-run; um teste bobo prova que `require('activitylog-core')` resolve para a mesma instância a partir de `activitylog-nestjs` e `activitylog-nextjs` (guarda de D5).

**Labels sugeridas:** `phase-0`, `infra`, `blocking`.

---

## Perguntas ainda em aberto (não grelhadas)

Branches menores que não foram cravados nesta sessão — resolver antes das fases correspondentes:

- **Profundidade da tipagem da Query API** (fase 4): decidido em D18.
- **`created_at` / timezone**: decidido em D19.
- **`dontSubmitEmptyLogs` × iff**: diff vazio dentro de uma tx → simplesmente não emite `persist` (nenhuma linha), confirmado como no-op seguro.
- **`LogOptions`**: decidido em D20.
- **Interop nestjs-cls**: escrever a receita concreta (copiar `user` da CLS para o causer no middleware).
