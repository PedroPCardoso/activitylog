# 03 — Forma TS completa de LogOptions

Type: grilling
Status: open
Blocked by: none

## Question

Definir a interface `LogOptions` (paridade Spatie + extensões já decididas): `logOnly`/`logExcept`/`logOnlyDirty`/`dontSubmitEmptyLogs`/`useLogName`/`descriptionForEvent(fn)`/`redact` + o hook `beforePersist` (D16) + `lockForDiff` (D8) + `tableName`/`store` custom (D13). Perguntas afiadas: `logOnly` e `logExcept` são mutuamente exclusivos ou compõem? `descriptionForEvent` recebe o quê (event, subject, diff)? Como as options se resolvem na precedência **chamada > forFeature > forRoot > default** (contrato do metrics) combinada com o `@LogsActivity(options)` por entidade? Bloqueia o build do adapter TypeORM.
