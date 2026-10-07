# Boss Radar AI Lab — Intelligence Experimentation

## Objetivo

O AI Lab transforma a evolução do Prediction Engine em um processo experimental governado.

Fluxo:

OBSERVAR → HIPÓTESE → EXPERIMENTO → BACKTEST TEMPORAL → WALK-FORWARD → HOLDOUT → SHADOW → COMPARAÇÃO PAREADA → SIGNIFICÂNCIA → RECOMENDAÇÃO → APROVAÇÃO MANUAL → CANARY → PROMOÇÃO OU ROLLBACK → KNOWLEDGE BASE.

Regra principal: nova IA não é melhor IA. Um Challenger só pode afetar produção depois de evidência fora da amostra e de eventos futuros reais.

## Arquitetura reaproveitada

O laboratório não cria um segundo Prediction Engine. Ele reutiliza:
- Prediction Engine adaptativo;
- Feature Store e datasets versionados;
- MLOps Registry e Prediction Runs;
- calibração;
- drift detection;
- Champion/Shadow existentes;
- storage persistente;
- event ledger;
- TaskQueue;
- System Health e Safe Mode.

Experimentos são read-only sobre o histórico validado. Eles não escrevem em Canonical Events nem Trusted Data.

## Champion

Champion inicial/configurado:
- model_id: adaptive_ensemble;
- model_version: adaptive-ensemble-v4.5;
- engine_version: 4.5.0;
- code_version do laboratório: boss-radar-ai-lab-v1.

Criar o AI Lab não promove automaticamente nenhum modelo.

Como o repositório não contém o estado operacional de produção, métricas atuais de MAE, mediana, P95, Brier, calibração e sample size devem ser lidas do dashboard em runtime. Este relatório não inventa números ausentes.

## Challengers e Shadow

Famílias disponíveis:
- robust_interval;
- empirical_survival.

Cada experimento parametrizado recebe identidade própria. Variantes do mesmo model_id não compartilham Shadow runs, calibração, resultados ou Canary.

Parâmetros suportados pelo Robust Interval incluem:
- recentWindow;
- recentShare;
- driftRecentShare;
- quantile;
- ablateRecent;
- ablateHistory.

## Experiment Registry

Cada experimento registra:
- experiment_id e fingerprint;
- hipótese explícita;
- tipo;
- servidor e boss opcional;
- model_id e model_version;
- features e parâmetros;
- dataset_version;
- feature_version;
- code_version;
- random_seed quando aplicável;
- timestamps;
- status;
- histórico de transições;
- resultado;
- Experiment Report.

Status: PROPOSED, RUNNING, FAILED, INCONCLUSIVE, REJECTED, SHADOW, CHALLENGER, ELIGIBLE_FOR_PROMOTION, PROMOTED e ARCHIVED.

Hipóteses/configurações equivalentes são deduplicadas.

## Métrica primária

A métrica decisória primária é melhoria pareada de MAE temporal fora da amostra.

O mesmo evento real é comparado entre Champion e Challenger.

Guardrails adicionais:
- erro mediano;
- RMSE;
- P95 error;
- tail risk >60 min, >180 min e >720 min;
- hit rate da janela;
- coverage;
- Calibration Error / ECE;
- Brier Score;
- Log Loss;
- latência;
- failure rate;
- regressão por boss.

## Quality Gate

Política inicial conservadora:
- mínimo histórico: 100 pares;
- holdout mínimo: 20 pares;
- Live Shadow mínimo: 30 eventos futuros pareados;
- ganho relativo mínimo de MAE: 5%;
- limite inferior do CI 95% da melhoria: >1 minuto;
- P95 não pode piorar mais de 5% no gate histórico;
- tail >180 min não pode aumentar mais de 2 p.p.;
- calibração não pode piorar;
- Brier/Log Loss não podem apresentar regressão material;
- latência do Challenger deve respeitar o budget;
- boss específico não pode sofrer regressão forte;
- leakage audit e validação temporal são obrigatórios.

Esses valores são policy, não métricas de performance do sistema.

## Backtest temporal, Walk-Forward e Holdout

Para prever um evento, o Feature Store usa somente dados disponíveis antes daquele ponto.

O experimento preserva development, validation e holdout final.

Walk-forward usa janelas cronológicas expansivas e exige estabilidade entre folds.

Sinais de OVERFIT_RISK:
- ganho de development desaparece no holdout;
- holdout mantém menos da metade do ganho de development;
- walk-forward instável.

## Significância e false discovery

O laboratório calcula:
- melhoria pareada;
- CI 95%;
- p-value aproximado.

Também aplica Benjamini-Hochberg/FDR aos experimentos exibidos.

Diferença pequena ou inconclusiva não vira promoção.

## Shadow Mode

Após os gates históricos, o experimento entra em SHADOW.

Shadow:
- produz previsões reais futuras;
- não aparece para usuários;
- não altera alertas;
- não altera Candidate Confidence;
- não altera Canonical Events;
- não substitui o Champion.

Cada Shadow run é ligado ao experimentId correspondente.

## Calibração do Challenger

O Challenger não reutiliza silenciosamente a calibração do Champion.

Para entrar em Canary, a faixa de confiança correspondente precisa de pelo menos 20 resultados Shadow comparáveis. Sem isso o Champion permanece ativo.

## Promoção, Canary e Rollback

auto_model_promotion = false.

Fluxo:
SHADOW → CHALLENGER → ELIGIBLE_FOR_PROMOTION → APROVAÇÃO HUMANA → CANARY.

Canary:
- 10%;
- 25%;
- 50%;
- 100%.

A seleção é determinística por forecast key.

Se MAE ou P95 apresentarem regressão grave durante Canary, ocorre rollback automático. O Champion anterior também fica disponível para rollback manual.

## Feature Ablation

O AI Lab não chama feature de inútil apenas porque ela não é usada.

Somente ablação realmente medida pode gerar hipótese.

Variantes implementadas:
- ablateRecent: remove contribuição dos intervalos recentes;
- ablateHistory: remove contribuição do histórico longo.

A variante é executada de verdade no backtest e no Shadow.

## Experiment Suggestion Engine

Sugestões podem surgir de:
- erros extremos repetidos;
- clusters de drift;
- ablação medida com ganho não positivo;
- degradação do Champion.

Sugestão cria hipótese; nunca altera produção.

## Error Clustering

A memória de erro é agrupada por:
- causa;
- boss;
- frequência;
- MAE;
- erros extremos.

Isso serve para formular hipóteses futuras.

## Cross-Boss Hypothesis Discovery

Existe análise exploratória A → B em janela de 12h com:
- mínimo de amostras;
- taxa observada versus taxa de fundo;
- risk ratio;
- p-value;
- Benjamini-Hochberg/FDR;
- limite de bosses para controlar custo.

O resultado é explicitamente hipótese exploratória e não causal. Só pode virar feature depois de experimento temporal independente.

## Champion Degradation e Smart Retraining

O Champion é comparado em janela recente versus baseline anterior usando MAE, P95 e window accuracy.

Sem amostra suficiente: INSUFFICIENT DATA.

Smart Retraining pode recomendar experimento quando houver:
- Champion Degradation;
- drift repetido;
- volume suficiente de novos eventos validados.

Idade do Champion é apenas contexto; nunca dispara retreino sozinha.

## Robustness Lab

Stress tests determinísticos:
- ruído ±5% nos intervalos;
- outlier x3 no último intervalo;
- histórico recente reduzido.

O teste mede estabilidade e abstenções. Não é apresentado como teste de acurácia; backtest out-of-sample continua obrigatório.

## No Prediction Zone

O Prediction Engine mantém abstention/readiness.

Se dados ou calibração forem insuficientes, o Challenger pode se recusar a produzir saída. Não é obrigatório prever.

## Budget e isolamento

Proteções:
- no máximo 1 experimento RUNNING por vez;
- runtime budget inicial de 30 segundos;
- AI Lab roda em prioridade LOW;
- Safe Mode pausa experimentos;
- heavy queue saturada/atrasada pausa experimentos;
- produção, Collector, Candidate e Investigation mantêm prioridade.

CPU/memória absolutas dependem do ambiente de hospedagem e ainda não possuem quota universal.

## Reprodutibilidade

Registrado:
- model/version;
- parameters;
- dataset snapshot/hash;
- feature version;
- code version;
- random seed quando aplicável.

Os modelos atuais são determinísticos.

## Experiment Report

Cada execução gera:
- HIPÓTESE;
- CONFIGURAÇÃO;
- BASELINE;
- RESULTADO;
- SIGNIFICÂNCIA;
- IMPACTO;
- LIMITAÇÕES;
- DECISÃO.

O relatório é persistido e visível na UI.

## Knowledge Base e Weekly Review

Resultados positivos, negativos e inconclusivos permanecem registrados.

O AI Lab também resume os últimos 7 dias: criados, concluídos, promovidos, rejeitados, inconclusivos e elegíveis.

## Dashboard

A aba AI Lab mostra:
- Champion e Model Card;
- Shadow Models;
- Challengers;
- Experiment Registry;
- Experiment Reports;
- holdout / walk-forward;
- CI / FDR;
- Canary / rollback;
- leaderboard overall e por boss;
- feature ablation;
- Champion Degradation;
- Smart Retraining;
- Error Clustering;
- Robustness Lab;
- Cross-Boss Hypotheses;
- sugestões;
- Knowledge Base;
- Weekly AI Review;
- learning velocity;
- diminishing returns;
- dataset / feature / code versions.

## PostgreSQL readiness

Migration: database/migrations/007_ai_lab.sql

Estruturas preparadas:
- mlops_ai_experiments;
- mlops_ai_decisions;
- mlops_ai_canaries;
- mlops_ai_champion_history;
- mlops_ai_knowledge.

O runtime principal continua usando o storage persistente existente.

## Limitações atuais

- O repositório não versiona o estado real de produção; portanto MAE/Brier/P95 reais do runtime não podem ser publicados aqui.
- CPU/memória ainda dependem da telemetria da hospedagem.
- Regimes nomeados EVENT/POST_UPDATE ainda não possuem classificador independente comprovado; drift é usado como sinal.
- Cross-boss continua exploratório e nunca entra automaticamente no modelo.
- empirical_survival possui menos hiperparâmetros expostos que robust_interval.
- promoção totalmente automática permanece deliberadamente desativada.

## Princípio final

Uma ideia interessante não basta.
Um backtest bom não basta.
Uma melhora no treino não basta.

Uma nova versão só pode substituir o Champion quando demonstrar melhora temporal fora da amostra, sobreviver ao Live Shadow em eventos futuros, passar pelos guardrails e completar rollout controlado.
