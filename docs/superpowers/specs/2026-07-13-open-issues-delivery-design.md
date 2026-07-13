# Open Issues Delivery Design

## Goal

Concluir todas as issues ainda não executadas do repositório, publicar as versões
0.1 e 0.2 previstas no mapa, encerrar os metatickets somente quando o destino
estiver comprovadamente atingido e transformar o processo em uma skill
reutilizável.

## Scope

As issues acionáveis são `#6`, `#7` e `#14` a `#19`. As issues `#1` e `#2`
são metatickets: não geram implementação independente e só devem ser encerradas
depois que todas as entregas filhas e publicações estiverem concluídas.

O trabalho permanece na branch Conductor atual
`executar-issues-e-criar-prs`, sem renomeá-la. A branch será reutilizada de forma
sequencial: depois de cada merge, ela será atualizada para o novo `origin/main`
antes de receber a próxima entrega.

## Delivery Sequence

1. `#14` — implementar o módulo NestJS, façade, precedência de opções e abertura
   antecipada do contexto com resolução lazy do causer.
2. `#6` — documentar e provar a receita de interop com `nestjs-cls` sobre a API
   real entregue por `#14`, sem transformar `nestjs-cls` em dependência.
3. `#15` — implementar `@LogsActivity`, subscriber TypeORM e diff observável em
   `save`, `remove` e `softRemove`.
4. `#16` — implementar `auditedUpdate` e publicar a matriz honesta de cobertura
   do adapter TypeORM.
5. `#17` — adicionar o consumer smoke NestJS, preparar Changesets, publicar
   `activitylog-core` e `activitylog-nestjs` 0.1 e verificar os pacotes
   instalando-os como um consumidor real.
6. `#7` — congelar a decisão de dialeto e o mapeamento bulk/nested do Prisma
   antes da implementação do adapter.
7. `#18` — implementar `$extends` best-effort, `auditedTransaction`
   iff-committed, rollback e Aggregate activities.
8. `#19` — adicionar o consumer smoke Prisma, publicar
   `activitylog-nextjs` 0.2 e verificar o pacote publicado.
9. Encerrar `#1` e `#2` somente depois que os pacotes e os smokes públicos
   satisfizerem o destino do mapa.
10. Criar e validar uma skill pessoal que execute o mesmo fluxo
    issue → teste → PR → CI → merge em trabalhos futuros.

## Pull Request Model

Cada issue acionável recebe um PR próprio com `Closes #N`. O PR contém apenas a
entrega daquela issue e a documentação ou Changeset indispensável a ela. PRs
dependentes só começam depois que o PR anterior foi mergeado e a branch local
foi reconciliada com `origin/main`.

Todo PR nasce pronto para revisão, pois o usuário autorizou explicitamente o
ciclo completo até o merge. Antes do merge, devem estar satisfeitos:

- diff revisado contra `origin/main`;
- testes locais relevantes e suíte de validação do repositório aprovados;
- checks obrigatórios do GitHub concluídos com sucesso;
- ausência de conflito e estado de merge permitido pelo GitHub.

Falhas de CI devem ser diagnosticadas pelos logs da execução. A correção deve
ser mínima, testada localmente, enviada ao mesmo PR e novamente aguardada. Um
check externo sem logs disponíveis deve ser reportado com seu link; ele não pode
ser declarado resolvido por inferência.

## Implementation Boundaries

As APIs públicas e decisões D1–D20 existentes são a fonte arquitetural. Cada
implementação deve manter:

- `activitylog-core` agnóstico de NestJS e ORM;
- core compartilhado e externalizado nos pacotes leaf;
- pipeline `diff → beforePersist → redaction → persist`;
- redaction deny-by-default;
- SQL parametrizado e identificadores validados;
- garantia iff-committed apenas onde a mesma transação viva é comprovável;
- documentação explícita de caminhos best-effort e lacunas de cobertura.

O adapter NestJS deve resolver opções na ordem chamada > feature > root >
default. O middleware abre a ALS cedo e registra uma referência à request; o
causer é resolvido no momento do log, depois que guards puderam preencher
`request.user`.

O adapter TypeORM observa apenas operações suportadas de forma confiável pelo
subscriber. `auditedUpdate` cobre `.update()` e QueryBuilder por re-read, diff,
mutação e persistência dentro da mesma transação explícita.

O adapter Prisma deve exigir dialeto explícito quando usar a store SQL, porque o
client não oferece introspecção portátil do provider. Operações top-level
create/update/delete/upsert recebem atividades individuais; bulk e nested writes
recebem uma Aggregate activity por operação top-level, sem fabricar diff por
linha. A decisão detalhada será registrada em `#7` antes do adapter.

## Testing Strategy

O trabalho seguirá ciclos test-first nos seams públicos. Os testes dirigem os
entrypoints exportados, executam operações reais e observam Activities
persistidas ou erros públicos. Eles não devem acoplar-se a chamadas internas do
DiffEngine ou à representação privada da ALS.

Por PR, a validação mínima inclui o teste focal que falhou antes da
implementação, a suíte afetada, `npm run typecheck`, `npm run lint`, `npm test` e
`npm run build`. SQLite em memória é obrigatório; PostgreSQL e MySQL permanecem
gated pelas variáveis existentes. Os PRs de release também executam pack/dry-run
e instalam os tarballs em apps consumidores reais antes da publicação.

O core deve manter cobertura de pelo menos 85%. Caso a configuração de coverage
ainda não torne esse requisito executável no CI, a primeira entrega que alterar
o core deverá incluir a medição necessária sem reduzir a suíte existente.

## Release and External State

As publicações são mudanças externas autorizadas pelo pedido de concluir `#17`
e `#19`. O release permanece two-phase via Changesets e com provenance.

Na auditoria inicial, os nomes dos três pacotes estavam disponíveis, mas não
havia autenticação npm local nem `NPM_TOKEN` configurado no repositório. O
desenvolvimento e os PRs podem avançar até o release. A publicação só pode
prosseguir depois que o usuário configurar um token npm no secret `NPM_TOKEN`
ou migrar o workflow para trusted publishing e concluir a configuração exigida
no npm. A ausência dessa credencial deve ser tratada como bloqueio explícito,
nunca como sucesso parcial da issue de release.

## Skill Deliverable

Depois do encerramento das issues, criar uma skill pessoal auto-descoberta pelo
Codex. Ela deve orientar a descoberta de issues não executadas, dependências,
isolamento de escopo, TDD, validação, publicação de PR, acompanhamento de CI,
diagnóstico de falhas, merge e encerramento de metatickets. A skill deve preservar
guardrails para alterações externas, branches Conductor e mudanças locais do
usuário, e deve ser validada pelo validador oficial de skills.
