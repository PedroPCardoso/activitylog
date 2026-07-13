# Issue 16 auditedUpdate Implementation Plan

> **For Codex:** Execute test-first and keep direct TypeORM update coverage explicit rather than inferred.

**Goal:** Provide an `auditedUpdate(repository, criteria, patch)` path that reads old state, mutates, re-reads new state, and persists the Activity inside one TypeORM transaction.

**Architecture:** A public registration helper associates an initialized TypeORM `DataSource` with the subscriber's store/default options, allowing the required three-argument `auditedUpdate` form to reuse the same configuration. The helper opens (or nests) a transaction through the repository manager, requires criteria to resolve at most one row, reads the old row, performs `Repository.update`, re-reads by primary key, and delegates diff/pipeline/persistence to the same internal recorder as the lifecycle subscriber. Multi-row criteria are rejected instead of violating the aggregate-activity contract.

**Tech Stack:** TypeScript, TypeORM 0.3, better-sqlite3, Vitest, activitylog-core.

---

### Task 1: Specify the three-argument helper

**Files:**
- Create: `test/typeorm-audited-update.spec.ts`

Test a real partial update and persisted old/new diff, a zero-match no-op, rejection of multi-row criteria, rollback when the activity pipeline fails, and rollback under an outer transaction. Confirm the suite initially fails because `auditedUpdate` and the registration helper are absent.

### Task 2: Share subscriber recording infrastructure

**Files:**
- Create: `packages/activitylog-nestjs/src/typeorm/activity-recorder.ts`
- Create: `packages/activitylog-nestjs/src/typeorm/subscriber-registration.ts`
- Modify: `packages/activitylog-nestjs/src/typeorm/activity-log.subscriber.ts`
- Modify: `packages/activitylog-nestjs/src/typeorm/index.ts`

Extract entity snapshots, identity, option merging, core pipeline invocation, and manager-scoped persistence from the subscriber. Add `registerActivityLogSubscriber(dataSource, options)` and retain direct subscriber construction for advanced/manual registration.

### Task 3: Implement auditedUpdate

**Files:**
- Create: `packages/activitylog-nestjs/src/typeorm/audited-update.ts`
- Modify: `packages/activitylog-nestjs/src/typeorm/index.ts`

Implement the transactional read/update/re-read/record sequence. Resolve defaults in the order registration < decorator < call. Return TypeORM's `UpdateResult`; return an affected-zero result for no match; reject criteria matching multiple rows and undecorated/unregistered configurations with prefixed errors.

### Task 4: Publish the coverage matrix and verify

**Files:**
- Modify: `docs/TYPEORM.md`
- Modify: `README.md`
- Modify: `docs/NEXT-STEPS.md`
- Create: `DIVERGENCES.md`

Document lifecycle subscriber convenience versus the explicit iff-committed helper, direct update/QueryBuilder warnings, singular-helper scope, bulk/cascade gaps, and transaction guarantees. Run the focused tests, lint, typecheck, full coverage, build, audit, and diff check before opening the PR.
