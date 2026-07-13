import { UnsupportedActivityFilterException } from '../exceptions/unsupported-filter.exception';
import { dialectFor } from '../sql/sql-dialect';
import { assertSafeIdentifier } from '../sql/validation';
import { mapActivityRow } from './activity-row.mapper';
import type { Activity, NewActivity } from '../types/activity.types';
import type { ActivityFilter } from '../types/query.types';
import type { ActivityStore, TransactionRef } from '../types/store.types';
import type { SqlDataSource, SqlRow } from '../sql/datasource.types';

const DEFAULT_TABLE_NAME = 'activity_log';
const COLUMNS = [
  'id',
  'log_name',
  'description',
  'subject_type',
  'subject_id',
  'causer_type',
  'causer_id',
  'event',
  'properties',
  'batch_uuid',
  'created_at',
] as const;

export interface SqlExecutorStoreOptions {
  dataSource: SqlDataSource;
  tableName?: string;
}

export class SqlExecutorStore implements ActivityStore {
  private readonly tableName: string;

  constructor(private readonly options: SqlExecutorStoreOptions) {
    this.tableName = options.tableName ?? DEFAULT_TABLE_NAME;
    assertSafeIdentifier(this.tableName);
  }

  async persist(activities: readonly NewActivity[], ctx?: TransactionRef): Promise<void> {
    const executor = ctx ?? this.options.dataSource;

    for (const activity of activities) {
      const { sql, params } = this.insertStatement(activity);
      await executor.execute(sql, params);
    }
  }

  async query(filter: ActivityFilter): Promise<readonly Activity[]> {
    const { sql, params } = this.selectStatement(filter);
    const rows = await this.options.dataSource.execute(sql, params);
    return rows.map(mapActivityRow);
  }

  async prune(olderThan: Date, logName?: string): Promise<number> {
    const dialect = dialectFor(this.options.dataSource.dialect);
    const params: unknown[] = [timestampValue(olderThan, this.options.dataSource.dialect)];
    const clauses = [`${quote(dialect, 'created_at')} < ${dialect.placeholder(params.length)}`];

    if (logName !== undefined) {
      params.push(logName);
      clauses.push(`${quote(dialect, 'log_name')} = ${dialect.placeholder(params.length)}`);
    }

    const rows = await this.options.dataSource.execute(
      `DELETE FROM ${this.quotedTable()} WHERE ${clauses.join(' AND ')}`,
      params,
    );
    return affectedRows(rows);
  }

  private insertStatement(activity: NewActivity): { sql: string; params: readonly unknown[] } {
    const dialect = dialectFor(this.options.dataSource.dialect);
    const columns = activity.id === undefined ? COLUMNS.slice(1) : COLUMNS;
    const params = columns.map((column) => activityValue(activity, column, this.options.dataSource.dialect));
    const placeholders = columns.map((_, index) => dialect.placeholder(index + 1));

    return {
      sql: `INSERT INTO ${this.quotedTable()} (${columns.map((column) => quote(dialect, column)).join(', ')}) VALUES (${placeholders.join(', ')})`,
      params,
    };
  }

  private selectStatement(filter: ActivityFilter): { sql: string; params: readonly unknown[] } {
    if (filter.properties !== undefined) {
      throw new UnsupportedActivityFilterException('properties');
    }
    if (filter.cursor !== undefined) {
      throw new UnsupportedActivityFilterException('cursor');
    }

    const dialect = dialectFor(this.options.dataSource.dialect);
    const params: unknown[] = [];
    const clauses: string[] = [];
    const add = (column: string, value: unknown): void => {
      params.push(value);
      clauses.push(`${quote(dialect, column)} = ${dialect.placeholder(params.length)}`);
    };

    if (filter.logName !== undefined) add('log_name', filter.logName);
    if (filter.subject !== undefined) {
      add('subject_type', filter.subject.type);
      if (filter.subject.id !== undefined) add('subject_id', String(filter.subject.id));
    }
    if (filter.causer !== undefined) {
      add('causer_type', filter.causer.type);
      if (filter.causer.id !== undefined) add('causer_id', String(filter.causer.id));
    }
    if (filter.event !== undefined) add('event', filter.event);
    if (filter.batchUuid !== undefined) add('batch_uuid', filter.batchUuid);
    if (filter.from !== undefined) addRange(clauses, params, dialect, 'created_at', '>=', filter.from);
    if (filter.to !== undefined) addRange(clauses, params, dialect, 'created_at', '<=', filter.to);

    const order = filter.sort === 'asc' ? 'ASC' : 'DESC';
    const where = clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`;
    const limit = filter.limit === undefined ? '' : ` LIMIT ${appendParam(params, dialect, filter.limit)}`;
    const selectColumns = COLUMNS.map((column) => quote(dialect, column)).join(', ');

    return {
      sql: `SELECT ${selectColumns} FROM ${this.quotedTable()}${where} ORDER BY ${quote(dialect, 'created_at')} ${order}, ${quote(dialect, 'id')} ${order}${limit}`,
      params,
    };
  }

  private quotedTable(): string {
    return dialectFor(this.options.dataSource.dialect).escapeIdentifier(this.tableName);
  }
}

function addRange(
  clauses: string[],
  params: unknown[],
  dialect: ReturnType<typeof dialectFor>,
  column: string,
  operator: '>=' | '<=',
  value: Date,
): void {
  params.push(value.toISOString());
  clauses.push(`${quote(dialect, column)} ${operator} ${dialect.placeholder(params.length)}`);
}

function appendParam(params: unknown[], dialect: ReturnType<typeof dialectFor>, value: unknown): string {
  params.push(value);
  return dialect.placeholder(params.length);
}

function quote(dialect: ReturnType<typeof dialectFor>, identifier: string): string {
  return dialect.escapeIdentifier(identifier);
}

function activityValue(
  activity: NewActivity,
  column: (typeof COLUMNS)[number],
  dialect: SqlDataSource['dialect'],
): unknown {
  switch (column) {
    case 'id':
      return activity.id;
    case 'log_name':
      return activity.logName;
    case 'description':
      return activity.description;
    case 'subject_type':
      return activity.subject?.type ?? null;
    case 'subject_id':
      return activity.subject === null ? null : String(activity.subject?.id);
    case 'causer_type':
      return activity.causer?.type ?? null;
    case 'causer_id':
      return activity.causer === null ? null : String(activity.causer?.id);
    case 'event':
      return activity.event;
    case 'properties':
      return JSON.stringify(activity.properties);
    case 'batch_uuid':
      return activity.batchUuid;
    case 'created_at':
      return timestampValue(activity.createdAt, dialect);
  }
}

function timestampValue(value: Date, dialect: SqlDataSource['dialect']): string {
  const iso = value.toISOString();
  return dialect === 'mysql' ? `${iso.slice(0, -1).replace('T', ' ')}` : iso;
}

function affectedRows(rows: readonly SqlRow[]): number {
  const result = rows[0];
  const value = result?.affectedRows ?? result?.rowCount ?? result?.changes ?? 0;
  return typeof value === 'number' ? value : Number(value);
}
