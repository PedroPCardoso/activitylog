import Database from 'better-sqlite3';

import type { SqlDataSource, SqlRow } from 'activitylog-core';

export interface SqliteTestDatabase {
  database: Database.Database;
  dataSource: SqlDataSource;
}

export function createSqliteTestDatabase(): SqliteTestDatabase {
  const database = new Database(':memory:');

  return {
    database,
    dataSource: {
      dialect: 'sqlite',
      execute: async (sql, params = []) => {
        const statement = database.prepare(sql);

        if (/^\s*(select|pragma)/i.test(sql)) {
          return statement.all(...params) as SqlRow[];
        }

        const result = statement.run(...params);
        return [{ affectedRows: result.changes, lastInsertRowid: result.lastInsertRowid }];
      },
    },
  };
}

export function createSqliteActivityLogSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      log_name TEXT NOT NULL,
      description TEXT NOT NULL,
      subject_type TEXT,
      subject_id TEXT,
      causer_type TEXT,
      causer_id TEXT,
      event TEXT,
      properties TEXT NOT NULL,
      batch_uuid TEXT,
      created_at TEXT NOT NULL
    );
  `);
}
