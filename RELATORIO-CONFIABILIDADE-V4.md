# Relatório de Confiabilidade da Inteligência — Engine v4

**Branch:** `feature/intelligent-boss-radar`  
**Prediction engine:** `4.0.0`  
**Model family:** `adaptive-ensemble-v4`  
**Objetivo desta etapa:** melhorar a qualidade da inteligência existente e, principalmente, permitir que o sistema reconheça quando não possui evidência suficiente para prever.

---

## 1. O que já existia antes desta etapa

O projeto já possuía:

- normalização básica de observações;
- deduplicação de evidências;
- reputação beta simplificada das fontes;
- detecção básica de anomalias;
- histórico separado por boss + servidor;
- modelos de intervalo histórico, intervalo recente, horário e dia da semana;
- ensemble adaptativo;
- aprendizado de pesos por resultado real;
- forecast persistido antes da confirmação;
- replay dos pesos depois de correções;
- backtest walk-forward sem uso de dados futuros;
- erro em minutos apenas para resultados temporalmente precisos;
- painel de Inteligência;
- health check;
- logs estruturados;
- fila limitada de backtests;
- detecção de deterioração;
- proteção contra `Math.random()`, mocks e fixtures no núcleo de inteligência;
- autenticação/rate limiting para Node exposto publicamente.

A auditoria anterior já havia eliminado vários mecanismos que poderiam criar falsa precisão.

---

## 2. O que foi corrigido nesta etapa

### Confiança não era igual a calibração

Antes, o sistema possuía um score determinístico de confiança, porém não verificava de forma adequada se "90%" significava aproximadamente 90% de acerto real.

Foi criado um mecanismo de calibração por faixas e um problema encontrado durante os próprios testes foi corrigido: o ECE inicialmente media a confiança **bruta**, mesmo depois do calibrador alterar o valor exibido.

Agora são mantidos separadamente:

- `confidenceRaw`: confiança produzida pelo motor antes da calibração;
- `confidence`: confiança final calibrada mostrada ao usuário;
- `rawEce`: erro de calibração da confiança bruta;
- `ece`: erro de calibração da confiança final.

### Validação temporal insuficiente no ponto central

A normalização aceitava uma observação precisa com horário impossível no futuro se ela chegasse por um caminho que não tivesse validação adicional.

Agora a regra é aplicada no ponto central de normalização:

- observações de minuto/hora não podem apontar para o futuro além de tolerância de relógio;
- intervalos/datas diárias continuam podendo representar o restante do dia sem criar falso erro.

### Consenso gerava conflito falso

Duas evidências precisas, por exemplo 21:30 e 21:35, podiam ser tratadas como intervalos não sobrepostos e virar conflito.

Agora:

- evidências precisas são comparadas pela distância temporal;
- diferença acima de 3 horas pode gerar conflito;
- evidências de intervalo/data usam interseção de faixas.

### Recalcular previsão por usuário

Um teste de carga revelou que recalcular o motor completo para cada consumidor não escala.

A arquitetura foi corrigida:

- previsões são construídas como snapshot;
- o snapshot é cacheado por revisão dos dados;
- a cache é invalidada quando evidências, correções ou aprendizado relevante mudam;
- usuários/requests reutilizam a previsão já calculada.

---

## 3. O que foi criado

### Data Quality Engine

Novo módulo: `data-quality/engine.mjs`.

Cada observação recebe um score de 0–100 baseado em:

- proveniência;
- precisão temporal;
- atualidade/timeliness;
- reputação da fonte;
- consistência;
- anomalia;
- unicidade.

Status possíveis:

- `CONFIRMADO`
- `PROVÁVEL`
- `AGUARDANDO_CONFIRMAÇÃO`
- `CONFLITANTE`
- `SUSPEITO`
- `DESCARTADO`

Dados suspeitos continuam armazenados, mas ficam fora do aprendizado quando não atingem os critérios necessários.

### Proveniência completa

Cada evidência pode registrar:

- `sourceId`;
- `sourceRef`;
- `collectionMethod`;
- `sourceObservedAt`;
- `collectedAt`;
- `reportedAt`;
- `processedAt`;
- `confirmedBy`;
- qualidade;
- precisão;
- anomalia;
- detalhes da origem.

Registros antigos sem esses metadados não recebem origem inventada. A ausência de proveniência reduz o score.

### Consensus Engine

Novo módulo: `consensus/engine.mjs`.

O horário consolidado utiliza:

- qualidade da evidência;
- peso/reputação da fonte;
- confiança da própria evidência;
- concordância temporal;
- quantidade de fontes independentes.

Conflitos explícitos deixam de contaminar o modelo.

### Reputação dinâmica das fontes

Cada fonte agora mantém:

- requests;
- sucessos;
- erros;
- registros fornecidos;
- registros avaliados;
- corretos;
- incorretos;
- duplicidades;
- erro temporal acumulado;
- atraso acumulado;
- consistência;
- falhas consecutivas;
- circuit state;
- suspensão temporária;
- confiabilidade dinâmica.

A reputação influencia diretamente:

- score de qualidade;
- consenso;
- peso da evidência.

### Circuit breaker

Depois de falhas consecutivas:

1. a fonte entra em `OPEN`;
2. seu peso cai drasticamente;
3. novas consultas são suspensas temporariamente;
4. depois do cooldown ela entra em `HALF_OPEN`;
5. uma tentativa controlada é feita;
6. sucesso retorna para `CLOSED`.

Uma fonte defeituosa não derruba as demais.

### Drift Detection

Novo módulo: `learning/drift.mjs`.

Compara intervalo recente com histórico anterior usando:

- mediana;
- MAD robusto;
- mudança relativa;
- mudança padronizada.

Quando drift é detectado:

- histórico antigo perde peso;
- comportamento recente ganha peso;
- a Central de Confiabilidade gera alerta.

### Distribuição probabilística

Novo módulo: `prediction/distribution.mjs`.

Em vez de depender apenas de um horário, o motor produz faixas de 30 minutos com probabilidades normalizadas.

Exemplo de estrutura:

```text
21:00–21:30  12%
21:30–22:00  41%
22:00–22:30  31%
22:30–23:00  16%
```

Esses valores são calculados a partir das previsões ponderadas dos modelos e da incerteza, sem números aleatórios.

### Boss Prediction Score

Score 0–100 com categorias:

- 95–100: CONFIABILIDADE MUITO ALTA
- 85–94: ALTA
- 70–84: MODERADA
- 50–69: BAIXA
- 0–49: DADOS INSUFICIENTES

Componentes do score:

- qualidade dos dados: 25%;
- quantidade de histórico: 20%;
- concordância dos modelos: 20%;
- qualidade das fontes: 15%;
- precisão aprendida dos métodos: 10%;
- estabilidade/comportamento: 10%.

O score não é tratado como probabilidade.

### Abstenção explícita

O motor agora pode responder:

> DADOS INSUFICIENTES PARA UMA PREVISÃO CONFIÁVEL.

O sistema se abstém quando a base não sustenta a previsão.

Um horário exato só é mostrado quando:

- existem dados confirmados suficientes;
- existe proporção suficiente de horários precisos;
- a incerteza não é excessiva;
- o Boss Prediction Score atinge o limite mínimo.

### Confidence Calibration

Novo módulo: `learning/calibration.mjs`.

Faixas avaliadas:

- 50–60%;
- 60–70%;
- 70–80%;
- 80–90%;
- 90–100%.

A calibração só altera automaticamente uma faixa quando existe amostra mínima. Antes disso, retorna `insufficient_calibration_data`.

Método atual: calibração empírica com shrinkage beta, preservando um prior para evitar reação excessiva a poucas observações.

### Champion / Challenger

Novo módulo: `learning/champion.mjs`.

Champion atual:

- `adaptive_ensemble`.

Challengers são executados em shadow mode e não alteram a previsão do usuário.

A promoção só é recomendada quando:

- existem pelo menos 30 previsões pareadas;
- o challenger possui MAE menor;
- o intervalo de confiança de 95% da melhoria é positivo;
- a melhoria supera margem mínima.

Não existe promoção baseada em 5 ou 10 resultados favoráveis.

### Baselines

O backtest agora compara:

- historical_mean;
- last_interval;
- empirical_median;
- recent_mean_10;
- recent_weighted;
- historical_interval;
- recent_interval;
- time_of_day;
- weekday;
- adaptive_ensemble.

Baselines também são armazenados como challengers shadow nas forecasts novas.

### Validação temporal

O backtest continua walk-forward e agora classifica os resultados em:

- development: primeiros 60%;
- validation: 60–80%;
- test: últimos 20%.

A calibração dentro do backtest também é sequencial: uma previsão só pode ser calibrada com previsões resolvidas anteriormente.

### Event sourcing / ledger

Novo módulo: `event-sourcing/ledger.mjs`.

Eventos de inteligência relevantes são registrados em uma cadeia de hashes SHA-256:

- evidência recebida;
- duplicidade;
- consolidação;
- criação/revisão da forecast;
- resolução;
- correção;
- remoção.

Cada entrada possui:

- sequence;
- tipo;
- timestamp;
- payload;
- hash anterior;
- hash atual.

Alterar um evento antigo quebra a verificação de integridade.

O runtime ainda mantém também o estado consolidado por performance; o ledger serve como trilha imutável/auditável.

### Versionamento

Toda forecast nova registra:

- `predictionEngineVersion`;
- `modelVersion`;
- `datasetVersion`.

Versão atual:

```text
prediction_engine = 4.0.0
model_family      = adaptive-ensemble-v4
```

### Central de Confiabilidade

A tela Inteligência agora possui a área **CENTRAL DE CONFIABILIDADE**, exibindo:

- qualidade dos dados;
- conflitos;
- quarentena;
- calibração;
- raw calibration error;
- drifts;
- integridade do ledger;
- alertas internos;
- Champion/Challenger;
- bosses com dados insuficientes;
- autoavaliação das últimas 100 previsões;
- métricas de observabilidade;
- proveniência detalhada de cada evidência.

---

## 4. Algoritmos ativos

### Produção

- historical interval;
- recent weighted interval;
- time of day;
- weekday;
- adaptive ensemble;
- robust spread/quantiles;
- drift-adjusted temporal weighting;
- calibrated confidence;
- data-quality weighted evidence consensus.

### Shadow / baseline

- média histórica;
- último intervalo;
- mediana;
- média das últimas 10;
- demais métodos individuais comparados com o Champion.

Nenhum modelo ML é anunciado como ativo atualmente. Não foi criada uma camada de “machine learning” apenas para usar esse nome.

---

## 5. Como a confiança é calculada

A confiança bruta do motor é composta atualmente por:

- qualidade dos dados: **22%**;
- quantidade/histórico: **22%**;
- concordância entre modelos: **20%**;
- confiabilidade das fontes: **16%**;
- qualidade temporal: **8%**;
- estabilidade/drift/anomalias: **12%**.

Depois disso a confiança passa pela camada de calibração empírica.

A interface mantém separados:

- probabilidade da janela;
- confiança calibrada;
- score geral;
- precisão histórica;
- MAE;
- quantidade de amostras.

Esses conceitos não são mais intercambiáveis.

---

## 6. Como os dados são validados

Fluxo atual:

```text
COLETAR
  ↓
NORMALIZAR + PROVENIÊNCIA
  ↓
VALIDAR CAMPOS/TEMPO
  ↓
DETECTAR ANOMALIA
  ↓
CALCULAR DATA QUALITY SCORE
  ↓
DEDUPLICAR
  ↓
CRUZAR EVIDÊNCIAS
  ↓
CONSENSUS ENGINE
  ↓
CLASSIFICAR / QUARENTENA
  ↓
ARMAZENAR + LEDGER
  ↓
LIBERAR OU BLOQUEAR APRENDIZADO
  ↓
MODELOS POR BOSS + SERVIDOR
  ↓
DRIFT / PESO TEMPORAL
  ↓
ENSEMBLE
  ↓
DISTRIBUIÇÃO DE PROBABILIDADE
  ↓
SCORE + CONFIANÇA BRUTA
  ↓
CALIBRAÇÃO
  ↓
ABSTENÇÃO OU FORECAST
  ↓
RESULTADO REAL
  ↓
ERRO / REPUTAÇÃO / GOVERNANÇA
```

---

## 7. Precisão atual de produção

**Não disponível no repositório.**

O estado operacional real não é versionado:

- não existe `data/state.json` no Git;
- previsões resolvidas de produção não ficam expostas no código-fonte.

Portanto, não é tecnicamente correto publicar uma precisão atual usando os dados sintéticos do CI.

A instalação real calcula esse valor na Central de Confiabilidade a partir das forecasts resolvidas.

---

## 8. Erro médio atual de produção

**Não disponível no repositório pelo mesmo motivo.**

O MAE real aparece no runtime somente quando há previsões resolvidas com horários precisos.

Eventos com apenas data não são convertidos em falso erro de minutos.

---

## 9. Qualidade atual dos dados de produção

**Não disponível offline no repositório.**

O runtime agora mede:

- score médio;
- quantidade avaliada;
- status por classe;
- conflitos;
- quarentena;
- anomalias.

O histórico legado recebe backfill de qualidade, mas campos de proveniência ausentes continuam ausentes e reduzem a nota.

---

## 10. Melhores e piores fontes

**Não é possível nomear honestamente uma melhor/pior fonte de produção sem o estado real.**

A Central de Confiabilidade só cria ranking quando a fonte possui pelo menos 5 evidências avaliadas.

Os indicadores disponíveis por fonte são:

- reliability;
- accuracyRate;
- averageErrorMinutes;
- averageDelayMinutes;
- consistency;
- successRate;
- averageLatencyMs;
- duplicates;
- circuitState.

---

## 11. Melhor modelo por boss

**Calculado dinamicamente no runtime.**

Não existe lista estática no código.

A combinação é sempre:

```text
BOSS + SERVIDOR
```

O painel mostra Champion, challengers, amostras e MAE de cada boss quando existe evidência suficiente.

---

## 12. Autoavaliação

A Central calcula para as últimas 100 forecasts resolvidas:

- acerto da janela;
- MAE;
- erro mediano;
- melhor boss, somente com >=5 amostras;
- pior boss, somente com >=5 amostras;
- melhor fonte, somente com >=5 avaliações;
- pior fonte, somente com >=5 avaliações;
- melhor método, somente com >=10 resultados;
- quantidade de drift;
- quantidade de anomalias.

Amostras insuficientes aparecem explicitamente como insuficientes.

---

## 13. Observabilidade da IA

Métricas expostas:

- `prediction_latency`;
- `prediction_error_minutes`;
- `source_accuracy`;
- `model_accuracy`;
- `confidence_calibration_error`;
- `data_quality_score`;
- `drift_score`;
- `anomaly_rate`;
- `prediction_volume`;
- conflitos;
- bosses em drift;
- bosses sem dados suficientes.

---

## 14. Testes e gates automáticos

A pipeline agora executa:

1. sintaxe de todo JS/MJS;
2. auditoria anti-IA-de-fachada;
3. testes funcionais;
4. regression gate temporal;
5. benchmark sintético de carga do núcleo;
6. fault injection dos componentes realmente ativos;
7. build hospedado;
8. smoke test;
9. Wrangler dry-run.

Resultado final desta etapa:

```text
56 arquivos JavaScript/MJS verificados
Núcleo de inteligência sem aleatoriedade ou dados simulados
51 testes
51 aprovados
0 falhos
regression gate: aprovado
load benchmark: aprovado
fault injection: aprovado
Cloudflare build: aprovado
smoke test: aprovado
Wrangler dry-run: aprovado
```

---

## 15. Benchmark temporal controlado

**IMPORTANTE: estes dados são sintéticos e servem somente como regression gate. Não são precisão de produção.**

Cenário determinístico:

- 140 eventos;
- mudança de regime de aproximadamente 72h para 58h;
- ruído determinístico;
- validação walk-forward;
- holdout temporal.

Resultado:

```text
Adaptive Ensemble MAE: 309,9 min
Historical Mean MAE:   347,1 min
Diferença:              -37,2 min
Melhoria relativa:      ~10,7%
ECE calibrado:          21,4 p.p.
Test holdout:
  25 previsões
  MAE 270 min
  erro mediano 211,3 min
  window accuracy 100%
```

Esse cenário demonstra que o ensemble supera a média histórica nesse regime específico. Ele **não prova** que supera todos os baselines em todos os bosses reais.

O Champion/Challenger do runtime existe justamente para impedir essa generalização.

---

## 16. Benchmark sintético de carga

Também não representa capacidade HTTP real.

Fixture:

```text
1.600 eventos
20 bosses
snapshot de previsões: ~65 KB
```

Execução final de referência:

```text
construção do snapshot: 246,7 ms

10 consumidores     -> fan-out em memória ~0,001 ms
100 consumidores    -> ~0,001 ms
1.000 consumidores  -> ~0,008 ms
10.000 consumidores -> ~0,081 ms
```

O principal resultado do teste foi arquitetural: ele revelou que a previsão não deve ser recalculada por consumidor.

Agora o motor constrói e cacheia o snapshot até a revisão dos dados mudar.

Para afirmar capacidade real de 10.000 usuários simultâneos ainda será necessário benchmark HTTP em infraestrutura definida, com:

- reverse proxy;
- TLS;
- CPU/memória conhecidos;
- banco relacional ativo;
- rede;
- número real de instâncias/workers.

---

## 17. Fault injection

O gate automatizado validou:

```text
sourceRecovery: true
queueRecovery: true
idempotency: true
invalidTimestampRejected: true
ledgerRestartRoundTrip: true
```

Foram testados:

- fonte ficando offline;
- circuit breaker;
- recuperação depois do cooldown;
- job falhando;
- próximo job funcionando;
- observação duplicada;
- timestamp impossível;
- serialização/restauração do ledger.

### Não aplicável ainda

- falha de banco real: o banco relacional ainda não é o runtime ativo;
- desconexão WebSocket: o sistema Node usa SSE e a hospedagem adaptada usa polling;
- worker distribuído: ainda não existe worker externo independente.

Esses casos serão obrigatórios quando esses componentes forem efetivamente ativados.

---

## 18. Comparação antes × depois desta etapa

### Antes

- 44 arquivos JS/MJS sob checagem global;
- 41 testes;
- confiança determinística, mas não calibrada de ponta a ponta;
- sem Data Quality Engine formal;
- sem Consensus Engine;
- sem quarentena formal;
- sem circuit breaker integrado ao polling;
- sem distribuição probabilística;
- sem Champion/Challenger com significância;
- sem event ledger;
- sem versionamento de forecasts;
- sem temporal development/validation/test;
- sem regression gate estatístico;
- sem benchmark de 10/100/1k/10k consumidores;
- sem fault injection dedicado.

### Depois

- 56 arquivos JS/MJS sob checagem;
- 51 testes aprovados;
- qualidade individual por evidência;
- proveniência auditável;
- consenso e conflitos explícitos;
- reputação dinâmica de fontes;
- quarantine;
- circuit breaker;
- drift;
- pesos temporais adaptativos;
- distribuição de probabilidade;
- score geral;
- abstenção;
- confiança calibrada;
- baselines;
- Champion/Challenger;
- teste pareado de significância;
- holdout temporal;
- ledger encadeado;
- versionamento;
- Central de Confiabilidade;
- autoavaliação;
- observabilidade da IA;
- regression/load/fault gates.

Não foi calculado um “antes × depois de precisão real” porque o histórico de produção não está versionado. Inventar esse número violaria justamente o objetivo desta etapa.

---

## 19. Problemas que ainda existem

### 1. Persistência operacional ainda é monolítica

Este continua sendo o maior risco técnico.

O schema relacional foi ampliado para suportar:

- qualidade;
- proveniência;
- reputação;
- circuit state;
- forecast versions;
- distribuição;
- calibration;
- ledger;
- model governance;
- intelligence alerts.

Mas ele ainda não é a persistência principal.

### 2. Ledger dentro do estado legado crescerá indefinidamente

Isso é aceitável temporariamente para preservar imutabilidade, mas aumenta ainda mais a necessidade de migração para banco.

### 3. Não existe benchmark HTTP de produção

O teste atual é do núcleo.

Para 10.000 usuários reais deve ser utilizado ambiente reproduzível de staging.

### 4. Não existe RBAC completo/multiusuário

A autenticação protege o painel, mas não há papéis individuais completos por usuário.

### 5. Alertas adaptativos ainda não substituem automaticamente os alertas legados

Isso é intencional.

Antes de migrar push para o novo motor, deve existir baseline real de calibração/precisão no runtime.

### 6. ECE do benchmark controlado ainda é 21,4 p.p.

A calibração agora funciona e o regression gate impede regressão acima de 25 p.p. nesse fixture, mas 21,4 ainda é um erro relevante.

Prioridade futura: reduzir esse erro com mais dados reais e calibradores mais robustos, sem overfitting.

### 7. Machine Learning não está ativo

Isso é proposital.

Antes de adicionar ML é necessário verificar se a quantidade de dados precisos por boss/servidor é suficiente e se um modelo complexo supera baselines em holdout temporal.

---

## 20. Próximos passos recomendados

Ordem técnica recomendada:

1. concluir a migração do estado operacional para PostgreSQL;
2. migrar o ledger para tabela append-only transacional;
3. criar backup, restore e migration checksum;
4. coletar um baseline real de produção por pelo menos dezenas/centenas de forecasts resolvidas;
5. avaliar calibração por boss somente onde houver amostra suficiente;
6. criar teste HTTP de staging com 10/100/1k/10k conexões;
7. adicionar RBAC se houver múltiplos operadores;
8. criar worker distribuído para coleta/backtest somente após banco/queue externos;
9. avaliar ML como Challenger, nunca como substituição automática;
10. só promover ML quando superar baselines/Champion em holdout temporal e significância;
11. migrar alertas de boss para o motor adaptativo apenas nos bosses com score/calibração aprovados.

---

## Conclusão

A principal mudança desta etapa não foi adicionar “mais IA”.

Foi tornar o motor mais capaz de **duvidar dos próprios dados e das próprias previsões**.

Agora existe uma cadeia explícita:

```text
CONFIABILIDADE DOS DADOS
↓
CONFIABILIDADE DAS FONTES
↓
CONSENSO / QUARENTENA
↓
CONFIABILIDADE DOS MODELOS
↓
CALIBRAÇÃO DA PREVISÃO
↓
ABSTENÇÃO QUANDO NECESSÁRIO
↓
RESULTADO REAL
↓
REAVALIAÇÃO
↓
APRENDIZADO
```

O sistema está tecnicamente mais rigoroso, mas ainda não deve ser chamado de "estatisticamente preciso" até o histórico real do runtime produzir evidência suficiente.

Essa distinção é agora parte do próprio código.
