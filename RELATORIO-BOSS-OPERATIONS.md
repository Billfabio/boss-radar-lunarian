# Boss Operations Intelligence — Real-Time Decision Intelligence

## Objetivo

Esta camada responde a uma pergunta diferente do Prediction Engine:

- Prediction Engine: **quando / com qual probabilidade o boss pode aparecer?**
- Investigation Engine: **um relato/candidato é verdadeiro?**
- Boss Operations Engine: **onde concentrar atenção e recursos agora?**

A camada operacional não altera a probabilidade produzida pelo Prediction Engine.

## Componentes

Implementação principal:

- `operations/engine.mjs`
- `operations-ui.mjs`
- `operations.test.mjs`
- migration `010_boss_operations_intelligence.sql`

Decision Engine atual:

- ID: `decision_rules_v1`
- versão: 1
- status: `CHAMPION`
- tipo: regras explicáveis
- promoção automática: desativada

Decision Challenger:

- ID: `decision_exploration_v1`
- status: `SHADOW`
- hipótese: aumentar o peso de Information Gap e Miss Risk pode melhorar Top-3 e reduzir misses sem aumentar falsos alarmes;
- não altera o ranking de produção;
- só pode ser avaliado prospectivamente;
- mínimo planejado para comparação séria: 30 eventos confirmados.

## Boss Priority Score

O Champion calcula Priority Score 0–100 por média ponderada somente dos componentes disponíveis.

Pesos V1:

| Componente | Peso |
| --- | ---: |
| oportunidade = max(probabilidade do modelo, sinal investigativo) | 25% |
| proximidade/atividade da janela | 15% |
| probability velocity positiva | 8% |
| Missed Detection Risk | 15% |
| Information Gap | 15% |
| Signal Momentum | 10% |
| Novel State | 5% |
| importância explícita do usuário (favorito) | 4% |
| Predictability Score | 3% |

Componentes indisponíveis não recebem números inventados: a fórmula renormaliza somente componentes mensuráveis.

O usuário marcar **ACOMPANHAR** não altera probabilidade nem score. Ele reduz apenas o intervalo operacional de atualização.

## Probabilidade versus prioridade

Priority Score é deliberadamente diferente de Probability.

Exemplo conceitual:

- boss com probabilidade alta + cobertura excelente + baixa incerteza pode ter prioridade operacional menor;
- boss com probabilidade moderada + fonte degradada + Lunarian incompleto + sinal recente pode receber prioridade maior.

`modelProbability` permanece exatamente a probabilidade fornecida pelo Prediction Engine.

## Boss State Engine

Estados implementados:

- DORMANT
- MONITORING
- WATCH
- RISING
- WINDOW_APPROACHING
- WINDOW_ACTIVE
- HIGH_PRIORITY
- POSSIBLE_SIGNAL
- UNDER_INVESTIGATION
- PENDING_CONFIRMATION
- CONFIRMED
- COOLDOWN
- ANOMALOUS
- INSUFFICIENT_DATA

Transições usam dados reais: prioridade, janela, velocity, candidatos, Investigation Engine, drift e confirmações.

## Probability Curve e Peak

O Command Center reutiliza `probabilityDistribution` do Prediction Engine.

Não cria uma segunda curva fictícia.

Exibe:

- curva temporal;
- janela;
- peak slot;
- peak probability time;
- probabilidade atual do Prediction Engine;
- Decision Confidence separado.

## Missed Detection Risk

Miss Risk mede risco operacional, não probabilidade de spawn.

Entradas:

- oportunidade atual;
- cobertura disponível;
- latência média observada;
- saúde/falha de fontes;
- força dos sinais;
- proximidade da janela.

A fórmula penaliza baixa cobertura e atraso principalmente quando o boss já possui oportunidade/sinal relevante.

## Information Gap Score

Information Gap 0–100 considera:

- falta de confiança calibrada;
- cobertura faltante;
- Lunarian/WhatsApp indisponível;
- incerteza temporal;
- Novel State;
- conflito investigativo.

Incerteza aumenta necessidade de investigação, não probabilidade de spawn.

## Decision Confidence

Separada de Priority.

Utiliza:

- Prediction Confidence;
- cobertura;
- Data Quality;
- confiança do Investigation Engine quando disponível;
- incerteza.

Possui teto por:

- cobertura;
- Safe Mode / degradação operacional.

Assim é possível ter:

- Priority alto;
- Decision Confidence moderado.

## Value of Information

Cada fonte elegível recebe VOI baseado somente em dados medidos:

- Information Gap atual;
- reliability;
- first detection rate;
- latency;
- especialização por boss, quando disponível;
- health;
- urgência;
- penalidade se a fonte já contribuiu ao caso.

Fontes OFFLINE/RATE_LIMITED/ERROR são penalizadas ou tornam-se inelegíveis.

Volume de mensagens não é usado como sinônimo de valor.

## Next Best Source

O Command Center ordena fontes por VOI.

A fonte selecionada é explicável e mostra:

- VOI;
- health;
- reliability;
- first detection rate;
- delay;
- se já contribuiu à investigação.

### Restrição de execução V1

Os conectores HTTP atuais de OT Boss Tracker e RubinOT Official ainda fazem parte de um fluxo global acoplado de refresh/merge.

Portanto:

- o engine **recomenda** a fonte;
- `CHECK_SOURCE` não afirma execução isolada automática;
- fontes HTTP elegíveis entram no próximo Adaptive Global Refresh;
- WhatsApp/Lunarian continua event-driven/heartbeat;
- execução seletiva por fonte será ativada somente após separar os conectores sem comprometer consistência do merge.

## Adaptive Polling V1

O refresh externo deixou de usar TTL fixo de 4 minutos.

Intervalos operacionais:

- prioridade muito alta: ~60 s;
- alta: ~2 min;
- média: ~5 min;
- baixa/média: ~10 min;
- baixa/dormant: até ~15 min.

O scheduler global usa a maior urgência atual.

Produção continua acima de experimentos.

AI Lab/Discovery continuam em prioridade LOW; investigações podem subir para CRITICAL quando Priority >= 85.

### Economia de queries

A métrica compara requests reais desde a ativação do Decision Engine contra baseline de refresh global a cada 4 minutos.

Ela permanece `INSUFFICIENT_DATA` enquanto não houver janela observacional suficiente.

## Active Investigation Planner

Quando Priority e Information Gap justificam ação, o engine cria plano com:

- resource_budget;
- source_budget;
- time_budget;
- fontes ordenadas por VOI;
- stop conditions.

Stop conditions:

- CONFIRMED;
- CONFIDENCE_SUFFICIENT;
- CANDIDATE_REJECTED;
- WINDOW_EXPIRED;
- INFORMATION_NO_LONGER_RELEVANT.

A investigação real continua sendo executada pelo Investigation Engine existente.

## Smart Alerting

Alert Value Score combina:

- Priority;
- Miss Risk;
- mudança desde último estado;
- Decision Confidence;
- existência de múltiplos reportadores independentes.

Níveis:

- INFO
- WATCH
- IMPORTANT
- HIGH
- CRITICAL

Somente IMPORTANT/HIGH/CRITICAL entram em push automático.

Guardrails:

- meaningful change obrigatório;
- cooldown;
- deduplicação;
- Smart Alert recente suprime alerta legado redundante do mesmo boss;
- CRITICAL pode ignorar cooldown;
- favoritos-only continua respeitado.

Controles de usuário:

- ACKNOWLEDGE
- SNOOZE
- FOLLOW CLOSELY
- UNFOLLOW

FOLLOW CLOSELY altera somente frequência da interface/polling daquele boss; nunca a probabilidade.

## Decision Timeline e Audit

Mudanças relevantes registram:

- timestamp;
- boss/world;
- previous_state;
- new_state;
- previous_priority;
- priority_score;
- inputs;
- reasons;
- Decision Engine version.

Também são mantidos snapshots prospectivos de ranking.

## Decision Backtesting

Não é produzido backtest retrospectivo fictício para períodos em que o Decision Engine não existia.

A avaliação usa snapshots gravados prospectivamente.

Métricas:

- Top-1 Hit Rate;
- Top-3 Hit Rate;
- Top-5 Hit Rate;
- Missed Boss Rate;
- Alert Precision;
- Alert Recall;
- False Alarm Rate;
- Early Warning Time.

O Champion e o Challenger Shadow são avaliados no mesmo snapshot/evento.

Antes de amostra suficiente:

`INSUFFICIENT_DATA`

Nenhuma promoção é permitida apenas por poucos eventos.

## Decision Champion / Challenger

Champion:
`decision_rules_v1`

Shadow:
`decision_exploration_v1`

O Shadow aumenta peso relativo de:

- Information Gap;
- Miss Risk;
- Novel State;

e reduz levemente exploitation puro.

Objetivo experimental:

melhorar Top-3 / Missed Boss Rate sem piorar Alert Precision.

`autoPromotion=false`.

## Detection Path

O Daily Operations Review usa o Investigation Engine já existente.

Para casos confirmados mostra:

- First Signal;
- Decisive Signal;
- sequência observada de evidências;
- timestamp;
- força da evidência.

### Counterfactual conservador

Para First/Decisive Signal, o sistema pergunta:

> depois de remover esta fonte do caminho observado, ainda existia evidência confirmável de outra fonte/grupo independente?

Resultados:

- `ALTERNATIVE_EVIDENCE_OBSERVED`
- `NO_OBSERVED_ALTERNATIVE`
- `NOT_APPLICABLE`

Isso é apenas análise de redundância observada.

Nunca é transformado automaticamente em:

> “sem a Fonte A o boss não seria detectado”.

## Source Contribution

O Daily Review agrega:

- quantidade de First Signals por fonte;
- quantidade de Decisive Signals por fonte;
- Detection Paths observados.

Com mais resultados, isso poderá alimentar experimentos sobre Action Policy/Source Budget no AI Lab.

## Action Outcomes

Existe registry de Action Outcomes para medir futuramente:

- ação;
- fonte;
- outcome;
- incerteza antes;
- incerteza depois;
- utilidade.

Value per Query e Information Gain só são reportados quando houver outcomes reais.

## Boss Command Center

Nova aba:

**Command Center**

Mostra:

- Top Priority Bosses;
- Active Investigation Plans;
- Priority;
- Probability;
- Decision Confidence;
- Miss Risk;
- Information Gap;
- Peak;
- Window;
- Probability Velocity;
- Adaptive Polling;
- Probability Curve;
- Next Best Action;
- Next Best Source + VOI;
- source ranking;
- Why Now?;
- What Would Change My Mind?;
- Operational Metrics;
- Champion vs Shadow;
- Daily Operations Review;
- Decision Replay.

Ordenações:

- Priority;
- Probability;
- Time to Peak;
- Miss Risk;
- Uncertainty.

Filtros por estado operacional.

A UI usa o SSE existente e o refresh atual; não foi criado outro canal realtime paralelo.

## Persistência

Migration:

`010_boss_operations_intelligence.sql`

Estruturas preparadas:

- decision_models;
- boss_decision_snapshots;
- decision_timeline;
- operations_alerts;
- operations_attention;
- operations_action_outcomes.

A aplicação atual continua respeitando a arquitetura de persistência existente em `state.json`; a migration prepara a representação PostgreSQL, mas não é descrita como store ativa até que o runtime seja migrado explicitamente.

## Limitações atuais

1. Métricas operacionais recém-criadas não possuem amostra prospectiva suficiente imediatamente após deploy.
2. Adaptive Polling V1 controla TTL global, não consulta HTTP totalmente seletiva por boss/fonte.
3. Value of Information usa reliability/latency/first detection/history medidos; não existe ainda modelo causal de information gain por query.
4. Counterfactual de fonte mede redundância observada, não causalidade.
5. Decision Challenger precisa acumular pelo menos 30 eventos antes de comparação útil.
6. Priority Score V1 possui pesos explicáveis definidos por política e deve ser desafiado pelo AI Lab, não tratado como ótimo.
7. Bosses sem previsão e sem sinais ficam explicitamente como `INSUFFICIENT_DATA`.

## Próximos experimentos recomendados

Após acumular amostra prospectiva:

1. Champion vs `decision_exploration_v1` em Top-3, Miss Rate e Alert Precision.
2. Testar novos pesos de Miss Risk somente no AI Lab/Shadow.
3. Medir information gain real por consulta e substituir heurística de VOI quando houver evidência suficiente.
4. Separar collectors HTTP para source-specific adaptive polling.
5. Testar action policy contextual em Shadow Mode.
6. Avaliar thresholds de Smart Alert com custo assimétrico de miss vs falso alarme.
7. Testar prioridade por regime/Novel State sem alterar probabilidade do Prediction Engine.

## Regra central

**Probability responde “o boss pode aparecer?”.**

**Priority responde “vale concentrar atenção aqui agora?”.**

A segunda nunca pode modificar artificialmente a primeira.
