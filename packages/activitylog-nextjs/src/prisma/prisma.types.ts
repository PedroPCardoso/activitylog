import type { ActivityStore, LogOptions, SupportedDialect } from 'activitylog-core';

export interface PrismaModelConfig {
  idField?: string;
  relationFields?: readonly string[];
  auditFields?: readonly string[];
}

export type PrismaModelMap = Record<string, PrismaModelConfig>;

type DistributiveOmit<Type, Keys extends PropertyKey> = Type extends unknown ? Omit<Type, Keys> : never;

type PrismaAdapterBaseOptions = DistributiveOmit<LogOptions, 'store' | 'tableName' | 'lockForDiff'> & {
  models?: PrismaModelMap;
  now?: () => Date;
  lockForDiff?: false;
};

export type PrismaActivityLogOptions = PrismaAdapterBaseOptions & (
  | {
      dialect: SupportedDialect;
      store?: never;
      storeTransactionMode?: never;
      tableName?: string;
    }
  | {
      store: ActivityStore;
      storeTransactionMode?: 'none' | 'uses-context';
      dialect?: never;
      tableName?: never;
    }
);

type PrismaTransactionMethods =
  | '$connect'
  | '$disconnect'
  | '$on'
  | '$transaction'
  | '$use'
  | '$extends';

export type AuditedPrismaTransactionClient<Client extends object> = Omit<Client, PrismaTransactionMethods>;
