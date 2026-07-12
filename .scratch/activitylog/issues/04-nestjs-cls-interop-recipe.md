# 04 — Receita concreta de interop com nestjs-cls

Type: prototype
Status: open
Blocked by: none

## Question

D5 decidiu: activitylog é dono da própria ALS; nestjs-cls é só receita de interop, sem acoplamento. Falta a **receita concreta** — um snippet pequeno pra reagir: como copiar o `user`/causer de uma app que já usa nestjs-cls para a ALS do activitylog no middleware, sem duas fontes de verdade e sem abrir duas vezes o contexto. Prototipar o middleware/setup mínimo e a doc "se você já usa nestjs-cls, faça assim". Também: o que acontece se ambos rodam (custo de dois ALS)?
