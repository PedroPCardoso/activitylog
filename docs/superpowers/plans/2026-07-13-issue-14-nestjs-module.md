# Issue 14 NestJS Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar `ActivityLogModule.forRoot()`/`forFeature()`, uma façade `ActivityLogService` e integrações HTTP que abrem a ALS cedo e resolvem `request.user` somente no momento do log.

**Architecture:** O core ganha uma costura mínima de causer lazy e uma função de composição rasa de `LogOptions`. O pacote NestJS mantém os tokens, tipos, façade e integrações HTTP; `forRoot` registra o contexto global e aplica o middleware uma vez, enquanto `forFeature` cria um provider local da façade com opções mais específicas.

**Tech Stack:** TypeScript 5, NestJS 11, RxJS 7, AsyncLocalStorage, Vitest 4.

## Global Constraints

- Manter `activitylog-core` agnóstico de NestJS e ORM.
- Preservar a precedência chamada > feature > root > default, com merge raso e arrays substituídos.
- Preservar a exclusividade de `logOnly` e `logExcept` no nível vencedor.
- Abrir a ALS no middleware e resolver o causer lazy a partir de `request.user`.
- Não adicionar dependência ou acoplamento com `nestjs-cls` nesta issue.
- Testar somente comportamento observável pelos entrypoints públicos.
- Não renomear a branch Conductor atual.

---

### Task 1: Lazy causer and option composition in the core

**Files:**
- Modify: `packages/core/src/context/activitylog-context.ts`
- Modify: `packages/core/src/logger/activity-logger.ts`
- Modify: `packages/core/src/options/resolve-log-options.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `test/activitylog-context.spec.ts`
- Modify: `test/redaction.spec.ts`

**Interfaces:**
- Produces: `ActivityLogContext.causerResolver?: () => CauserRef | null | undefined`
- Produces: `mergeLogOptions(...levels: readonly (LogOptions | undefined)[]): LogOptions`
- Preserves: explicit builder causer > explicit context causer > lazy context resolver > anonymous

- [ ] **Step 1: Write failing tests for lazy resolution and option precedence**

Add a context test that mutates the request-like value after entering ALS and before `.log()`:

```ts
it('resolves a lazy causer at log time', async () => {
  const { persisted, store } = createObservingStore();
  const logger = createActivityLogger({ store });
  const request: { user?: { id: string } } = {};

  await activityLogContextStorage.run(
    { causerResolver: () => request.user ? causerRef('User', request.user.id) : null },
    async () => {
      request.user = { id: 'u1' };
      await logger.activity().log('lazy');
    },
  );

  expect(persisted[0]?.causer).toEqual({ type: 'User', id: 'u1' });
});
```

Add a public option-composition test proving a higher `logOnly` removes a lower `logExcept`, arrays replace arrays, and call-level redaction wins:

```ts
expect(
  mergeLogOptions(
    { logExcept: ['password'], redact: ['token'] },
    { logOnly: ['name'], redact: ['secret'] },
  ),
).toEqual(expect.objectContaining({ logOnly: ['name'], redact: ['secret'] }));
expect(merged.logExcept).toBeUndefined();
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npx vitest run test/activitylog-context.spec.ts test/redaction.spec.ts
```

Expected: failure because `causerResolver` and `mergeLogOptions` do not exist.

- [ ] **Step 3: Implement the minimal core seams**

Extend the context:

```ts
export interface ActivityLogContext {
  causer?: CauserRef | null;
  causerResolver?: () => CauserRef | null | undefined;
  batchUuid?: string;
  withoutLogging?: boolean;
}
```

Resolve the lazy causer only if neither the builder nor context supplied an explicit value:

```ts
const contextCauser =
  context?.causer !== undefined ? context.causer : context?.causerResolver?.();
const causer =
  this.state.causer === undefined ? contextCauser ?? null : this.state.causer;
```

Add composition that removes the losing mutually-exclusive field:

```ts
export function mergeLogOptions(
  ...levels: readonly (LogOptions | undefined)[]
): LogOptions {
  let merged: Record<string, unknown> = {};

  for (const level of levels) {
    if (!level) continue;
    merged = { ...merged, ...level };
    if (level.logOnly !== undefined) delete merged.logExcept;
    if (level.logExcept !== undefined) delete merged.logOnly;
  }

  return merged as LogOptions;
}
```

Export `mergeLogOptions` from `activitylog-core`.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
npx vitest run test/activitylog-context.spec.ts test/redaction.spec.ts
npm run typecheck
```

Expected: all focused tests pass and TypeScript reports no errors.

- [ ] **Step 5: Commit the core seam**

```bash
git add packages/core/src test/activitylog-context.spec.ts test/redaction.spec.ts
git commit -m "feat(core): support lazy causer resolution"
```

### Task 2: NestJS façade and dynamic module precedence

**Files:**
- Create: `packages/activitylog-nestjs/src/activity-log.constants.ts`
- Create: `packages/activitylog-nestjs/src/activity-log.types.ts`
- Create: `packages/activitylog-nestjs/src/activity-log.service.ts`
- Create: `packages/activitylog-nestjs/src/activity-log.module.ts`
- Modify: `packages/activitylog-nestjs/src/index.ts`
- Create: `test/nestjs.spec.ts`

**Interfaces:**
- Produces: `ActivityLogModule.forRoot(options: ActivityLogModuleOptions): DynamicModule`
- Produces: `ActivityLogModule.forFeature(options: ActivityLogFeatureOptions): DynamicModule`
- Produces: `ActivityLogService.activity(logName?: string, options?: LogOptions): ActivityLogBuilder`
- Produces: `ACTIVITYLOG_ROOT_OPTIONS` and `ACTIVITYLOG_FEATURE_OPTIONS`

- [ ] **Step 1: Write failing e2e tests for default/root/feature/call precedence**

Use `Test.createTestingModule` and an observing store. Exercise the public service four times:

```ts
await service.activity().log('default');
await rootService.activity().log('root');
await featureService.activity().log('feature');
await featureService.activity(undefined, { useLogName: 'call' }).log('call');

expect(defaultPersisted[0]?.logName).toBe('default');
expect(rootPersisted[0]?.logName).toBe('root');
expect(featurePersisted.map((activity) => activity.logName)).toEqual([
  'feature',
  'call',
]);
```

Resolve `featureService` through a provider in a module that imports
`ActivityLogModule.forFeature({ useLogName: 'feature' })`; this proves Nest's DI
scope rather than constructing the service manually.

- [ ] **Step 2: Run the NestJS test and verify RED**

Run:

```bash
npx vitest run test/nestjs.spec.ts
```

Expected: failure because the module and service exports do not exist.

- [ ] **Step 3: Implement tokens, types, service, and dynamic modules**

Define options without coupling the core to HTTP:

```ts
export type ActivityLogModuleOptions = LogOptions & {
  store: ActivityStore;
  causerResolver?: ActivityLogCauserResolver;
};

export type ActivityLogFeatureOptions = LogOptions;
export type ActivityLogCallOptions = LogOptions;
```

Implement the façade with call-level precedence:

```ts
@Injectable()
export class ActivityLogService {
  constructor(
    @Inject(ACTIVITYLOG_ROOT_OPTIONS)
    private readonly root: ActivityLogModuleOptions,
    @Optional()
    @Inject(ACTIVITYLOG_FEATURE_OPTIONS)
    private readonly feature?: ActivityLogFeatureOptions,
  ) {}

  activity(logName?: string, options?: ActivityLogCallOptions): ActivityLogBuilder {
    const merged = mergeLogOptions(this.root, this.feature, options);
    const store = options?.store ?? this.feature?.store ?? this.root.store;
    return createActivityLogger({ store, logOptions: merged }).activity(logName);
  }
}
```

Make `forRoot` global and register/export root options plus the façade. Make
`forFeature` return a private feature module with a local options provider and a
local `ActivityLogService`, preventing the root middleware from being applied a
second time.

- [ ] **Step 4: Run the NestJS test and verify GREEN**

Run:

```bash
npx vitest run test/nestjs.spec.ts
npm run typecheck
```

Expected: precedence tests pass and TypeScript reports no errors.

- [ ] **Step 5: Commit the NestJS module and façade**

```bash
git add packages/activitylog-nestjs/src test/nestjs.spec.ts
git commit -m "feat(nestjs): add activity log module and service"
```

### Task 3: HTTP middleware and interceptor

**Files:**
- Create: `packages/activitylog-nestjs/src/activity-log.request.ts`
- Create: `packages/activitylog-nestjs/src/activity-log.middleware.ts`
- Create: `packages/activitylog-nestjs/src/activity-log.interceptor.ts`
- Modify: `packages/activitylog-nestjs/src/activity-log.module.ts`
- Modify: `packages/activitylog-nestjs/src/index.ts`
- Modify: `packages/activitylog-nestjs/package.json`
- Modify: `package-lock.json`
- Modify: `test/nestjs.spec.ts`

**Interfaces:**
- Produces: `ActivityLogMiddleware implements NestMiddleware`
- Produces: `ActivityLogInterceptor implements NestInterceptor`
- Produces: default request resolver for `{ user: { id, type? } }`
- Consumes: `ActivityLogContext.causerResolver`

- [ ] **Step 1: Write failing tests proving request.user is resolved lazily**

For middleware, enter the request context before the user exists, set the user
inside `next`, then log:

```ts
const request: ActivityLogRequest = {};
let logging!: Promise<void>;

middleware.use(request, {}, () => {
  request.user = { id: 'u1' };
  logging = service.activity().log('from middleware');
});
await logging;

expect(persisted[0]?.causer).toEqual({ type: 'User', id: 'u1' });
```

For the interceptor, use a deferred Observable that sets `request.user` before
calling the service, then await it with `firstValueFrom`. Assert the same causer.

- [ ] **Step 2: Run the NestJS test and verify RED**

Run:

```bash
npx vitest run test/nestjs.spec.ts
```

Expected: failure because middleware/interceptor exports do not exist.

- [ ] **Step 3: Implement request resolution and ALS integrations**

Default request resolution must return null for no user, preserve a valid
`type` string when present, use the class name for class instances, and use
`User` for plain objects with a valid string/number/bigint id.

Open context in middleware:

```ts
use(request: ActivityLogRequest, _response: unknown, next: (error?: unknown) => void): void {
  activityLogContextStorage.run(
    { causerResolver: () => resolveRequestCauser(request, this.options.causerResolver) },
    next,
  );
}
```

Create the interceptor Observable at subscription time so the handler executes
inside ALS:

```ts
return new Observable((subscriber) =>
  activityLogContextStorage.run(
    { causerResolver: () => resolveRequestCauser(request, this.options.causerResolver) },
    () => next.handle().subscribe(subscriber),
  ),
);
```

Register/export both providers from `forRoot`, apply the middleware for all
routes in `configure`, and declare `rxjs` as a direct peer dependency because
the interceptor imports it at runtime.

- [ ] **Step 4: Run focused validation and verify GREEN**

Run:

```bash
npx vitest run test/nestjs.spec.ts test/activitylog-context.spec.ts
npm run typecheck
npm run build
```

Expected: middleware/interceptor tests pass, declarations build, and the core
singleton verifier remains green.

- [ ] **Step 5: Commit the HTTP integrations**

```bash
git add packages/activitylog-nestjs package-lock.json test/nestjs.spec.ts
git commit -m "feat(nestjs): resolve request causers lazily"
```

### Task 4: Public documentation and complete verification

**Files:**
- Modify: `README.md`
- Modify: `docs/NEXT-STEPS.md`

**Interfaces:**
- Documents: `forRoot`, `forFeature`, `ActivityLogService`, automatic middleware, and optional interceptor
- Documents: default and custom `request.user` causer resolution

- [ ] **Step 1: Add usage documentation**

Add a NestJS section showing:

```ts
@Module({
  imports: [ActivityLogModule.forRoot({ store })],
})
export class AppModule {}

@Injectable()
export class OrdersService {
  constructor(private readonly activityLog: ActivityLogService) {}

  async record(): Promise<void> {
    await this.activityLog.activity('orders').event('updated').log('Order updated');
  }
}
```

Explain that the middleware is applied by `forRoot`, `request.user.id` maps to a
`User` causer by default, a custom resolver supports application-specific user
shapes, and the interceptor is an explicit secondary integration.

- [ ] **Step 2: Update roadmap status for the delivered issue**

Mark the NestJS module line as delivered without marking TypeORM or release work
complete.

- [ ] **Step 3: Run complete local verification**

Run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm audit
git diff --check origin/main...
```

Expected: all commands exit 0 and the complete suite is green.

- [ ] **Step 4: Review scope and commit documentation**

Inspect:

```bash
git status --short
git diff --stat origin/main...
git diff origin/main... -- README.md docs/NEXT-STEPS.md
```

Then commit:

```bash
git add README.md docs/NEXT-STEPS.md
git commit -m "docs: explain NestJS activity logging"
```

- [ ] **Step 5: Prepare issue #14 for the publish workflow**

Verify the final branch diff contains only the approved design document and
issue `#14` changes. The PR body must summarize behavior, document validation,
and contain `Closes #14`.

## Plan Self-Review

- Spec coverage: Tasks 1–3 cover precedence, injectable façade, middleware,
  lazy causer resolution, and the secondary interceptor; Task 4 covers public
  usage and complete validation.
- Placeholder scan: every code-producing step contains the intended interface
  or concrete implementation shape; no deferred implementation remains.
- Type consistency: root/feature/call options all compose through
  `mergeLogOptions`; the service always returns the existing
  `ActivityLogBuilder`; request resolution produces the existing `CauserRef`.
