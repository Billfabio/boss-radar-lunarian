# Relatório de Confiabilidade da Inteligência — Engine 4.2

**Projeto:** Boss Radar RubinOT  
**Branch:** `feature/intelligent-boss-radar`  
**Base auditada:** `179cb01c4144788247170de15b0bf3132fddcc1c`  
**Implementação validada:** `b1bfc00f76d503f3b4da31a7f952e8db7c0c1422`  
**Prediction engine:** `4.2.0`  
**Model family:** `adaptive-ensemble-v4.2`  
**Data Quality Engine:** `2.0.0`

## Objetivo

Esta etapa foi tratada como uma auditoria de confiabilidade do núcleo, seguindo a cadeia:

```text
CONFIABILIDADE DOS DADOS
↓
CONFIABILIDADE DAS FONTES
↓
CONFIABILIDADE DOS MODELOS
↓
CONFIABILIDADE DA PREVISÃO FINAL
↓
APRENDIZADO COM RESULTADOS REAIS
```

A regra central permanece: **o sistema deve preferir se abster a apresentar precisão que os dados não sustentam.**

---

## 1. O que já existia antes da Engine 4.2

A base auditada já possuía uma arquitetura significativamente mais avançada do que um simples radar:

- Data Quality Engine;
- Consensus Engine;
- proveniência por evidência;
- reputação dinâmica de fontes;
- circuit breaker;
- estados de quarentena;
- detecção robusta de anomalias;
- drift detection;
- pesos temporais;
- modelos por boss + servidor;
- ensemble adaptativo;
- distribuição de incerteza;
- Boss Prediction Score;
- política de abstenção;
- calibração de confiança;
- backtest walk-forward;
- desenvolvimento/validação/teste temporais;
- baselines;
- Champion/Challenger;
- teste pareado de significância;
- event ledger encadeado por hash;
- versionamento de forecasts;
- Central de Confiabilidade;
- observabilidade da IA;
- regression gate;
- benchmark sintético de carga;
- fault injection;
- proteção de CI contra `Math.random()`, mocks e fixtures no núcleo de inteligência.

A auditoria 4.2 não duplicou esses mecanismos. Ela procurou pontos onde eles ainda podiam produzir uma interpretação otimista demais.

---

## 2. Problemas reais encontrados e corrigidos

### 2.1 Origem desconhecida ainda podia entrar no aprendizado

Antes desta rodada, ausência de origem reduzia o Data Quality Score, mas não era uma barreira obrigatória em todos os casos.

#### Correção

Uma evidência agora só é considerada rastreável quando possui, de forma real:

- `sourceId`;
- `evidenceId`;
- `sourceRef` conhecido;
- `collectionMethod` conhecido.

Valores vazios, `unknown` ou `n/a` não contam como proveniência.

Sem rastreabilidade:

- score fica limitado a no máximo 69;
- status fica em `AGUARDANDO_CONFIRMAÇÃO`;
- `eligibleForLearning = false`;
- a interface mostra **ORIGEM NÃO RASTREÁVEL · QUARENTENA**.

Portanto, uma informação sem origem pode permanecer armazenada para auditoria, mas não treina o modelo.

---

### 2.2 Evidências antigas já avaliadas não receberiam automaticamente a regra nova

Somente verificar se `evidence.quality` existia não era suficiente. Registros avaliados pela versão antiga tinham objeto de qualidade, porém não continham a nova regra dura de rastreabilidade.

#### Correção

O Data Quality Engine passou a possuir versão própria:

```text
DATA_QUALITY_ENGINE_VERSION = 2.0.0
```

No carregamento:

- avaliações antigas são identificadas;
- somente avaliações desatualizadas são recalculadas;
- fatos originais não são alterados;
- fontes são reavaliadas;
- o processo fica registrado no ledger.

---

### 2.3 Duplicata antiga podia impedir recuperação da proveniência

Um registro legado podia possuir o mesmo `evidenceId` de uma nova coleta rastreável.

O deduplicador corretamente rejeitaria a nova evidência, porém a versão antiga continuaria sem origem.

#### Correção

Foi implementado **enriquecimento idempotente de proveniência**.

Quando:

- `evidenceId` é o mesmo;
- boss, servidor, tipo, precisão e horários são idênticos;
- o registro antigo não é rastreável;
- a nova coleta é rastreável;

o sistema completa apenas os metadados ausentes:

- `sourceRef`;
- `collectionMethod`;
- horários de coleta/processamento;
- responsável pela confirmação, quando aplicável.

O horário/fato original não é modificado.

O ledger registra:

```text
evidence_provenance_enriched
```

---

### 2.4 Quarentena não estava totalmente isolada do consenso

Uma evidência `AGUARDANDO_CONFIRMAÇÃO` já não treinava diretamente o modelo, porém ainda podia participar do consenso do evento e deslocar seu horário consolidado.

#### Correção

Somente evidências:

- `CONFIRMADO`;
- `PROVÁVEL`;

podem influenciar:

- horário consolidado;
- consenso;
- confiança do evento;
- contagem de horário preciso;
- resultado temporal usado para aprendizado.

Evidências em:

- `AGUARDANDO_CONFIRMAÇÃO`;
- `CONFLITANTE`;
- `SUSPEITO`;
- `DESCARTADO`;

permanecem armazenadas, mas ficam isoladas do fato consolidado.

---

### 2.5 Boss com somente dados ruins podia desaparecer da lista

Antes, a lista de previsões era derivada apenas de eventos já confirmados.

Um boss com dados coletados, porém todos em quarentena, podia simplesmente não aparecer na Inteligência.

#### Correção

O motor agora inclui bosses que possuam qualquer evidência de `appearance` ou `kill`.

Se os dados aprovados forem insuficientes, o resultado explícito é:

> **DADOS INSUFICIENTES PARA UMA PREVISÃO CONFIÁVEL.**

O boss não desaparece e nenhum horário é inventado.

---

### 2.6 Data leakage indireto na calibração do backtest

O walk-forward por boss estava correto, porém o fallback de calibração global por servidor podia acessar previsões de outro boss processadas posteriormente no tempo.

Isso criava possibilidade de conhecimento futuro indireto.

#### Correção

Para cada previsão histórica, a calibração agora pode enxergar somente forecasts com:

```text
resolvedAt < horário do evento que está sendo previsto
```

independentemente da ordem em que os bosses são processados.

O teste automatizado cria deliberadamente:

- um boss com histórico antigo;
- outro boss com histórico futuro;

e confirma que a primeira previsão antiga possui zero amostras futuras de calibração.

---

### 2.7 Métricas de versões diferentes eram misturadas

Depois de alterar o algoritmo, calibração, Champion/Challenger, autoavaliação e precisão podiam continuar usando previsões produzidas por versões antigas como se fossem equivalentes.

#### Correção

A Engine 4.2 torna essas análises **version-aware**.

A versão ativa utiliza apenas forecasts com:

```text
modelVersion = adaptive-ensemble-v4.2
```

para:

- calibração;
- ECE/MCE/Brier atuais;
- Champion/Challenger;
- autoavaliação;
- métricas de observabilidade;
- precisão atual;
- MAE atual.

O painel preserva também métricas históricas de todas as versões, mas as apresenta separadamente.

---

### 2.8 Mudança de algoritmo não possuía trilha explícita no ledger

#### Correção

Toda mudança de:

- prediction engine;
- model family;

gera um evento:

```text
engine_version_changed
```

com versão anterior e versão nova.

A Central de Confiabilidade mostra as últimas mudanças do algoritmo.

---

### 2.9 Circuit breaker confundia API online com dados confiáveis

Uma fonte suspensa por baixa qualidade podia responder HTTP 200 após o cooldown e voltar imediatamente ao estado normal.

Isso confundia disponibilidade técnica com confiabilidade estatística.

#### Correção

Os circuit breakers agora possuem motivo:

- `technical`;
- `quality`.

#### Falha técnica

```text
OPEN
↓ cooldown
HALF_OPEN
↓ request bem-sucedida
CLOSED
```

#### Queda de qualidade

```text
OPEN (quality)
↓ cooldown
HALF_OPEN
↓ API responde
continua HALF_OPEN
↓
3 evidências novas e corretas consecutivas
↓
CLOSED
```

Uma evidência ruim durante probation reabre a quarentena.

A Central mostra:

- motivo;
- estado;
- progresso de recuperação `x/3`.

---

### 2.10 Objetos de fonte eram recriados a cada normalização

`ensureSources()` substituía objetos internos.

Um componente que mantivesse referência à fonte podia observar um objeto antigo, enquanto o registry já possuía outro.

#### Correção

As fontes agora são normalizadas **in place**, preservando identidade de objeto e evitando estado divergente entre módulos.

---

### 2.11 Catálogo externo ainda era ponto único de falha

Se o catálogo do RubinOT estivesse offline e não existisse cache, o refresh podia falhar antes das outras fontes.

#### Correção

O catálogo agora:

- participa do circuit breaker;
- registra falhas;
- não derruba automaticamente as demais integrações;
- utiliza o `bosstiary.json` local como fallback mínimo quando necessário;
- marca explicitamente `catalogFallback`.

O painel mostra o estado degradado; ele não finge que o catálogo externo respondeu.

---

### 2.12 Health check podia declarar storage online após falha de persistência

#### Correção

O health check agora diferencia:

- API;
- armazenamento.

Storage possui:

- `ONLINE`;
- `ERRO`;
- `AGUARDANDO`;
- última gravação bem-sucedida;
- último erro;
- contagem de recuperações.

Uma API HTTP saudável não mascara mais uma falha de persistência.

---

## 3. Métricas adicionais de qualidade

A Central de Confiabilidade passou a expor:

- evidências rastreáveis;
- evidências sem origem;
- taxa de rastreabilidade;
- Data Quality Score;
- conflitos;
- quarentena;
- anomalias.

Novas métricas de observabilidade:

```text
data_quality_traceability_rate
data_quality_untraceable
```

Além das já existentes:

```text
prediction_latency
prediction_error_minutes
source_accuracy
model_accuracy
confidence_calibration_error
data_quality_score
drift_score
anomaly_rate
prediction_volume
```

---

## 4. Algoritmos ativos

A Engine 4.2 mantém os métodos estatísticos existentes porque a auditoria não encontrou justificativa para substituí-los por um modelo opaco.

### Produção / candidatos do ensemble

- `historical_interval`;
- `recent_interval`;
- `recent_mean_10`;
- `last_interval`;
- `historical_mean`;
- `time_of_day`;
- `weekday`;
- `adaptive_ensemble`.

### Baselines

- média histórica;
- último intervalo;
- mediana empírica;
- média das últimas 10;
- média ponderada recente.

### Machine Learning

**Nenhum modelo externo de ML é declarado ativo.**

Isso é intencional.

Um modelo ML só deve ser promovido quando houver volume suficiente de eventos temporais confiáveis e ele superar os baselines/Champion no holdout temporal.

---

## 5. Como a confiança é calculada

A confiança bruta continua separada de probabilidade e score.

### Confiança bruta

| Componente | Peso |
| --- | ---: |
| Qualidade dos dados | 22% |
| Histórico / tamanho da amostra | 22% |
| Concordância entre modelos | 20% |
| Confiabilidade das fontes | 16% |
| Qualidade temporal | 8% |
| Estabilidade / drift / anomalias | 12% |

Depois:

```text
confiança bruta
↓
resultados reais da MESMA versão de modelo
↓
calibração empírica
↓
confidence final
```

Se não houver amostra suficiente:

```text
insufficient_calibration_data
```

e o sistema não inventa um ajuste.

---

## 6. Probabilidade, confiança, precisão, erro e score

Continuam sendo conceitos separados.

### Probabilidade

Estimativa de ocorrência dentro da janela modelada.

### Confiança

Grau de sustentação estatística daquela previsão, calibrado contra resultados reais.

### Precisão histórica

Percentual de janelas anteriores que contiveram o evento.

### MAE

Erro médio em minutos somente para resultados cujo horário real é temporalmente preciso e aprovado.

### Boss Prediction Score

Qualidade global da previsão, não probabilidade.

### Dados utilizados

Quantidade de aparições aprovadas para aquele boss + servidor.

---

## 7. Fluxo de validação atual

```text
COLETAR
↓
NORMALIZAR
↓
REGISTRAR PROVENIÊNCIA
↓
VALIDAR TEMPO E CAMPOS
↓
DETECTAR ANOMALIA
↓
CALCULAR DATA QUALITY SCORE
↓
BLOQUEAR ORIGEM NÃO RASTREÁVEL
↓
DEDUPLICAR
↓
ISOLAR QUARENTENA
↓
CRUZAR FONTES
↓
CONSENSUS ENGINE
↓
CLASSIFICAR EVENTO
↓
EVENT LEDGER
↓
LIBERAR OU BLOQUEAR APRENDIZADO
↓
HISTÓRICO BOSS + SERVIDOR
↓
DRIFT / PESOS TEMPORAIS
↓
MÚLTIPLOS MODELOS
↓
ENSEMBLE ROBUSTO
↓
DISTRIBUIÇÃO DE INCERTEZA
↓
PROBABILIDADE
↓
CONFIDENCE BRUTA
↓
CALIBRAÇÃO DA MESMA VERSÃO
↓
BOSS PREDICTION SCORE
↓
ABSTENÇÃO OU PREVISÃO
↓
RESULTADO REAL
↓
ERRO
↓
REPUTAÇÃO DAS FONTES
↓
DESEMPENHO DOS MODELOS
↓
CHAMPION / CHALLENGER
↓
PRÓXIMA PREVISÃO
```

---

## 8. Backtest e prevenção de data leakage

O backtest permanece walk-forward:

```text
evento N
← somente eventos 1 até N-1
```

Agora isso vale também para a calibração compartilhada entre bosses.

Não é permitido:

- usar evento posterior;
- usar forecast resolvida posteriormente;
- escolher modelo usando holdout de teste;
- recalibrar o passado com resultados futuros.

O fluxo continua separado em:

- development;
- validation;
- test.

---

## 9. Champion / Challenger

Champion atual:

```text
adaptive_ensemble
```

A governança agora compara somente resultados produzidos pela mesma família de modelo.

Promoção continua exigindo:

- pelo menos 50 previsões pareadas;
- significância estatística;
- pelo menos 5% de melhoria relativa de MAE;
- queda de hit rate não superior a 2 p.p.

A Engine 4.2 **recomenda**, mas não promove automaticamente.

Essa escolha foi mantida porque uma promoção completamente automática ainda é mais arriscada do que útil com o volume real desconhecido.

---

## 10. Event sourcing e versionamento

O ledger registra:

- evidência recebida;
- duplicidade;
- enriquecimento de proveniência;
- consolidação;
- forecast criada/revisada/resolvida;
- correção;
- remoção;
- reavaliação de qualidade;
- mudança de versão.

Uma correção não apaga a informação anterior.

### Versões atuais

```text
prediction_engine = 4.2.0
model_family      = adaptive-ensemble-v4.2
data_quality      = 2.0.0
dataset_version   = hash por boss + servidor + eventos
```

---

## 11. Banco de dados

O runtime principal **ainda não usa o banco relacional como persistência ativa**.

Nesta rodada foi criada:

```text
database/migrations/002_reliability_v42.sql
```

A migração é aditiva e prepara campos para:

- avaliações precisas das fontes;
- erro temporal;
- latência;
- circuit reason;
- probation de qualidade;
- histórico recente da fonte;
- precisão real do resultado da forecast;
- explicação da confiança;
- fontes utilizadas;
- evidências excluídas;
- distribuição condicional.

Nada foi apagado do schema existente.

### Limitação

Até a migração operacional ser concluída, a plataforma ainda não deve ser declarada pronta para milhões de eventos persistidos.

---

## 12. Validação automatizada final

Execução validada:

```text
commit: b1bfc00f76d503f3b4da31a7f952e8db7c0c1422
CI: SUCCESS
```

Resultado:

```text
57 arquivos JavaScript/MJS verificados
Núcleo de inteligência sem aleatoriedade ou dados simulados

72 testes
72 aprovados
0 falhos

temporal regression gate: aprovado
load benchmark: aprovado
fault injection: aprovado
Cloudflare build: aprovado
Cloudflare smoke test: aprovado
Wrangler dry-run: aprovado
```

---

## 13. Comparação antes × depois

### Antes desta rodada

Commit de referência:

```text
179cb01c4144788247170de15b0bf3132fddcc1c
```

CI:

```text
57 arquivos JS/MJS
60 testes
60 aprovados
0 falhos
```

Regression gate:

```text
Adaptive Ensemble test MAE: 116,9 min
Melhor baseline test MAE:   116,9 min
```

### Depois

```text
57 arquivos JS/MJS
72 testes
72 aprovados
0 falhos
```

Regression gate:

```text
Adaptive Ensemble test MAE: 116,9 min
Melhor baseline test MAE:   116,9 min
```

### Interpretação

As regras de confiabilidade ficaram mais rígidas sem degradar o regression gate determinístico.

O ensemble **não superou** o melhor baseline nessa fixture. Ele empatou.

O gate permanece válido porque impedir regressão é mais importante do que declarar uma vitória que os dados não demonstram.

---

## 14. Benchmark de carga observado

### Antes

Execução de referência:

```text
inference: 227,6 ms

10 usuários     p95: 36,6 ms
100 usuários    p95: 64,9 ms
1.000 usuários  p95: 165,6 ms
10.000 usuários p95: 171,9 ms
```

### Depois

Execução final desta rodada:

```text
1.600 eventos
20 bosses
inference: 166,6 ms

10 usuários     p95: 20,5 ms
100 usuários    p95: 43,3 ms
1.000 usuários  p95: 134,9 ms
10.000 usuários p95: 86,0 ms
falhas HTTP: 0
```

### Interpretação correta

Esse benchmark é executado em loopback dentro do runner do GitHub.

Ele demonstra que a alteração não ultrapassou os limites de regressão e, nesta execução, apresentou números melhores.

**Ele não prova capacidade real para 10.000 usuários simultâneos em produção.**

Para isso ainda são necessários testes em infraestrutura real com:

- reverse proxy;
- TLS;
- banco ativo;
- CPU/memória definidas;
- múltiplas instâncias/workers;
- latência de rede;
- APIs externas.

---

## 15. Fault injection final

A suíte valida:

- API/fonte offline;
- circuit breaker técnico;
- recuperação após cooldown;
- deterioração da qualidade;
- probation de qualidade;
- recuperação somente após boas evidências;
- rate-limit em burst;
- job com falha;
- próximo job recuperando;
- idempotência;
- timestamp inválido;
- round-trip do ledger após reinício lógico.

Resultado:

```text
sourceQualityDeteriorationQuarantine: true
fault-injection: aprovado
```

### Ainda não aplicável

- queda de banco relacional real: banco ainda não é runtime ativo;
- WebSocket: runtime utiliza SSE/polling;
- worker distribuído externo: ainda não existe.

Não foram criados testes fictícios para componentes que o sistema não possui.

---

## 16. Precisão atual de produção

**Indisponível no repositório.**

O GitHub não contém o estado operacional real com forecasts resolvidas de produção.

A Engine 4.2 calcula no runtime:

- 7 dias;
- 30 dias;
- 90 dias;
- total;
- por boss;
- por versão do motor.

A Central agora usa a **versão ativa** para o KPI atual.

Não existe número estático ou fictício neste relatório.

---

## 17. Erro médio atual de produção

**Indisponível offline pelo mesmo motivo.**

MAE só é calculado para:

- forecasts resolvidas;
- resultado real com precisão temporal suficiente;
- evidência aprovada;
- versão adequada do modelo.

Registros apenas diários ou em quarentena não fabricam erro em minutos.

---

## 18. Qualidade atual dos dados de produção

**Indisponível sem o estado real.**

O runtime mostra:

- score médio;
- rastreabilidade;
- dados sem origem;
- conflitos;
- quarentena;
- anomalias;
- distribuição dos status de qualidade.

Isso permite saber se a base está melhorando antes mesmo de olhar a precisão da previsão.

---

## 19. Melhores e piores fontes

**Não é correto nomear fontes vencedoras/perdedoras sem o histórico operacional real.**

A Central calcula dinamicamente:

- reliability;
- accuracyRate;
- recentAccuracy;
- preciseAccuracyRate;
- averageErrorMinutes;
- averageDelayMinutes;
- consistency;
- successRate;
- averageLatencyMs;
- duplicates;
- circuitState;
- circuitReason.

Fontes com pouca amostra não devem ser classificadas como melhores apenas por terem poucos acertos.

---

## 20. Melhor modelo por boss

Também é uma métrica de runtime.

A unidade correta continua:

```text
BOSS + SERVIDOR
```

O Champion/Challenger utiliza forecasts pareadas daquela combinação e da versão ativa.

Nenhuma lista estática de “melhor modelo” foi inserida no código.

---

## 21. O que ainda não considero concluído

### Persistência relacional ativa

É a maior lacuna estrutural.

O schema e as migrations estão preparados, mas o runtime ainda usa armazenamento legado.

### Event store externo imutável

O ledger atual é tamper-evident e hash-chained, porém vive junto ao estado operacional. Um event store/WORM externo elevaria o nível de auditoria.

### Autopromoção de Champion

Existe recomendação estatística, mas não promoção automática. Com o volume real ainda não conhecido, isso é uma proteção deliberada.

### Machine Learning

Não há ML ativo e não deve haver até que exista volume confiável suficiente.

### Load test de infraestrutura

O CI mede loopback, não produção real.

### Workers distribuídos

A fila atual é local. Escala horizontal real exigirá fila externa/durável.

### Banco/worker failure injection real

Só deve ser adicionado quando esses componentes forem de fato runtime ativo.

---

## 22. Próximos passos recomendados

Ordem técnica recomendada:

1. **Concluir migração do runtime para PostgreSQL/MySQL.**
2. Criar migração idempotente do estado legado com reconciliação de contagens/hash.
3. Persistir o event ledger fora do snapshot monolítico.
4. Migrar jobs de coleta/backtest para fila durável.
5. Executar baseline real da Engine 4.2 com histórico de produção.
6. Aguardar amostra suficiente da 4.2 antes de comparar com a 4.1.
7. Definir SLOs oficiais de qualidade de dados, calibração e latência.
8. Fazer teste de carga HTTP em infraestrutura real.
9. Só depois avaliar um modelo ML challenger.
10. Só automatizar promoção de Champion quando houver volume real suficiente e rollback transacional seguro.

---

## Conclusão

A Engine 4.2 ficou mais conservadora.

Ela passou a distinguir com mais rigor:

- dado recebido;
- dado rastreável;
- dado confiável;
- dado aprovado para consenso;
- dado aprovado para aprendizado;
- previsão possível;
- previsão confiável.

A principal evolução desta rodada não foi “prever mais”.

Foi impedir que dados sem origem, dados em quarentena, resultados de versões antigas ou informação futura indireta façam o sistema parecer mais inteligente do que realmente é.

Esse é o comportamento esperado de uma plataforma preditiva confiável.
