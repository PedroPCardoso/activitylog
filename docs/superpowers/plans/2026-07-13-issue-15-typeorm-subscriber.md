# Issue 15 TypeORM Subscriber Implementation Plan

> **For Codex:** Execute this plan test-first and verify each public seam before opening the PR.

**Goal:** Automatically persist activity diffs for TypeORM `save`, `remove`, and `softRemove` operations on entities decorated with `@LogsActivity()`.

**Architecture:** The decorator stores immutable entity-level `LogOptions`. A TypeORM subscriber observes decorated entities, derives database-column snapshots through TypeORM metadata, and delegates field selection to a pure `DiffEngine`. Activity construction still flows through the core logger so hooks, redaction, empty-log suppression, causer, and batch semantics remain centralized. A transaction-scoped store wrapper forwards persistence through an executor backed by `event.manager`, keeping the activity insert in the mutation's live transaction.

**Tech Stack:** TypeScript, TypeORM 0.3, better-sqlite3, Vitest, activitylog-core.

---

### Task 1: Specify the public adapter behavior

**Files:**
- Create: `test/typeorm-subscriber.spec.ts`

Add real SQLite tests that decorate an entity, register the public subscriber, execute `save`, update-via-`save`, `remove`, and `softRemove`, then inspect persisted Activities. Cover `logOnly`, `logExcept`, and `logOnlyDirty`, plus a transaction rollback that must remove both the entity mutation and its Activity.

Run `npx vitest run test/typeorm-subscriber.spec.ts` and confirm the tests fail because the adapter exports do not exist.

### Task 2: Implement metadata and diff seams

**Files:**
- Create: `packages/activitylog-nestjs/src/typeorm/logs-activity.decorator.ts`
- Create: `packages/activitylog-nestjs/src/typeorm/diff-engine.ts`
- Modify: `packages/activitylog-nestjs/src/typeorm/index.ts`

Implement `@LogsActivity(options)`, an internal metadata reader, and `DiffEngine.diff({ old, attributes, dirty, options })`. Field selection must be deterministic and respect `logOnly`, `logExcept`, and `logOnlyDirty` without mutating source objects.

Run the focused test and confirm the pure filtering cases pass while subscriber cases still fail.

### Task 3: Implement transaction-scoped subscriber persistence

**Files:**
- Create: `packages/activitylog-nestjs/src/typeorm/activity-log.subscriber.ts`
- Modify: `packages/activitylog-nestjs/src/typeorm/index.ts`

Implement insert/update/remove/soft-remove hooks. Resolve entity and subscriber options using core precedence helpers, create subject refs from TypeORM primary-column metadata, derive descriptions, and route `ActivityStore.persist()` through an `event.manager` executor. Skip undecorated entities and incomplete subscriber events instead of fabricating identity or old values.

Run the focused test until all operation, filter, and rollback cases pass.

### Task 4: Document and verify

**Files:**
- Create: `docs/TYPEORM.md`
- Modify: `README.md`
- Modify: `docs/NEXT-STEPS.md`

Document registration, supported operations, transaction behavior, and the `.update()`/QueryBuilder limitation reserved for issue #16. Then run `npm run lint`, `npm run typecheck`, `npm run test:coverage`, `npm run build`, `npm audit`, and `git diff --check origin/main...`.
