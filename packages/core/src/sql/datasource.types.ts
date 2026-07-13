export type SupportedDialect = 'sqlite' | 'postgres' | 'mysql';

export type SqlRow = Record<string, unknown>;

export interface SqlExecutor {
  execute(sql: string, params?: readonly unknown[]): Promise<readonly SqlRow[]>;
}

export interface SqlDataSource extends SqlExecutor {
  dialect: SupportedDialect;
}
