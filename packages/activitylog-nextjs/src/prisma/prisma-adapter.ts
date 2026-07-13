import {
  ActivityLogger,
  DiffEngine,
  SqlExecutorStore,
  aggregateSubjectRef,
  getActivityLogContext,
  isActivityLoggingEnabled,
  resolveLogOptions,
  subjectRef,
  type ActivityEvent,
  type ActivityId,
  type ActivityStore,
  type DiffSnapshot,
  type NewActivity,
  type SqlDataSource,
  type SqlRow,
  type TransactionRef,
} from 'activitylog-core';

import { normalizePrismaValue } from './normalize-prisma-value';
import type {
  AuditedPrismaTransactionClient,
  PrismaActivityLogOptions,
  PrismaModelConfig,
} from './prisma.types';

const INDIVIDUAL_OPERATIONS = new Set(['create', 'update', 'delete', 'upsert']);
const BULK_OPERATIONS = new Set([
  'createMany',
  'createManyAndReturn',
  'updateMany',
  'updateManyAndReturn',
  'deleteMany',
]);
const MUTATION_OPERATIONS = new Set([...INDIVIDUAL_OPERATIONS, ...BULK_OPERATIONS]);
const RELATION_OPERATIONS = new Set([
  'create',
  'createMany',
  'connect',
  'connectOrCreate',
  'disconnect',
  'delete',
  'deleteMany',
  'set',
  'update',
  'updateMany',
  'upsert',
]);

interface PrismaRuntimeClient {
  $extends?: (extension: unknown) => unknown;
  $transaction?: (callback: (tx: object) => Promise<unknown>) => Promise<unknown>;
  $queryRawUnsafe?: (sql: string, ...params: unknown[]) => Promise<unknown>;
  $executeRawUnsafe?: (sql: string, ...params: unknown[]) => Promise<number>;
  [key: string]: unknown;
}

interface Runtime {
  client: PrismaRuntimeClient;
  store: ActivityStore;
  options: PrismaActivityLogOptions;
  transaction?: TransactionRef;
}

interface QueryExtensionInput {
  model?: string;
  operation: string;
  args: Record<string, unknown>;
  query: (args: Record<string, unknown>) => Promise<unknown>;
}

export function prismaActivityLog<Client extends object>(
  prisma: Client,
  options: PrismaActivityLogOptions,
): Client {
  const client = asRuntimeClient(prisma);
  const runtime = createRuntime(client, options);
  if (typeof client.$extends !== 'function') {
    fail('requires a Prisma client with $extends()');
  }

  return client.$extends({
    name: 'activitylog',
    query: {
      $allModels: {
        $allOperations: async (input: QueryExtensionInput) => {
          if (input.model === undefined || !MUTATION_OPERATIONS.has(input.operation)) {
            return input.query(input.args);
          }
          return auditMutation(runtime, input.model, input.operation, input.args, input.query);
        },
      },
    },
  }) as Client;
}

export async function auditedTransaction<Client extends object, Result>(
  prisma: Client,
  options: PrismaActivityLogOptions,
  callback: (tx: AuditedPrismaTransactionClient<Client>) => Promise<Result>,
): Promise<Result> {
  const client = asRuntimeClient(prisma);
  const rootRuntime = createRuntime(client, options);
  if ('store' in options && options.storeTransactionMode !== 'uses-context') {
    fail('auditedTransaction requires a custom store with storeTransactionMode: "uses-context"');
  }
  if (typeof client.$transaction !== 'function') {
    fail('requires a Prisma client with interactive $transaction() support');
  }

  return await client.$transaction(async (tx) => {
    const transactionClient = asRuntimeClient(tx);
    const runtime: Runtime = {
      ...rootRuntime,
      client: transactionClient,
      transaction: createPrismaExecutor(transactionClient),
    };
    return callback(createTransactionProxy(tx, runtime) as AuditedPrismaTransactionClient<Client>);
  }) as Result;
}

function createRuntime(client: PrismaRuntimeClient, options: PrismaActivityLogOptions): Runtime {
  validateOptions(options);
  return {
    client,
    options,
    store: 'store' in options && options.store !== undefined
      ? options.store
      : new SqlExecutorStore({
          dataSource: createPrismaDataSource(client, options.dialect),
          tableName: options.tableName,
        }),
  };
}

async function auditMutation(
  runtime: Runtime,
  model: string,
  operation: string,
  args: Record<string, unknown>,
  query: (args: Record<string, unknown>) => Promise<unknown>,
): Promise<unknown> {
  if (!isActivityLoggingEnabled() || getActivityLogContext()?.withoutLogging === true) {
    return query(args);
  }

  normalizePrismaValue(args);
  const modelConfig = runtime.options.models?.[model] ?? {};
  const nested = INDIVIDUAL_OPERATIONS.has(operation) && isNestedWrite(args, operation, modelConfig);

  if (BULK_OPERATIONS.has(operation) || nested) {
    const aggregateEvent = operation === 'upsert'
      ? await upsertEvent(runtime.client, model, args.where, modelConfig)
      : eventFor(operation);
    const result = await query(args);
    await recordAggregate(runtime, model, operation, args, result, aggregateEvent);
    return result;
  }

  validateIdentitySelection(args, modelConfig.idField ?? 'id');
  const delegate = modelDelegate(runtime.client, model);
  const old = operation === 'create'
    ? null
    : await privateRead(delegate, args.where, modelConfig);
  const result = await query(args);
  const event = operation === 'delete'
    ? 'deleted'
    : operation === 'upsert'
      ? old === null ? 'created' : 'updated'
      : eventFor(operation);

  if (operation === 'delete') {
    await recordIndividual(runtime, model, event, old ?? asRecord(result), {});
    return result;
  }

  const resultRecord = asRecord(result);
  const id = activityId(resultRecord[modelConfig.idField ?? 'id']);
  const attributes = await privateRead(delegate, { [modelConfig.idField ?? 'id']: id }, modelConfig);
  if (attributes === null) {
    fail(`could not re-read ${model} after ${operation}`);
  }
  await recordIndividual(runtime, model, event, old ?? {}, attributes);
  return result;
}

async function privateRead(
  delegate: Record<string, unknown>,
  where: unknown,
  config: PrismaModelConfig,
): Promise<Record<string, unknown> | null> {
  const findUnique = delegate.findUnique;
  if (typeof findUnique !== 'function') {
    fail('requires model delegates with findUnique()');
  }
  const fields = [config.idField ?? 'id', ...(config.auditFields ?? [])];
  const value = await findUnique.call(delegate, {
    where,
    omit: Object.fromEntries(fields.map((field) => [field, false])),
  });
  return value === null ? null : asRecord(value);
}

async function recordIndividual(
  runtime: Runtime,
  model: string,
  event: ActivityEvent,
  oldValue: Record<string, unknown>,
  attributesValue: Record<string, unknown>,
): Promise<void> {
  const old = asRecord(normalizePrismaValue(oldValue));
  const attributes = asRecord(normalizePrismaValue(attributesValue));
  const resolved = resolveLogOptions(runtime.options);
  const diff = DiffEngine.diff({ old, attributes, options: resolved });
  const idField = runtime.options.models?.[model]?.idField ?? 'id';
  const id = activityId((event === 'deleted' ? old : attributes)[idField]);
  const subject = subjectRef(model, id);
  const description = resolved.descriptionForEvent?.({ event, subject, diff }) ?? `${model} ${event}`;
  const logger = new ActivityLogger({
    store: scopedStore(runtime.store, runtime.transaction),
    now: runtime.options.now,
    logOptions: runtime.options,
  });

  await logger
    .activity(resolved.useLogName)
    .performedOn(subject)
    .event(event)
    .withProperties({ attributes: diff.attributes, old: diff.old })
    .log(description);
}

async function recordAggregate(
  runtime: Runtime,
  model: string,
  operation: string,
  args: Record<string, unknown>,
  result: unknown,
  event: ActivityEvent,
): Promise<void> {
  const properties = asRecord(normalizePrismaValue({
    aggregate: true,
    criteria: args.where ?? {},
    changes: aggregateChanges(operation, args),
    affected: affectedCount(operation, result),
  }));
  const resolved = resolveLogOptions(runtime.options);
  const subject = aggregateSubjectRef(model);
  const emptyDiff: DiffSnapshot = { old: {}, attributes: {} };
  const description = resolved.descriptionForEvent?.({ event, subject, diff: emptyDiff }) ?? `${model} ${event}`;
  const logger = new ActivityLogger({
    store: scopedStore(runtime.store, runtime.transaction),
    now: runtime.options.now,
    logOptions: runtime.options,
  });

  await logger
    .activity(resolved.useLogName)
    .performedOn(subject)
    .event(event)
    .withProperties(properties)
    .log(description);
}

async function upsertEvent(
  client: PrismaRuntimeClient,
  model: string,
  where: unknown,
  config: PrismaModelConfig,
): Promise<ActivityEvent> {
  const old = await privateRead(modelDelegate(client, model), where, config);
  return old === null ? 'created' : 'updated';
}

function createTransactionProxy(tx: object, runtime: Runtime): object {
  const delegateCache = new Map<PropertyKey, object>();
  return new Proxy(tx, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof property === 'string' && isDelegate(value)) {
        const cached = delegateCache.get(property);
        if (cached !== undefined) return cached;
        const proxy = createDelegateProxy(value, modelName(runtime.options, property), runtime);
        delegateCache.set(property, proxy);
        return proxy;
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function createDelegateProxy(delegate: Record<string, unknown>, model: string, runtime: Runtime): object {
  return new Proxy(delegate, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof property === 'string' && typeof value === 'function' && MUTATION_OPERATIONS.has(property)) {
        return (args: Record<string, unknown> = {}) => auditMutation(
          runtime,
          model,
          property,
          args,
          (nextArgs) => value.call(target, nextArgs) as Promise<unknown>,
        );
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function isDelegate(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  return [...MUTATION_OPERATIONS].some((operation) => typeof (value as Record<string, unknown>)[operation] === 'function');
}

function modelDelegate(client: PrismaRuntimeClient, model: string): Record<string, unknown> {
  const property = lowerFirst(model);
  const delegate = client[property];
  if (!isDelegate(delegate)) {
    fail(`could not find the ${model} delegate at client.${property}`);
  }
  return delegate;
}

function modelName(options: PrismaActivityLogOptions, delegateProperty: string): string {
  return Object.keys(options.models ?? {}).find((name) => lowerFirst(name) === delegateProperty)
    ?? `${delegateProperty.charAt(0).toUpperCase()}${delegateProperty.slice(1)}`;
}

function isNestedWrite(args: Record<string, unknown>, operation: string, config: PrismaModelConfig): boolean {
  const sources = operation === 'upsert' ? [args.create, args.update] : [args.data];
  return sources.some((source) => {
    if (!isRecord(source)) return false;
    return (config.relationFields ?? []).some((field) => {
      const nested = source[field];
      return isRecord(nested) && Object.keys(nested).some((key) => RELATION_OPERATIONS.has(key));
    });
  });
}

function aggregateChanges(operation: string, args: Record<string, unknown>): unknown {
  if (operation === 'upsert') return { create: args.create, update: args.update };
  if (operation === 'createMany' || operation === 'createManyAndReturn') {
    return args.skipDuplicates === undefined
      ? { data: args.data }
      : { data: args.data, skipDuplicates: args.skipDuplicates };
  }
  return args.data ?? {};
}

function affectedCount(operation: string, result: unknown): number {
  if (operation.endsWith('AndReturn')) {
    if (!Array.isArray(result)) fail(`${operation} returned a non-array result`);
    return result.length;
  }
  if (INDIVIDUAL_OPERATIONS.has(operation)) return 1;
  const count = isRecord(result) ? result.count : undefined;
  if (typeof count !== 'number') fail(`${operation} returned an invalid count`);
  return count;
}

function eventFor(operation: string): ActivityEvent {
  if (operation.startsWith('create')) return 'created';
  if (operation.startsWith('delete')) return 'deleted';
  return 'updated';
}

function validateIdentitySelection(args: Record<string, unknown>, idField: string): void {
  const select = args.select;
  const omit = args.omit;
  if ((isRecord(select) && select[idField] !== true) || (isRecord(omit) && omit[idField] === true)) {
    fail(`requires "${idField}" in mutation results`);
  }
}

function validateOptions(options: PrismaActivityLogOptions): void {
  const hasStore = 'store' in options && options.store !== undefined;
  const hasDialect = 'dialect' in options && options.dialect !== undefined;
  if (hasStore === hasDialect) fail('requires exactly one of dialect or store');
  if (hasDialect && !['sqlite', 'postgres', 'mysql'].includes(options.dialect as string)) {
    fail(`does not support dialect "${String(options.dialect)}"`);
  }
  if ((options as { lockForDiff?: boolean }).lockForDiff === true) {
    fail('does not support lockForDiff; use auditedTransaction and database transaction isolation');
  }
  for (const [model, config] of Object.entries(options.models ?? {})) {
    if (model.length === 0 || (config.idField !== undefined && config.idField.length === 0)) {
      fail('model names and idField values must not be empty');
    }
    if ((config.relationFields ?? []).some((field) => field.length === 0)) {
      fail('relationFields values must not be empty');
    }
    if ((config.auditFields ?? []).some((field) => field.length === 0)) {
      fail('auditFields values must not be empty');
    }
  }
}

function createPrismaDataSource(client: PrismaRuntimeClient, dialect: NonNullable<PrismaActivityLogOptions['dialect']>): SqlDataSource {
  return { dialect, execute: createPrismaExecutor(client).execute };
}

function createPrismaExecutor(client: PrismaRuntimeClient): TransactionRef {
  if (typeof client.$queryRawUnsafe !== 'function' || typeof client.$executeRawUnsafe !== 'function') {
    fail('requires $queryRawUnsafe() and $executeRawUnsafe()');
  }
  return {
    execute: async (sql, params = []) => {
      if (/^\s*(select|pragma|with)\b/i.test(sql)) {
        const rows = await client.$queryRawUnsafe?.(sql, ...params);
        return Array.isArray(rows) ? rows as SqlRow[] : [];
      }
      const affectedRows = await client.$executeRawUnsafe?.(sql, ...params);
      return [{ affectedRows: affectedRows ?? 0 }];
    },
  };
}

function scopedStore(store: ActivityStore, transaction?: TransactionRef): ActivityStore {
  if (transaction === undefined) return store;
  return {
    persist: (activities: readonly NewActivity[]) => store.persist(activities, transaction),
    query: (filter) => store.query(filter),
    prune: (olderThan, logName) => store.prune(olderThan, logName),
  };
}

function asRuntimeClient(value: object): PrismaRuntimeClient {
  return value as PrismaRuntimeClient;
}

function activityId(value: unknown): ActivityId {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') return value;
  fail('could not resolve a supported single-field identity');
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) fail('received a non-object record');
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function lowerFirst(value: string): string {
  return `${value.charAt(0).toLowerCase()}${value.slice(1)}`;
}

function fail(message: string): never {
  throw new Error(`activitylog: Prisma adapter ${message}`);
}
