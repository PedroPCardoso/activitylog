import type { SupportedDialect } from './datasource.types';

export interface SqlDialect {
  placeholder(index: number): string;
  escapeIdentifier(identifier: string): string;
}

class StandardDialect implements SqlDialect {
  constructor(
    private readonly quote: '"' | '`',
    private readonly placeholders: 'numbered' | 'anonymous',
  ) {}

  placeholder(index: number): string {
    return this.placeholders === 'numbered' ? `$${index}` : '?';
  }

  escapeIdentifier(identifier: string): string {
    return identifier
      .split('.')
      .map((part) => `${this.quote}${part.replaceAll(this.quote, this.quote.repeat(2))}${this.quote}`)
      .join('.');
  }
}

const DIALECTS: Record<SupportedDialect, SqlDialect> = {
  postgres: new StandardDialect('"', 'numbered'),
  mysql: new StandardDialect('`', 'anonymous'),
  sqlite: new StandardDialect('"', 'anonymous'),
};

export function dialectFor(dialect: SupportedDialect): SqlDialect {
  return DIALECTS[dialect];
}
