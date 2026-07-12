# 05 — Prisma: dialeto da store + estratégia bulk/nested

Type: grilling
Status: open
Blocked by: none

## Question

Dois pontos do adapter Prisma (0.2), entrelaçados:

1. **Dialeto:** D2 diz que a store emite SQL parametrizado via o executor da tx (`tx.$executeRawUnsafe`). Mas o Prisma **não introspecta o próprio dialeto** (diferente do Drizzle). Como a store aprende se é pg/mysql/sqlite para gerar o `INSERT` certo — o usuário passa `dialect` explicitamente (como no `nextjs-metrics`)? Ou o adapter Prisma escreve via API nativa (`tx.activity.create`) em vez de SQL, contornando a questão de dialeto? (Reabre a tensão Caminho A × B só para o Prisma.)

2. **Bulk/nested:** D9 fixou o formato do agregado (`subject_id=null` + criteria/changes/affected). Falta o mapeamento **por operação Prisma**: `updateMany`/`deleteMany` → 1 agregado com `where`; nested writes (`create` com `connectOrCreate`/nested `update`) → agregado por operação top-level ou decompor? O que é `criteria`/`changes` em cada caso?
