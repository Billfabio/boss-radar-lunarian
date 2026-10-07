# Boss Knowledge Graph & Temporal Intelligence Engine

## Objetivo

Esta camada transforma o histórico validado do Boss Radar em uma estrutura temporal de conhecimento. O objetivo não é afirmar causalidade, e sim descobrir associações, sequências e estados de servidor que possam gerar hipóteses mensuráveis para o AI Lab.

Fluxo governado:

EVENTOS → RELAÇÕES → SEQUÊNCIAS → HIPÓTESES → BACKTEST TEMPORAL → WALK-FORWARD/HOLDOUT → SHADOW → QUALITY GATE → CANARY → FEATURE ACTIVE.

Regra principal: descobrir uma relação não significa que ela é útil.

## Arquitetura

A implementação reaproveita o storage persistente, PostgreSQL readiness, Canonical Events, Discovery Engine, Investigation Engine, Feature Store, MLOps Registry e AI Lab existentes.

Não foi introduzido Neo4j nem outro banco de grafos. A carga atual pode ser representada com registries versionados, tabelas relacionais e estruturas tipadas. Uma tecnologia especializada só deve ser avaliada se volume, consultas ou custo operacional demonstrarem necessidade real.

Migration: `database/migrations/008_knowledge_graph.sql`.

## Modelo temporal e bitemporal

O sistema mantém distinção entre:

- `event_time`: quando o acontecimento ocorreu;
- `available_at`: quando a informação estava disponível ao Boss Radar;
- versões dos Canonical Events;
- versões das relações;
- snapshots de estado capturados como conhecidos naquele instante.

Features e backtests só usam registros com `available_at <= asOf`.

Correções posteriores não reescrevem silenciosamente o passado conhecido. Consultas `as-known-at` selecionam a versão da relação disponível até o instante consultado.

## Relationship Registry

Relações boss → boss são testadas em janelas:

- 0–1h;
- 1–3h;
- 3–6h;
- 6–12h;
- 12–24h;
- 24–48h;
- 48–72h.

Cada relação registra:

- source/target;
- janela;
- sample size;
- support;
- baseline samples;
- baseline probability;
- conditional probability;
- lift;
- Wilson CI;
- p-value;
- FDR q-value;
- direção positiva/negativa;
- P25/mediana/P75 do atraso;
- recent strength;
- previous strength;
- drift score;
- quality score;
- event lineage;
- valid_from / valid_until;
- last_validated;
- versões históricas.

Status:

DISCOVERED, TESTING, VALIDATED, REJECTED, ACTIVE, DEGRADED e ARCHIVED.

## Baseline e false discovery

O sistema não considera útil apenas P(B|A). Ele compara P(B|A) com P(B) em janelas observáveis equivalentes.

Negativos só são criados quando existe cobertura contínua verificada. Ausência de mensagem ou ausência de confirmação não é tratada automaticamente como ausência de spawn.

Testes múltiplos usam Benjamini-Yekutieli/FDR. Relações pequenas ou sem suporte ficam como amostra insuficiente ou rejeitadas.

## Sequence Mining

O Discovery Engine registra sequências A→B e A→B→C com ocorrência, probabilidade observada quando aplicável e distribuição de atrasos. Elas permanecem descritivas e não são promovidas diretamente para produção.

Sequência não implica causalidade.

## Source Relationship Graph

A camada reaproveita proveniência temporal de evidências para medir:

- ordem de publicação;
- conteúdo idêntico;
- número de pares observados;
- copy-evidence rate;
- lag médio/mediano;
- confiança;
- possível dependência.

Dependências continuam sujeitas à governança existente de fontes; nenhuma relação de fonte é ativada automaticamente.

## Reporter Relationship Graph

O Investigation Engine também produz um grafo comunitário estritamente pseudonimizado.

Ele utiliza somente informações necessárias para avaliar independência da evidência:

- reporter hash truncado para exibição;
- ordem temporal entre reports;
- coocorrência em casos;
- similaridade por hash de conteúdo normalizado;
- lag médio/mediano;
- bosses associados aos casos;
- tamanho da amostra.

Quando há suporte suficiente, uma aresta pode ser marcada como `PROPAGATION_CANDIDATE`. Isso significa somente que existe um padrão temporal compatível com propagação de informação; não prova cópia, coordenação intencional ou causalidade.

Nenhum peso de produção é aplicado automaticamente e nenhum dado pessoal adicional é criado.

## Server State

Snapshots de estado incluem, quando conhecidos naquele instante:

- último boss;
- horas desde último evento;
- bosses nas últimas 1h/3h/6h/12h/24h;
- bosses distintos em 24h;
- últimos bosses;
- horas desde Server Save configurado;
- quantidade de fontes recentes;
- contexto/regime conhecido.

Backfill é feito em lotes para não competir com produção.

## Novel State e estados semelhantes

O Temporal Intelligence Engine calcula uma representação determinística do estado atual e compara com snapshots históricos.

Saídas:

- `state_novelty_score`;
- KNOWN_STATE / NOVEL_STATE / INSUFFICIENT_HISTORY;
- estados históricos mais semelhantes;
- similaridade;
- eventos e timestamps correspondentes.

Existe também um **Novel State confidence guard** de confiabilidade. Ele só pode atuar quando há pelo menos 10 estados históricos comparáveis e o estado é classificado como `NOVEL_STATE`.

Esse guardrail:

- não altera `predictedAt`;
- não desloca a janela prevista;
- não cria probabilidade de spawn;
- apenas aplica um limite conservador à confiança;
- registra score, sample size, melhor similaridade, cap e ajuste;
- aparece na explicação da previsão e na Central de Confiabilidade.

Com `INSUFFICIENT_HISTORY`, nenhuma penalização é aplicada. A redução é tratada como guardrail de incerteza, não como recalibração estatística ou evidência causal.

## Graph Feature Store

Feature Store: versão 1.2.0.

Sinais adicionados:

- bossesLast6h;
- bossesLast12h;
- bossesLast24h;
- uniqueBossesLast24h;
- relatedBossHoursAgo;
- relatedBossAfterLastTarget.

Cada Graph Feature possui status:

DISCOVERED → TESTING → VALIDATED → ACTIVE

ou REJECTED.

Somente ACTIVE é elegível para produção.

O dataset MLOps guarda também `contextEvents`, garantindo reprodutibilidade e auditoria do contexto cross-boss.

## Integração com AI Lab

Relações promissoras geram hipóteses `UNVALIDATED_HYPOTHESIS`, ranqueadas por suporte, lift, estabilidade e quality score.

O AI Lab possui um Challenger específico:

`graph_context_interval`

Ele só roda quando existe configuração explícita da relação:

- sourceBoss;
- target boss;
- window;
- median delay;
- graphWeight;
- relationId;
- featureId.

Sem configuração válida ele se abstém.

Ciclo:

1. relação descoberta;
2. feature DISCOVERED;
3. sugestão para AI Lab;
4. backtest temporal com dataset cross-boss;
5. leakage audit;
6. Shadow;
7. feature TESTING;
8. Live Shadow + Quality Gate;
9. feature VALIDATED;
10. aprovação humana;
11. Canary;
12. se concluído: feature ACTIVE;
13. regressão: REJECTED/rollback.

`auto_model_promotion` continua false.

## Forecast Context Snapshot

Quando um modelo graph-context é utilizado em Canary/Champion promovido, a previsão persiste:

- featureId;
- relationId;
- sourceBoss;
- relatedBossHoursAgo;
- relatedBossAfterLastTarget;
- graphApplied;
- graphTargetHours.

Isso permite explicar e reproduzir o contexto.

## Relationship Drift

O registry compara força recente e anterior. Uma relação validada/ativa com mudança material pode virar DEGRADED.

Relações degradadas não devem ser tratadas como sinal estável sem revalidação.

## Change Points e Clusters

A implementação reaproveita o detector de breakpoints e clustering já existente no Discovery Engine. Breakpoints próximos a updates/maintenance são apresentados como relação possível, nunca como causa comprovada.

Clusters continuam descritivos até demonstrarem utilidade preditiva.

## Knowledge Graph Query Engine

Consultas suportadas:

- relações antes de um boss;
- relações depois de um boss;
- relações de fontes;
- relationship drift;
- estados históricos semelhantes;
- as-known-at.

As respostas carregam evidência, período/asOf, amostra e métricas em vez de gerar respostas factualmente inventadas.

## Dashboard

Nova aba: **Knowledge Graph**.

Ela mostra:

- estado geral do servidor;
- novelty;
- Graph Health;
- Relationship Registry;
- baseline / conditional probability / lift / FDR;
- click-through de lineage;
- consultas do grafo;
- as-known-at;
- Historical Day Replay;
- Source Relationship Graph;
- Sequence Mining;
- Graph Feature Store;
- Hypothesis Queue;
- Similar Historical States;
- Graph Contribution.

## Discovery Budget

Para proteger produção:

- o job usa a fila pesada existente com prioridade baixa;
- Discovery já pausa/cede prioridade conforme a infraestrutura operacional;
- relações são avaliadas somente para bosses com amostra mínima;
- no máximo 60 bosses entram na análise relacional por execução;
- snapshots históricos são preenchidos em lotes de até 250 por execução;
- nenhum experimento é promovido automaticamente.

## Graph Contribution

O dashboard mede contribuição somente quando há atribuição experimental adequada.

Para um ganho entrar em `Graph Contribution`:

- o experimento precisa ser `graph_feature`;
- precisa ter sido `PROMOTED`;
- precisa possuir holdout Champion vs Challenger;
- ambos precisam ter MAE finito;
- são exigidos pelo menos 20 pares comparáveis.

Quando esse critério é atendido, o painel mostra:

- MAE do Champion sem a feature de grafo;
- MAE do Challenger com a feature;
- total de pares atribuíveis;
- redução validada de MAE em minutos;
- ganho percentual de holdout.

Experimentos promovidos com amostra abaixo desse limite permanecem no histórico, mas não entram no cálculo de contribuição atribuível.

## Graph Health e cleanup

O dashboard monitora:

- stale edges;
- orphan features;
- duplicate edges;
- número de relações/features.

Relações rejeitadas permanecem como negative knowledge e podem ser arquivadas sem apagar o histórico.

## PostgreSQL readiness

A migration 008 prepara:

- `knowledge_relationships`;
- `knowledge_relationship_versions`;
- `graph_features`;
- `graph_hypotheses`;
- `server_state_snapshots`.

O runtime principal continua usando o storage persistente já existente.

## O que não é afirmado

O sistema não usa “causa” ou “provoca” para correlações observacionais.

Não foi introduzida GNN.

Não foi introduzido banco de grafos separado.

Relações negativas são registradas, mas o primeiro Challenger graph-context automatizado usa relações positivas; transformar uma associação negativa em previsão exige experimento específico e seguro.

Sequence Mining ainda é uma camada de descoberta; uma sequência não entra automaticamente como feature.

Reporter identities continuam pseudonimizadas e o sistema não cria perfis pessoais além do necessário para qualidade/independência de evidência.

## Métricas reais

O repositório não contém o estado operacional completo de produção. Portanto este documento não inventa:

- relações reais do Lunarian;
- lifts reais;
- MAE final;
- graph contribution;
- novel states reais;
- features efetivamente promovidas.

Esses valores aparecem no dashboard quando o runtime possuir amostra observável suficiente.

## Resultado esperado

A plataforma passa a conseguir responder, com dados reais e limites explícitos:

- o que normalmente acontece antes de um boss;
- o que ocorre depois;
- se a probabilidade condicional supera o baseline;
- qual o lift e a amostra;
- se a associação continua estável;
- quais sequências existem;
- quais fontes parecem dependentes;
- qual era o estado conhecido em determinado instante;
- quais estados históricos são semelhantes;
- quais relações viraram hipóteses;
- quais features passaram pelo AI Lab;
- se alguma delas realmente melhorou a previsão.

A regra final permanece:

**relação descoberta ≠ sinal útil ≠ feature de produção.**

Produção só muda depois de evidência temporal fora da amostra, Live Shadow, Quality Gate e rollout controlado.
