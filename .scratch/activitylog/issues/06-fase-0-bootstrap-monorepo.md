# 06 — Fase 0: Bootstrap do monorepo

Type: task
Status: open
Blocked by: none

## Question

(Task de execução — override de Notes.) Esqueleto do monorepo espelhando a tooling do `nestjs-metrics`, com os nomes de D15 e a restrição de empacotamento de D5. Escopo e DoD detalhados na issue `#1` de [`docs/NEXT-STEPS.md`](../../../docs/NEXT-STEPS.md):

- workspaces + tsconfig base/root + vitest + eslint + changesets + docker + CI;
- três pacotes `activitylog-{core,nestjs,nextjs}` com tsup CJS-only, subpaths, stubs físicos;
- **`activitylog-core` `external` nos leaves (nunca bundled)** + teste que prova instância única (guarda de D5);
- vendorizar `laravel-activitylog`.

DoD: `lint/typecheck/test/build` verdes no Docker; `changeset` publica `0.0.1` dry-run. Desbloqueia todo o build subsequente.
