# Relatório — Camada de Confiabilidade da Inteligência

**Projeto:** Boss Radar RubinOT  
**Branch:** `feature/intelligent-boss-radar`  
**Engine:** `4.1.0`  
**Família de modelos:** `adaptive-ensemble-v4.1`

## Objetivo desta etapa

Esta etapa não teve como foco adicionar mais telas ou aparentar maior inteligência. O objetivo foi fortalecer a sequência:

```text
QUALIDADE DOS DADOS
↓
CONFIABILIDADE DAS FONTES
↓
CONFIABILIDADE DOS MODELOS
↓
CONFIABILIDADE DA PREVISÃO
↓
RESULTADO REAL
↓
APRENDIZADO
```

A regra adotada foi: **o sistema deve preferir não prever a apresentar uma previsão sem sustentação estatística suficiente.**

---

# 1. O que já existia

Antes desta rodada, o projeto já possuía:

- normalização de evidências;
- rastreabilidade básica de fonte;
- deduplicação;
- eventos consolidados;
- reputação Bayesiana de fontes;
- anomalia de reaparecimento precoce;
- backtest walk-forward;
- modelos por boss + servidor;
- ensemble adaptativo;
- aprendizado de erro por método;
- confiança determinística;
- calibração empírica inicial;
- drift detection;
- baselines;
- Champion/Challenger;
- event ledger hash-chained;
- circuit breaker por falhas HTTP;
- Central de Confiabilidade;
- health check;
- fila de processamento;
- observabilidade;
- CI contra aleatoriedade/mocks no motor;
- fault injection;
- benchmark sintético;
- testes unitários e integração.

A auditoria desta etapa verificou quais desses componentes realmente estavam conectados ao fluxo de produção e encontrou pontos onde a implementação ainda era permissiva ou semanticamente imprecisa.

---

# 2. Problemas encontrados e corrigidos

## 2.1 Consenso permissivo demais

O Consensus Engine anterior tolerava até três horas de diferença entre fontes consideradas precisas.

Isso significava que algo equivalente a:

```text
Fonte A: 21:42
Fonte B: 23:15
```

poderia não ser classificado como conflito.

### Correção

Para evidências de minuto:

- até 15 min: forte concordância;
- até 45 min: ainda pode ser conciliável;
- acima de 45 min entre fontes de minuto: **CONFLITANTE**.

Quando a precisão é horária, o limite é mais amplo, mas continua explicitamente controlado.

O teste automatizado agora cobre exatamente `21:42 × 23:15`.

---

## 2.2 Qualidade confundia recorrência com consistência

O antigo componente de consistência comparava o novo horário com o evento histórico confirmado mais próximo.

Esse critério poderia punir uma aparição legítima apenas porque ela ocorreu dias depois.

### Correção

A qualidade agora separa:

- **corroboração entre fontes para o mesmo evento**;
- **anomalia do intervalo entre eventos**.

São problemas estatísticos diferentes e não devem ser misturados.

---

## 2.3 Fontes antigas podiam conservar reputação alta demais

A reputação era fortemente acumulativa.

Uma fonte excelente por meses poderia continuar influente depois de iniciar uma sequência recente de erros.

### Correção

O peso atual combina:

- reputação base;
- posterior Bayesiano de longo prazo;
- desempenho recente;
- consistência;
- estado do circuit breaker.

A janela recente é limitada e reconstruível.

Uma fonte automática com deterioração grave e sustentada pode ser temporariamente colocada em quarentena mesmo que a API continue tecnicamente online.

---

## 2.4 Erro médio da fonte misturava precisão diária e precisão de minuto

Um erro temporal de uma informação que dizia apenas “ocorreu neste dia” não pode ser comparado diretamente com uma informação que dizia “ocorreu às 21:43”.

### Correção

As fontes agora possuem métricas separadas para evidências temporais precisas:

- `preciseEvaluatedRecords`;
- `preciseCorrectRecords`;
- `preciseAccuracyRate`;
- `averageErrorMinutes` apenas para registros de minuto/hora.

Dados diários continuam úteis, mas não fabricam precisão em minutos.

---

## 2.5 Distribuição de probabilidade podia ser visualmente enganosa

A distribuição era sempre normalizada dentro de apenas 4 horas, mesmo quando a incerteza calculada era muito maior.

### Correção

A grade agora acompanha a janela real de incerteza.

O painel a identifica explicitamente como:

> **Distribuição condicional dentro da janela modelada**

Ela não é confundida com a probabilidade geral de spawn na janela.

---

## 2.6 Explicação da confiança não refletia calibração final

Depois da calibração histórica, a confiança mostrada ao usuário podia ser diferente da soma das parcelas explicadas.

### Correção

Agora são mantidos separadamente:

- confiança bruta;
- ajuste de calibração;
- confiança final;
- método de calibração;
- número de amostras usadas.

A explicação registra quando não existem dados suficientes para calibrar.

---

## 2.7 Dataset version podia não mudar após correção antiga

A versão do dataset dependia principalmente da quantidade e do evento mais recente.

Uma correção em um evento antigo poderia alterar o treinamento sem alterar a versão.

### Correção

A versão agora inclui um hash SHA-256 derivado de todos os eventos confirmados relevantes do boss + servidor.

Correções históricas alteram a `datasetVersion`.

---

## 2.8 Ensemble estava perdendo de um baseline simples

Ao fortalecer o gate temporal, apareceu uma regressão que os testes anteriores não revelavam.

Resultado inicial do novo holdout:

```text
Adaptive Ensemble MAE: 291,4 min
recent_mean_10 MAE:     116,9 min
```

Isso foi tratado como falha real, não como motivo para afrouxar o teste.

### Correções no ensemble

1. centro do ensemble passou de média ponderada para **mediana ponderada robusta**;
2. modelos simples fortes passaram a competir dentro do ensemble:
   - recent_mean_10;
   - last_interval;
   - historical_mean;
3. os pesos passaram a reagir ao desempenho relativo aprendido por boss + servidor;
4. modelos significativamente piores perdem peso exponencialmente depois de amostra mínima;
5. drift aumenta peso recente e reduz peso histórico quando apropriado.

Evolução observada no mesmo teste temporal:

```text
Antes do reforço:                291,4 min
Mediana ponderada robusta:       147,3 min
Baselines incorporados:          141,1 min
Peso competitivo por desempenho: 116,9 min
Melhor baseline:                  116,9 min
```

### Resultado

O ensemble deixou de apresentar a regressão grave.

**Importante:** neste cenário sintético específico ele **igualou**, mas não superou, o melhor baseline.

Portanto, este relatório não afirma que o ensemble é superior universalmente a `recent_mean_10`.

---

# 3. Data Quality Engine ativo

Cada evidência recebe score de 0 a 100 antes de participar do aprendizado.

## Componentes atuais

| Componente | Peso |
| --- | ---: |
| Rastreabilidade / provenance | 15% |
| Precisão temporal | 14% |
| Freshness / atraso | 10% |
| Reputação da fonte | 20% |
| Corroboração independente | 16% |
| Validade estrutural | 5% |
| Anomalias | 14% |
| Unicidade | 6% |

### Rastreabilidade

O sistema verifica se existem efetivamente:

- evidence ID;
- source ID;
- boss;
- servidor;
- horário informado;
- horário de processamento;
- método de coleta conhecido;
- URL/identificador da origem conhecido.

Strings como `unknown` não recebem crédito por “ter um campo preenchido”.

### Corroboração

A evidência ganha qualidade quando outra fonte independente confirma temporalmente o mesmo evento.

A ausência de outra fonte não é tratada como confirmação.

### Anomalias

Existem tetos duros:

- anomalia impossível: no máximo 34/100;
- `too_soon`: no máximo 54/100;
- outlier robusto: no máximo 64/100.

Assim outros fatores positivos não podem “compensar” uma anomalia grave.

Correções humanas explícitas permanecem uma referência especial e auditada.

---

# 4. Estados de qualidade / quarentena

Os estados usados são:

- `CONFIRMADO`;
- `PROVÁVEL`;
- `AGUARDANDO_CONFIRMAÇÃO`;
- `CONFLITANTE`;
- `SUSPEITO`;
- `DESCARTADO`.

Dados suspeitos continuam armazenados.

Eles não desaparecem do histórico, mas ficam fora do conjunto principal de treinamento/previsão até possuírem qualidade suficiente.

---

# 5. Proveniência completa

As observações normalizadas podem registrar:

- fonte;
- identificador/URL;
- método de coleta;
- horário informado pela fonte;
- horário de coleta;
- horário de processamento;
- boss;
- servidor;
- precisão;
- usuário responsável pela confirmação, quando aplicável.

A previsão carrega também um resumo das **fontes efetivamente utilizadas no dataset daquela previsão**, incluindo:

- quantidade de registros usados;
- quantidade de registros precisos;
- qualidade média;
- reputação da fonte;
- acurácia recente;
- erro médio temporal preciso;
- circuit state;
- referências/URLs das evidências.

URLs HTTP/HTTPS podem ser abertas pela Central de Confiabilidade.

Identificadores internos são exibidos como identificadores e não fingem ser links externos.

---

# 6. Reputação dinâmica das fontes

A reputação não é uma porcentagem aleatória.

O peso interno combina:

```text
38% peso base
32% posterior histórico
20% desempenho recente
10% consistência
× fator do circuit breaker
```

O posterior histórico é atualizado com evidência independente.

Correções humanas são referência de ground truth e não são avaliadas contra elas mesmas.

## Métricas por fonte

A Central pode mostrar:

- reputação atual;
- acurácia histórica observada;
- acurácia recente;
- amostras recentes;
- registros avaliados;
- registros corretos/incorretos;
- erro médio em evidências precisas;
- registros precisos avaliados;
- duplicidades;
- atraso médio;
- sucesso das consultas;
- latência média;
- erros consecutivos;
- estado do circuito.

---

# 7. Circuit breaker de qualidade e disponibilidade

Uma fonte pode ser suspensa por dois motivos independentes.

## Falha técnica

Exemplo:

- HTTP error;
- timeout;
- indisponibilidade.

Após falhas consecutivas, o circuito abre temporariamente.

Depois do cooldown:

```text
OPEN
↓
HALF_OPEN
↓
consulta de teste
↓
CLOSED ou OPEN novamente
```

## Deterioração dos dados

Uma fonte automática pode continuar respondendo HTTP 200 e mesmo assim enviar dados ruins.

Se houver uma sequência recente suficientemente grande e a acurácia cair gravemente, ela também pode ser colocada em quarentena.

O fault injection testa os dois cenários.

---

# 8. Consensus Engine

O consenso utiliza:

- fontes independentes;
- reputação das fontes;
- Data Quality Score;
- confiança da evidência;
- mediana ponderada;
- dispersão;
- sobreposição de intervalos.

Quando as fontes discordam excessivamente:

```text
qualityStatus = CONFLITANTE
```

O evento continua armazenado, mas não entra normalmente no aprendizado.

---

# 9. Anomaly Detection

Atualmente são tratados, entre outros:

## Reaparecimento precoce

Se o intervalo estiver drasticamente abaixo do comportamento conhecido.

## Intervalo extremamente longo

Depois de histórico suficiente, o sistema usa:

- mediana;
- MAD (Median Absolute Deviation);
- escala robusta;

para identificar intervalos muito acima do padrão.

Esse estado não afirma automaticamente “fonte falsa”.

A mensagem considera possibilidades como:

- evento intermediário não observado;
- mudança de regime;
- dado incorreto;
- comportamento excepcional.

O ponto principal é: **a evidência não altera imediatamente o modelo principal**.

---

# 10. Drift Detection

O sistema compara intervalos recentes com o histórico anterior usando estatística robusta.

São calculados:

- mediana histórica;
- mediana recente;
- MAD;
- mudança percentual;
- drift score.

Quando existe drift relevante:

- o histórico antigo perde peso;
- modelos recentes ganham peso;
- é gerado alerta interno;
- a informação aparece na explicação.

---

# 11. Algoritmos ativos

Hoje os seguintes métodos podem competir no motor adaptativo:

### Intervalo

- `historical_interval` — mediana histórica robusta;
- `recent_interval` — mediana recente com peso temporal;
- `recent_mean_10` — média das últimas aparições;
- `last_interval` — último intervalo;
- `historical_mean` — média histórica.

### Temporal

- `time_of_day` — padrão circular de horário;
- `weekday` — concentração por dia da semana.

### Ensemble

- `adaptive_ensemble`.

O ensemble utiliza:

- peso inicial por tipo de método;
- quantidade de dados;
- desempenho histórico aprendido;
- desempenho relativo aos outros modelos;
- concentração do padrão;
- drift;
- recência;
- estabilidade.

O centro final usa **mediana ponderada robusta**.

### Machine Learning

Nenhum modelo externo de ML é anunciado como ativo.

Não foi criado “ML de fachada”.

O projeto deve incorporar ML apenas quando houver quantidade suficiente de resultados reais temporais e o modelo superar os baselines em validação temporal.

---

# 12. Baselines obrigatórios

O backtest contém referências simples:

- historical_mean;
- last_interval;
- empirical_median;
- recent_mean_10;
- recent_weighted.

Modelos complexos são comparados com essas referências.

O gate de CI seleciona o baseline usando somente a fase de **validação** e mede o resultado final no **teste temporal**.

---

# 13. Prevenção de data leakage / overfitting

O backtest continua walk-forward:

Para prever evento `N`, somente eventos `1..N-1` podem ser utilizados.

Além disso, as previsões históricas são separadas temporalmente em:

- desenvolvimento;
- validação;
- teste.

O baseline concorrente é escolhido na validação.

O teste final não participa da escolha.

Também existe calibração separada por split.

---

# 14. Champion / Challenger

Champion atual:

- `adaptive_ensemble`.

Challengers fazem previsões paralelas.

Uma recomendação de promoção agora requer:

- pelo menos 50 previsões pareadas;
- melhoria estatisticamente significativa;
- pelo menos 5% de melhoria relativa de MAE;
- queda de hit rate não superior a 2 p.p.

Poucos acertos não são suficientes para substituir produção.

O sistema atualmente **recomenda**, mas não promove automaticamente, o que reduz risco de troca prematura.

---

# 15. Probabilidade, confiança, precisão e erro são métricas diferentes

O projeto agora mantém essas interpretações separadas.

## Probabilidade

Estimativa empírica de ocorrência dentro da janela prevista.

## Confiança

Qualidade da própria previsão/modelagem, posteriormente calibrada com resultados históricos.

## Precisão histórica

Taxa de janelas que realmente incluíram o evento observado.

## Erro médio

Erro temporal em minutos — somente quando o resultado real possui hora suficientemente precisa.

## Dados utilizados

Número de eventos aprovados e qualificados no dataset boss + servidor.

Nenhuma dessas métricas deve ser usada como sinônimo de outra.

---

# 16. Como a confiança é calculada

Antes da calibração, a confiança bruta combina:

| Fator | Peso |
| --- | ---: |
| Qualidade dos dados | 22% |
| Histórico / amostra | 22% |
| Concordância entre modelos | 20% |
| Confiabilidade das fontes | 16% |
| Qualidade temporal | 8% |
| Estabilidade | 12% |

Depois:

```text
confiança bruta
↓
histórico de previsões resolvidas
↓
faixa de confiança
↓
acerto empírico
↓
shrinkage para evitar reação exagerada
↓
confiança calibrada
```

A calibração só passa a ajustar a confiança quando há amostra mínima.

São calculados:

- ECE — Expected Calibration Error;
- MCE — Maximum Calibration Error;
- Brier Score.

---

# 17. Boss Prediction Score

Existe score geral 0–100 que considera:

| Fator | Peso |
| --- | ---: |
| Qualidade dos dados | 25% |
| Tamanho do histórico | 20% |
| Concordância entre modelos | 20% |
| Qualidade das fontes | 15% |
| Performance aprendida | 10% |
| Estabilidade | 10% |

Classificação:

- 95–100: CONFIABILIDADE MUITO ALTA;
- 85–94: ALTA;
- 70–84: MODERADA;
- 50–69: BAIXA;
- abaixo de 50: DADOS INSUFICIENTES.

Além do score, existe uma política de abstenção independente.

---

# 18. Saber quando NÃO prever

Foi criada uma política central de abstenção.

A previsão de janela pode ser recusada quando existir, por exemplo:

- menos de 6 aparições confirmadas e aprovadas;
- qualidade abaixo de 60/100;
- score abaixo de 55;
- alta taxa de anomalias com amostra pequena;
- baixa concordância entre modelos com pouca amostra;
- incerteza quase tão ampla quanto o próprio intervalo típico;
- incerteza absoluta superior a 21 dias.

Para mostrar minuto exato, os requisitos são mais rígidos:

- pelo menos 8 aparições temporais precisas;
- pelo menos metade do histórico com hora;
- incerteza <= 12 horas;
- score >= 70;
- todos os critérios da janela aprovados.

Quando recusado:

```text
DADOS INSUFICIENTES PARA UMA PREVISÃO CONFIÁVEL.
```

O sistema retorna os motivos de abstenção.

---

# 19. Distribuição de incerteza

A previsão pode retornar blocos temporais probabilísticos.

O número/tamanho dos blocos acompanha a incerteza real.

Cada bloco deriva dos métodos ativos, seus pesos e dispersões.

A distribuição é identificada como condicional à janela para evitar interpretação equivocada.

---

# 20. Event sourcing e histórico de correções

O projeto mantém um ledger encadeado por SHA-256.

Eventos registrados incluem, entre outros:

- evidência recebida;
- evidência duplicada;
- evento consolidado;
- forecast criado;
- forecast revisado;
- forecast resolvido;
- solicitação de correção;
- correção efetivada;
- remoção de evidência.

Uma correção não apaga silenciosamente o fato de que antes havia outro valor.

Também existe teste de integridade do encadeamento.

### Limitação

O ledger é **tamper-evident em nível lógico**, mas atualmente está armazenado junto ao estado operacional legado.

Ele ainda não é um event store externo fisicamente imutável.

---

# 21. Versionamento

Cada forecast persiste:

- prediction engine version;
- model family version;
- dataset version.

Versões atuais:

```text
prediction_engine: 4.1.0
model_family: adaptive-ensemble-v4.1
dataset_version: hash específico de boss + servidor + eventos
```

---

# 22. Central de Confiabilidade

A área administrativa agora mostra:

- qualidade geral dos dados;
- conflitos;
- eventos em quarentena;
- anomalias;
- fontes;
- circuit breaker;
- reputação;
- acurácia recente;
- erro temporal preciso;
- duplicidades;
- calibração ECE/MCE/Brier;
- drift;
- Champion / Challengers;
- bosses sem dados suficientes;
- autoavaliação das últimas 100 previsões;
- integridade do ledger;
- observabilidade da IA;
- alertas internos.

---

# 23. Explicabilidade real

Em “Por que esta previsão?” estão disponíveis dados derivados da própria previsão:

- última aparição;
- amostra utilizada;
- qualidade dos dados;
- intervalo histórico;
- intervalo recente;
- modelos;
- peso de cada modelo;
- erro aprendido de cada método;
- hit rate aprendido;
- amostra aprendida;
- fontes realmente usadas;
- reputação das fontes;
- referências/URLs;
- evidências excluídas por anomalia;
- conflitos;
- quarentena;
- drift;
- score;
- confiança bruta;
- calibração;
- distribuição probabilística.

Os detalhes relevantes são persistidos junto ao forecast.

---

# 24. Autoavaliação

A inteligência gera resumo sobre as últimas previsões resolvidas:

- quantidade;
- quantidade com horário preciso;
- window accuracy;
- MAE;
- mediana do erro;
- melhor boss;
- pior boss;
- melhor fonte;
- pior fonte;
- melhor método;
- drifts;
- anomalias.

São exigidos mínimos de amostra antes de classificar “melhor” e “pior”.

---

# 25. Alertas internos inteligentes

A Central pode gerar alertas para:

- fonte com circuit breaker aberto;
- fonte de baixa reputação;
- queda forte de acurácia recente contra histórico;
- deterioração global da previsão;
- drift por boss;
- conflitos entre fontes;
- Challenger estatisticamente superior;
- volume de evidências anormalmente alto.

---

# 26. Observabilidade da IA

Métricas disponíveis incluem:

- `prediction_latency`;
- `prediction_error_minutes`;
- `source_accuracy`;
- `source_reputation`;
- `model_accuracy`;
- `model_accuracy_by_method`;
- `confidence_calibration_error`;
- `confidence_calibration_max_gap`;
- `confidence_brier_score`;
- `data_quality_score`;
- `drift_score`;
- `anomaly_rate`;
- `prediction_volume`;
- conflitos e bosses insuficientes.

`source_accuracy` e `source_reputation` agora são semanticamente diferentes.

---

# 27. IA de fachada

O CI executa uma inspeção automática do núcleo:

- prediction;
- learning;
- intelligence;
- metrics;
- sources;
- normalization;
- deduplication.

O pipeline reprova uso de:

- `Math.random()`;
- mocks;
- fake;
- fixture;
- dummy

dentro do motor de inteligência de produção.

Dados sintéticos existem apenas em scripts explicitamente identificados como testes.

Na execução final:

```text
Núcleo de inteligência sem aleatoriedade ou dados simulados.
```

---

# 28. Testes automatizados

Na execução final utilizada neste relatório:

```text
57 arquivos JavaScript/MJS verificados
60 testes executados
60 testes aprovados
0 falhas
```

São cobertos, entre outros:

- qualidade;
- quarentena;
- consenso;
- conflito 21:42 × 23:15;
- deduplicação;
- correção humana;
- reputação;
- deterioração de fonte;
- circuito;
- calibração;
- drift;
- abstenção;
- distribuição;
- Champion/Challenger;
- ledger;
- dataset version;
- outlier robusto;
- backtest temporal;
- autenticação;
- rate limit;
- WhatsApp;
- push;
- coleta;
- notificações.

---

# 29. Gate de regressão da inteligência

O CI não aceita automaticamente uma alteração só porque os testes unitários passam.

Existe um gate temporal específico.

Ele:

1. cria série determinística com mudança de regime;
2. executa walk-forward;
3. separa desenvolvimento / validação / teste;
4. escolhe o melhor baseline na validação;
5. avalia o ensemble no holdout;
6. verifica calibração quando existe amostra suficiente.

No cenário atual:

```text
Baseline selecionado na validação: recent_mean_10
MAE do ensemble no teste:          116,9 min
MAE do baseline no teste:          116,9 min
```

O resultado confirma ausência da regressão grave anterior.

Ele **não prova superioridade do ensemble**.

---

# 30. Comparação antes × depois

O novo gate revelou uma fraqueza que antes não era detectada.

```text
MAE teste temporal do ensemble

inicial:                        291,4 min
após mediana robusta:           147,3 min
após incorporar baselines:      141,1 min
após ranking competitivo:       116,9 min

baseline recent_mean_10:        116,9 min
```

Redução do erro do ensemble neste teste:

```text
291,4 → 116,9 min
redução absoluta = 174,5 min
redução relativa ≈ 59,9%
```

Este número é de um **teste temporal sintético e determinístico**, não da produção.

---

# 31. Fault injection

O pipeline injeta falhas de maneira controlada.

A última execução confirmou:

```text
sourceOfflineRecovery: true
sourceQualityDeteriorationQuarantine: true
rateLimitBurstProtection: true
queueRecovery: true
idempotency: true
invalidTimestampRejected: true
ledgerRestartRoundTrip: true
```

### Casos que ainda não podem ser testados honestamente

```text
databaseFailure:
not-applicable-runtime-database-not-active

websocketFailure:
not-applicable-runtime-uses-sse-or-polling
```

Isso é deliberado: o relatório não simula componentes que não estão ativos.

---

# 32. Teste de carga

O benchmark anterior media apenas fan-out em memória.

Agora ele cria um servidor HTTP Node real em loopback e envia requests reais.

Execução final:

| Clientes virtuais | Throughput | p95 |
| ---: | ---: | ---: |
| 10 | 320,5 req/s | 26,7 ms |
| 100 | 1.478,4 req/s | 60,3 ms |
| 1.000 | 1.980,8 req/s | 162,0 ms |
| 10.000 | 1.872,0 req/s | 174,2 ms |

Não houve falhas nesse benchmark.

### Limites do resultado

Isto mede:

- inferência do snapshot;
- entrega HTTP local;
- runtime Node;
- serialização/transporte loopback.

Não mede:

- Internet;
- TLS/reverse proxy real;
- banco de produção;
- APIs externas;
- múltiplas máquinas;
- latência geográfica.

Portanto não deve ser interpretado como promessa de 10.000 usuários simultâneos em produção.

---

# 33. Precisão atual de produção

**Indisponível a partir do GitHub.**

O estado real com forecasts resolvidos pertence ao runtime e não é versionado no repositório.

Não existe justificativa técnica para inventar uma porcentagem.

A Central calcula automaticamente, quando os dados reais estão disponíveis:

- 7 dias;
- 30 dias;
- 90 dias;
- total;
- por boss;
- por método.

---

# 34. Erro médio atual de produção

**Indisponível no repositório.**

O MAE real depende dos forecasts resolvidos no runtime.

O sistema agora garante que erro em minutos seja calculado somente quando o resultado real possui precisão temporal suficiente.

---

# 35. Qualidade atual dos dados de produção

**Indisponível no GitHub sem o estado operacional.**

O Data Quality Engine calcula o indicador automaticamente.

Não será utilizado o score dos fixtures de teste como se fosse qualidade de produção.

---

# 36. Melhores e piores fontes

**Não podem ser declaradas de forma real sem o histórico operacional atual.**

A Central faz essa classificação somente depois de amostra mínima.

Ela pode considerar:

- acurácia;
- reputação;
- erro temporal;
- duplicidades;
- disponibilidade;
- latência;
- atraso;
- desempenho recente.

---

# 37. Melhor modelo por boss

**Não existe uma lista real confiável dentro do GitHub porque depende dos resultados do runtime.**

O sistema calcula por:

```text
BOSS + SERVIDOR
```

e não globalmente.

O painel de backtest e Champion/Challenger mostra os resultados assim que há forecasts resolvidos suficientes.

---

# 38. Recuperação automática

Atualmente existem mecanismos para:

- fonte externa offline;
- cooldown / retry;
- recuperação de circuito;
- isolamento entre fontes;
- fila após falha de job;
- requisição duplicada/idempotência;
- reinício com estado persistido;
- stale snapshot identificado;
- rate limiting;
- restauração do ledger no restart.

A recuperação real de banco ainda depende da migração para banco ativo.

---

# 39. Riscos ainda existentes

## Alto — armazenamento operacional legado

O maior risco arquitetural continua sendo a persistência principal monolítica.

Mesmo com coalescência de gravação, ela não é a arquitetura adequada para milhões de eventos.

Existe:

- `database/schema.sql`;
- `database/repository.mjs`.

Mas o runtime ainda não usa o banco relacional como fonte operacional principal.

## Alto — event ledger não está em storage imutável independente

O ledger é hash-chained e detecta alteração, porém vive dentro do estado operacional.

Para auditoria forte, o ideal é persistência append-only/transacional no banco.

## Médio — Champion permanece ensemble

Existe recomendação de promoção, não troca automática.

Isso é proposital enquanto o volume real ainda é baixo.

## Médio — ML real ainda não foi ativado

Isso é uma decisão de qualidade.

Um modelo ML sem dataset suficiente apenas aumentaria complexidade e risco de overfitting.

## Médio — alertas de browser legados

O fluxo principal de push ainda é conservador e baseado na classificação diária existente.

Ele não foi migrado automaticamente para forecasts do novo motor sem primeiro comprovar calibração real.

## Médio — SSE/polling

Node usa SSE.

Hospedagem adaptada usa polling.

Não existe WebSocket para “parecer mais moderno”; ele deve ser adotado apenas se houver necessidade operacional comprovada.

---

# 40. Próximos passos recomendados

Prioridade técnica:

1. migrar o runtime para PostgreSQL/MySQL usando o contrato já preparado;
2. migrar ledger para tabela append-only transacional;
3. criar backup e restore automatizados;
4. rodar o backtest com todo o histórico real do runtime;
5. congelar baseline real por boss + servidor;
6. coletar volume suficiente para calibrar faixas de confiança por boss;
7. adicionar modelo ML somente quando houver dataset temporal adequado;
8. exigir que qualquer ML supere baselines no holdout temporal;
9. executar load test com banco real;
10. executar teste distribuído através de reverse proxy/TLS real;
11. criar RBAC/multiusuário se o painel for compartilhado;
12. somente depois avaliar promoção automática de Challenger.

---

# Conclusão

A principal melhoria desta etapa não foi “adicionar IA”.

Foi tornar o sistema mais capaz de dizer:

> **“Eu não tenho evidência suficiente.”**

O fluxo implementado está mais próximo de:

```text
COLETAR
↓
VALIDAR
↓
QUALIFICAR
↓
RASTREAR ORIGEM
↓
CRUZAR FONTES
↓
QUARENTENA / CONSENSO
↓
DETECTAR ANOMALIA
↓
ARMAZENAR + LEDGER
↓
DETECTAR DRIFT
↓
EXECUTAR MODELOS
↓
COMPARAR DESEMPENHO
↓
ENSEMBLE ROBUSTO
↓
ABSTER-SE SE NECESSÁRIO
↓
CALCULAR PROBABILIDADE
↓
CALCULAR CONFIANÇA
↓
CALIBRAR
↓
VERSIONAR
↓
EXPLICAR
↓
OBSERVAR RESULTADO REAL
↓
CALCULAR ERRO
↓
RECONSTRUIR PESOS
↓
APRENDER
```

O sistema ficou mais conservador e tecnicamente mais verificável.

E o novo gate de regressão provou a utilidade dessa abordagem: ele encontrou uma regressão grande do ensemble que os testes antigos não revelavam, bloqueou a alteração e obrigou o motor a ser corrigido antes de voltar ao estado verde.
