# 02 — created_at, timezone e ordenação cronológica

Type: grilling
Status: open
Blocked by: none

## Question

Como `created_at` é gravado e ordenado? Gravar sempre em UTC (recomendado)? Quem gera o timestamp — o banco (`DEFAULT now()`) ou a aplicação (para consistência com o momento lógico da mutação dentro da tx)? Sob concorrência, a ordem de inserção ≠ ordem de commit; a ordenação cronológica estável usa `created_at` + `id` como tiebreak? Precisão (segundos vs milissegundos vs microssegundos por dialeto — SQLite não tem tipo nativo)? Decisão alimenta o schema/migrations do build do core.
