import { createConnection } from 'mysql2/promise';
import { Client } from 'pg';

import type { SqlDataSource, SqlRow, SupportedDialect } from 'activitylog-core';

export interface ExternalSqlDataSource extends SqlDataSource {
  close(): Promise<void>;
}

export function availableExternalDialects(): SupportedDialect[] {
  const dialects: SupportedDialect[] = [];

  if (process.env.PG_HOST) dialects.push('postgres');
  if (process.env.MYSQL_HOST) dialects.push('mysql');

  return dialects;
}

export async function createExternalSqlDataSource(dialect: Exclude<SupportedDialect, 'sqlite'>): Promise<ExternalSqlDataSource> {
  if (dialect === 'postgres') {
    const client = new Client({
      host: process.env.PG_HOST,
      port: Number(process.env.PG_PORT ?? '5432'),
      user: process.env.PG_USER,
      password: process.env.PG_PASSWORD,
      database: process.env.PG_DATABASE,
    });
    await client.connect();

    return {
      dialect,
      execute: async (sql, params = []) => {
        const result = await client.query(sql, [...params]);
        return ('rows' in result ? result.rows : []) as SqlRow[];
      },
      close: async () => client.end(),
    };
  }

  const connection = await createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT ?? '3306'),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    timezone: 'Z',
    multipleStatements: true,
  });

  return {
    dialect,
    execute: async (sql, params = []) => {
      const [rows] = await connection.query(sql, [...params]);
      return (Array.isArray(rows) ? rows : [rows]) as SqlRow[];
    },
    close: async () => connection.end(),
  };
}
