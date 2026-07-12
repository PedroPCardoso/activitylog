# activitylog

Trilha de auditoria de entidades, agnóstica de ORM, com a DX do spatie/laravel-activitylog. O core não conhece nenhum ORM nem o NestJS.

## Language

**Activity**:
Um registro imutável de que algo aconteceu com uma entidade — o quê, quem causou, quando e o diff. Uma linha na trilha de auditoria.
_Avoid_: Log, event (ver abaixo), audit entry.

**Subject**:
A entidade sobre a qual a atividade aconteceu (`performedOn`). Referenciada por `subject_type` + `subject_id`.
_Avoid_: Target, model, entity.

**Causer**:
Quem provocou a atividade (`causedBy`) — normalmente o usuário autenticado, resolvido do contexto. Referenciado por `causer_type` + `causer_id`.
_Avoid_: Actor, user, author.

**Type** (subject_type / causer_type):
Etiqueta de identidade **opaca** — uma string que o core nunca interpreta. Default = nome da classe/entidade, sobreponível por um Morph map. Guarda a *identidade* de um tipo sem o core conhecer o tipo.
_Avoid_: Class, table, model name.

**Morph map**:
Mapa string↔entidade que o usuário registra para controlar quais valores aparecem em `*_type` (paridade com o `morphMap` do Spatie). Mantém a persistência estável mesmo que a classe seja renomeada.
_Avoid_: Type registry, alias table.

**Reference** (SubjectRef / CauserRef):
O par tipado `(type, id)` que o código passa (`subjectRef('Order', id)`). No TS é genérico; ao persistir vira `type: string` + `id: varchar` (id stringificado, universal para bigint/uuid/string). PK composta está fora de escopo no v0.
_Avoid_: Pointer, handle, key.

**Event**:
O verbo da atividade (`created`/`updated`/`deleted`/custom). É um campo da Activity, NÃO um evento de domínio publicado.
_Avoid_: Action, type.

**Log name**:
O canal/bucket ao qual a atividade pertence (`default`, `billing`, ...). Particiona a trilha por assunto operacional.
_Avoid_: Channel, category, namespace.

**Batch**:
Um agrupamento de atividades geradas na mesma unidade de trabalho lógica, compartilhando um `batch_uuid`.
_Avoid_: Group, transaction (batch ≠ transação de banco).

**Diff**:
O par `{ attributes, old }` gravado em `properties` — o estado novo e o antigo dos campos observados.
_Avoid_: Delta, change, patch.

**Old**:
Em `properties.old`, "old" = a linha **visível na nossa transação imediatamente antes do nosso UPDATE** — não "o estado global imediatamente anterior". Sem lock por default (paridade com o `original` em memória do Eloquent). Sob concorrência, o old pode estar defasado; `lockForDiff: true` é opt-in para exatidão.
_Avoid_: Previous, before, original state.

**Aggregate activity**:
Uma Activity única representando uma operação em massa (`updateMany`, nested writes): `subject_id = null`, `subject_type` = o model, `properties = { aggregate: true, criteria, changes, affected }`, **sem** `old`. Nunca expandida em N linhas por default.
_Avoid_: Bulk log, batch (batch é outra coisa — ver Batch).

**Store**:
O destino onde as atividades são persistidas (`ActivityStore`). O "onde grava".
_Avoid_: Repository, sink, backend.

**Redaction**:
Mascaramento de campos sensíveis (senha, token, PII) **antes** de a atividade tocar a store ou qualquer log. Deny-by-default: lista de nomes embutida, deep, case-insensitive, sobreponível; valor vira `'[REDACTED]'` mantendo a chave. Fail secure.
_Avoid_: Masking, filtering, scrubbing.

## Invariants

**iff-committed** — Uma Activity persiste **se e somente se** a mutação que a causou commitou, **sempre que a mutação for transacional**. Uma trilha de auditoria confiável vale mais que throughput. Fora de transação (caminho manual `activity().log()`, mutações fire-and-forget) a garantia degrada para best-effort. O modo async-outbox (opt-in) enfraquece iff para "eventualmente, a menos que o outbox se perca".
