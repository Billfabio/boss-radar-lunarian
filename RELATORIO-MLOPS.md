# Infraestrutura de inteligência controlada — 06/10/2026

Branch exclusiva: `feature/intelligent-boss-radar`. Base auditada: `d38c164eeb25428fb377021b8fc3927b9a7afd00`. A main não foi modificada.

## Conferência do primeiro anexo

O conteúdo de “Texto colado.txt” corresponde à arquitetura 4.2 encontrada na branch. Antes das mudanças, a suíte executou 72 testes, todos aprovados. Foram conferidos os módulos, regras e testes relativos a qualidade/proveniência, consenso/quarentena, deduplicação diária, correção/replay, reputação sem autoavaliação circular, circuit breaker técnico e de qualidade, ensemble, drift, abstention, calibração por versão, ledger, métricas e health. Os quatro relatórios citados existem.

A persistência relacional continua preparada, mas não ativa. Isso confirma a ressalva do anexo. Os números antigos de carga são históricos, não uma garantia atual. Os nomes reais dos scripts são `test:intelligence-regression`, `test:intelligence-load` e `test:failure-injection`, diferentes de três aliases citados no resumo. Nenhum dado operacional privado está no checkout.

## Implementação

O Engine agora registra versão 4.3.0. O algoritmo Champion permanece `adaptive_ensemble`, família `adaptive-ensemble-v4.2`: a matemática estável foi preservada; a nova camada controla aprendizado, snapshots e publicação. A Feature Store tem versão própria 1.0.0.

| Prioridade | Implementação efetiva |
|---|---|
| Feature Store | Features versionadas, definições centralizadas, estatísticas compartilhadas, timestamps explícitos e exclusão de conhecimento futuro. |
| Model Registry | Champion, dois Shadows, versões, features, parâmetros, datasets, métricas/gates e metadados de promoção. |
| Dataset Versioning | Snapshots completos com SHA-256, contexto do motor, fontes, configuração e histórico preservados. |
| Shadow Mode | Previsões de candidatos persistidas e resolvidas separadamente, fora do livro público e das notificações. |
| Champion/Challenger | Gate pareado e temporal; Shadow só vira Challenger com prova suficiente. A promoção do algoritmo novo para produção permanece bloqueada nesta etapa. |
| Online Learning | Resolução operacional mede erros sem alterar imediatamente os pesos. Propostas usam treino anterior ao holdout; parâmetros têm limites. Gates aprovados iniciam canary por boss, com 5/20/50/100%, monitoramento em cada estágio e rollback. |
| Drift | Detector existente preservado; Feature Store, crítica e candidato com memória longa incorporam seu score. |
| Error Analysis | Memória idempotente por forecast; hipóteses de drift, conflito, histórico limitado, anomalia e atraso. Correções atualizam resultados sem destruir snapshots. |
| Quality Gates | >=50 pares, ganho de MAE >=5%, limite inferior do ganho >1 minuto, calibração verificada, latência p95 <=250ms, sem falhas e sem regressão relevante por boss. Experimentos exigem aprovação separada em validação e teste. |
| Dashboard | Central de Inteligência integrada, registro, features, datasets, experimentos, horizontes, erros, padrões e timeline; relatórios gerados dos dados reais. |

Também foram implementados: distribuição empírica condicional de sobrevivência com horizontes 6/12/24/48/72h e intervalos de Wilson; crítica antes da previsão com redução de confiança/recusa de minuto exato e necessidade de confirmação; importância dos grupos de features por ablação walk-forward; descoberta descritiva de intervalos recorrentes; diagnóstico de latência de publicação e possível dependência entre fontes; detecção conservadora de rajadas/repetições de evidência precisa; dead letter queue com payload/erro/stack/tentativas, persistência no estado e reprocessamento administrativo de experimentos.

## Modelos e features

- Champion: `adaptive_ensemble`, versão `adaptive-ensemble-v4.2`.
- Shadow: `robust_interval` 1.0.0, mistura de mediana longa e recente. Histórico longo retém 80%, ou 60% quando há drift elevado.
- Shadow: `empirical_survival` 1.0.0, distribuição empírica dos intervalos; mediana como estimador pontual para comparação. Não é Kaplan–Meier com censura e não representa um hazard causal.
- Componentes estáveis continuam disponíveis: historical/recent interval, historical mean, recent mean 10, last interval, time of day, weekday e baselines históricos.
- Não há Challenger novo aprovado na instalação vazia. Ausência de dados é exibida como ausência de métricas.

As definições das features estão em `mlops/feature-store.mjs` e são mostradas no painel. Incluem elapsedHours, mean5/10/30, median, stddev, variability, hour, weekday, boss, world, recentFrequency, trend, confirmations, sourceReliability, serverSaveHours, samples, preciseSamples, driftScore e anomalyScore. Server save é null sem configuração explícita. Nenhuma porcentagem de importância é inventada quando não existe ganho medido.

## Temporalidade e reprodução

Para os experimentos MLOps, a disponibilidade do valor consolidado é o maior timestamp relevante de evidência aprovada e atualização do evento. Correções tardias excluem o valor corrente de cortes anteriores; snapshots previamente emitidos preservam o valor original. Sem timestamps/proveniência, o registro não entra na avaliação que promove modelos. O backtest legado continua útil como diagnóstico retrospectivo, mas registros sem timestamps não provam disponibilidade histórica. Ele não autoriza promoção MLOps.

O replay verifica hash do dataset e campos imutáveis da previsão, reexecuta o motor com contexto preservado e confere o centro publicado. A saída publicada, suas features e pesos são preservados. A versão do código do motor também deve ser mantida para reproduções após futuras mudanças matemáticas; o código atual não migra automaticamente snapshots de algoritmos futuros.

Correções ou remoções continuam auditadas. O replay de reputação/modelo legado é mantido como mecanismo corretivo; ele não é uma promoção de algoritmo. Canary em curso é invalidado quando a confirmação utilizada é corrigida.

## Interfaces

- GET `/api/intelligence/mlops`: Central de Inteligência do servidor selecionado.
- POST `/api/intelligence/experiment`: world e modelId, em fila limitada.
- POST `/api/intelligence/replay`: forecastId.
- POST `/api/intelligence/retry`: id de falha de experimento na dead letter queue.

Essas rotas usam as proteções de sessão/origem/limitação já existentes. O relatório evita publicar identidades de confirmadores. Eventos Shadow não alimentam SSE de alertas ou push. O canary de aprendizado seleciona eventos por hash determinístico, sem sorteio.

## Validação e métricas

Suíte ampliada: 87 testes aprovados, zero falhas na execução local inicial da camada. Cobre disponibilidade tardia, correção futura, quarentena, identidade/corrupção de snapshots, reprodução, isolamento Shadow, controle de pesos, gates por boss, incerteza da sobrevivência, experimento temporal, poisoning, ablação, canary/rollback, dead letters e métricas indisponíveis.

Integridade do motor, teste temporal, injeção de falhas, build e smoke passaram. Sintaxe verificada arquivo a arquivo. O teste temporal controlado manteve MAE 116,9 minutos no ensemble e no melhor baseline; acerto de janela 90,9% em 33 exemplos de teste. ECE calibrado 22,2 pontos, versus ECE bruto 2,5: a calibração deste cenário de teste ainda é uma oportunidade de melhoria, não prova de superioridade. Esses números são do teste controlado e não da produção.

O benchmark local registrou 36 conexões recusadas em cada faixa de 1.000 e 10.000 requisições sob 250 conexões concorrentes. A mesma falha ocorreu na base original, com ECONNREFUSED. Não é declarado aprovado localmente. O dry-run Wrangler e o postinstall foram bloqueados por `spawn EPERM` na execução Windows. O CI Linux mantém todos esses gates, sem flexibilização dos limites.

Precisão atual, MAE operacional, qualidade operacional, ganho de candidatos e principais erros reais permanecem indisponíveis sem o estado da instalação. O painel calcula essas informações conforme surgem resultados rastreáveis; não usa os exemplos dos testes como histórico real.

## Limites e requisitos ainda parciais

| Itens do segundo anexo | Limite desta etapa |
|---|---|
| 1–3, 14, 16–20, 32–34, 36–40 | Infraestrutura implementada; crescimento operacional e resultados dependem de dados reais. |
| 4, 6 | Ablação de grupos e padrão de intervalo recorrente; busca geral de novas features, clusters, sequências e sazonalidade ainda não implementada. |
| 5 | Correlações entre eventos de bosses diferentes e sua validação causal não implementadas. |
| 7–10 | Métodos estatísticos/empíricos e horizontes implementados; gradient boosting, regressão especializada e modelos de sobrevivência com censura não implementados. A curva é condicional à ausência de confirmação, sem afirmar ausência observada no jogo. |
| 11–13, 23–24 | Análise por regras, memória de erros, crítica e necessidade de confirmação implementadas. As causas são hipóteses, sem diagnóstico causal. A matriz está nos dados da previsão; integração completa na priorização dos alertas permanece pendente. |
| 15 | Canary para parâmetros do Champion; rollout de algoritmos novos do Registry para Champion não implementado. |
| 21 | Heurísticas de repetição e rajada implementadas; não constituem detecção completa de adversários ou padrões artificiais sofisticados. |
| 22 | Reputação individual de usuários não implementada; não havia identidade operacional apropriada e minimizada no projeto. |
| 25 | Alertas estáveis preservados; classificação INFO/ATENÇÃO/CRÍTICO e preferências inteligentes ainda pendentes. |
| 26–29 | Diagnóstico de atrasos e grafo de possível dependência; dependência inferida não muda automaticamente o consenso. Não é tratada como causalidade. |
| 30–31 | Fila continua após erros, retries exigem idempotência, jobs longos são sinalizados e falhas ficam preservadas. Reinício forçado de worker, cancelamento cooperativo de coletores e auto-reconexão completa não implementados. |
| 35 | Gates global e por boss/servidor; auditoria completa estratificada por horizonte, confiança, importância comercial e tamanho de histórico ainda pendente. |

A migration `003_mlops.sql` é aditiva/idempotente e prepara tabelas PostgreSQL. Não foi aplicada a um banco real neste ambiente, e não substitui a migração operacional de persistência. Snapshots completos aumentam o armazenamento legado; a próxima prioridade é mover datasets/runs para armazenamento incremental antes de operar em grande escala. Não há coleta nova de APIs sem autorização, nem promoção automática de candidatos sem evidência.
