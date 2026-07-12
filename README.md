# activitylog

ORM-agnostic entity audit trail for TypeScript, with the DX of
[spatie/laravel-activitylog](https://github.com/spatie/laravel-activitylog). The core knows
nothing about any ORM or about NestJS; adapters are first-class.

> **Status:** early design / bootstrap. No published package yet. The design is locked; the
> build is being sliced into tickets. See the docs below.

## The bet

- **ORM-agnostic core + first-class adapters** — TypeORM, Prisma, Drizzle.
- **`iff-committed`** — an activity persists *if and only if* the mutation that caused it
  commits (when transactional). The audit trail never orphans or drops a record.
- **Causer resolved automatically** from request context (AsyncLocalStorage).
- **Honest coverage** — where a guarantee isn't possible (e.g. bulk/nested writes), it's
  declared in a coverage matrix, never faked.
- **Redaction on by default** — passwords, tokens and PII don't leak into the audit trail.

## Planned packages

| Package | Contents |
|---|---|
| `activitylog-core` | Agnostic core: logger, store, diff, context, query API |
| `activitylog-nestjs` | NestJS module + TypeORM adapter (subpath) |
| `activitylog-nextjs` | Prisma + Drizzle adapters (subpaths) |

## Docs

- [`docs/PLAN.md`](docs/PLAN.md) — execution plan
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — locked decisions (D1–D17)
- [`CONTEXT.md`](CONTEXT.md) — domain glossary + the `iff-committed` invariant
- [`docs/NEXT-STEPS.md`](docs/NEXT-STEPS.md) — roadmap

## License

[MIT](LICENSE)
