# 01 — Profundidade da tipagem da Query API

Type: grilling
Status: open
Blocked by: none

## Question

Quão tipada é a `activityQuery()`? Os scopes sobre colunas fixas (`inLog`/`causedBy`/`forSubject`/`forEvent`/`forBatch`/`between`) são naturalmente tipáveis. A pergunta é o filtro **dentro de `properties`** (JSON dinâmico): é tipável a partir de um genérico do subject, ou fica como filtro string livre (`whereProperty('plan', 'pro')`) sem garantia estática? Definir também: paginação (cursor vs offset), retorno tipado de `Activity`, e como a query API se comporta contra stores não-SQL no futuro (declarar limite, não fingir).
