# Boss Radar — System Reliability 24x7

## Objetivo
Tornar o Boss Radar capaz de operar continuamente sem transformar falhas técnicas, lacunas de coleta ou degradação de fontes em falsas certezas.

Filosofia aplicada:

DETECTAR FALHA → ISOLAR → PRESERVAR DADOS → RECUPERAR → REPROCESSAR → VALIDAR → VOLTAR AO NORMAL → REGISTRAR.

## Antes
A plataforma já possuía:
- Lunarian Collector com heartbeat, fila local e coverage;
- circuit breaker de fontes;
- TaskQueue com prioridade e DLQ;
- event ledger da inteligência;
- Investigation Engine;
- Prediction Engine com Champion/Challenger;
- testes de failure injection;
- persistência atômica do estado;
- SSE/polling;
- MLOps, drift e calibration.

As principais lacunas operacionais eram:
- ausência de validação formal no startup;
- replay operacional limitado a lista de eventos, sem reconstrução do estado do fluxo;
- recovery retry podia permanecer preso em RECOVERING após falha;
- detecção de falha silenciosa do Collector dependia principalmente de heartbeat/DOM;
- reconciliação ainda não detectava algumas relações órfãs;
- outbox persistida era drenada no ciclo normal, mas não havia auditoria explícita do replay de startup.

## Depois

### System Health
Existe uma Central SYSTEM HEALTH baseada em heartbeats/checks reais.

Estados:
- HEALTHY
- DEGRADED
- UNAVAILABLE
- RECOVERING
- FAILED
- UNKNOWN

Componentes observados incluem:
backend, frontend, storage, database, collection, Lunarian Collector, WhatsApp Web, realtime, queue worker, persistent outbox, Investigation Engine, Prediction Engine, cache, backup/integrity e fontes.

O SYSTEM RELIABILITY SCORE permanece INSUFFICIENT DATA até existirem componentes suficientes medidos.

### Watchdog
O watchdog detecta heartbeat atrasado e componentes críticos degradados.

Auto-recovery:
- máximo de 3 tentativas;
- backoff de 30s, 2min e 10min;
- após esgotamento: atenção manual necessária;
- incidente e todas as tentativas ficam registradas.

Correção desta fase:
quando uma tentativa de recovery falha, o componente volta a FAILED em vez de permanecer artificialmente em RECOVERING. Isso garante que as próximas tentativas realmente ocorram dentro do backoff previsto.

### Silent Failure Detection do Lunarian
O Collector agora reporta também:
- observerAttached;
- lastScanAt;
- lastObserverEventAt.

Um heartbeat vivo não é suficiente para declarar HEALTHY.

São tratados como falha/degradação:
- MutationObserver não anexado;
- parser sem scan por período anormal;
- estrutura do WhatsApp alterada;
- heartbeat atrasado;
- clock skew superior a 2 minutos.

Ausência de mensagens, isoladamente, NÃO é tratada como falha.

### Persistent Outbox
Operações críticas utilizam outbox persistente e idempotency_key.

Fluxos protegidos incluem:
- confirmed event → intelligence ingest;
- investigation start;
- investigation decision;
- push notifications;
- remoção/reprocessamento de registros.

Prioridades:
CRITICAL, HIGH, NORMAL, LOW.

No startup, a outbox persistida é verificada e drenada antes de o backend anunciar operação normal.

O replay de startup registra:
- outboxBefore;
- outboxAfter;
- quantidade reprocessada;
- DLQ antes/depois.

### Exactly-once lógico
A entrega física pode ser at-least-once, mas operações usam idempotency keys.

Reenvio da mesma operação:
- reutiliza item em voo;
- não repete item já entregue;
- não deve gerar Evidence/Event/Notification duplicado.

### Dead Letter Queue
Após repetidas falhas, jobs são preservados com:
- payload;
- erro;
- stack quando disponível;
- tentativas;
- timestamp;
- origem;
- correlation_id;
- idempotency_key;
- prioridade.

A Central SYSTEM HEALTH permite:
REPROCESSAR / DESCARTAR / INSPECIONAR.

### Event Store e Trace
O event store operacional é hash-chained e imutável por append.

Eventos incluem, entre outros:
- EVIDENCE_CREATED
- CANDIDATE_CREATED
- CANDIDATE_UPDATED
- CANDIDATE_INVESTIGATION_QUEUED
- INVESTIGATION_PROCESSED
- HUMAN_DECISION_QUEUED
- INVESTIGATION_DECISION_PROCESSED
- CONFIRMED_EVENT_QUEUED_FOR_INTELLIGENCE
- INTELLIGENCE_INGESTED
- PREDICTION_UPDATED
- OUTBOX_ENQUEUED / DELIVERED / RETRY / DEAD_LETTER
- INCIDENT_OPENED / RESOLVED
- AUTO_RECOVERY_STARTED
- RECOVERY_ATTEMPT
- CONFIG_VERSION_CREATED / ROLLBACK.

### End-to-End correlation_id
CommunityEvidence e Candidate compartilham correlation_id.

É possível rastrear:
Evidence → Candidate → Investigation → Human Decision → Intelligence → Prediction.

Endpoint de trace permanece disponível e foi acrescentado replay estruturado por correlation_id.

O replay mostra:
- timeline ordenada;
- estado atual reconstruído;
- Evidence IDs;
- Candidate;
- Investigation;
- registros confirmados;
- outbox pendente;
- DLQ;
- violações de ordem;
- indicação replaySafe.

### Startup Validation
Antes da operação normal o backend valida:
- settings;
- world permitido;
- SITE_PASSWORD em ambiente autenticado;
- hash chain do Operational Event Store;
- ledger da inteligência;
- formato da DLQ;
- formato dos itens da outbox.

Configuração/estado estrutural crítico inválido causa fail-fast.

Também é validado se existem itens pendentes cujo handler não está registrado.

### Safe Mode
Safe Mode é aplicado de fato ao Prediction Engine.

Quando a operação está degradada:
- confidence recebe cap operacional;
- o motivo é explicado;
- não é apresentado como recalibração estatística.

CRITICAL:
confidence cap = 55 e horário exato é ocultado.

DEGRADED:
confidence cap = 75.

Kill switch da previsão retorna estado insuficiente e confidence 0.

### Data Integrity / Reconciliation
A auditoria periódica verifica:
- Evidence duplicada;
- Candidate duplicado;
- Canonical Event duplicado;
- forecast duplicado;
- Candidate sem Evidence;
- Candidate apontando para Evidence inexistente;
- CommunityEvidence órfã;
- confirmação WhatsApp apontando para Candidate inexistente;
- Event sem Evidence;
- intervalos impossíveis;
- eventos futuros;
- confirmed event com quality incompatível;
- Evidence associada a múltiplos events;
- timestamps fora de ordem;
- training data contamination;
- forecast sem model/dataset/feature/code version;
- ledger inconsistente;
- outbox pendente cujo efeito parece já existir.

Reparos automáticos ficam restritos a correções técnicas seguras. Eventos confirmados não são alterados silenciosamente.

### Training Data Audit
Dataset contaminado com evento não elegível gera problema CRITICAL e força degradação operacional.

Training eligible exige evento confirmado, qualidade válida, sem anomalia/quarentena e Evidence rastreável elegível para aprendizado.

### Backup / Restore
Backup rotativo A/B é criado aproximadamente a cada 6 horas.

Cada backup:
- é gravado atomicamente;
- recebe SHA-256;
- é relido;
- hash é comparado;
- JSON é parseado;
- estrutura mínima é validada.

Restore Test realmente lê e valida o backup.

Backup corrompido não é reportado como saudável.

### Incident Management
Incidentes possuem:
- INC-YYYYMMDD-NNNN;
- component;
- kind;
- severity;
- startedAt;
- detectedAt;
- resolvedAt;
- reason;
- rootCause;
- resolution;
- recovery attempts;
- autoRecovered;
- correlationId.

Ocorrências iguais são agrupadas para reduzir alert fatigue.

Métricas:
- MTTD;
- MTTR;
- self-healing %;
- incidents open/resolved;
- manual attention.

Sem amostra suficiente, ficam INSUFFICIENT DATA.

### Coverage
Coverage do Lunarian é baseada em períodos reais conectados.

Collection gaps continuam explícitos.

Regra mantida:
ausência de relato durante gap = NÃO SABEMOS.

### Clock Consistency
Internamente os timestamps permanecem epoch/UTC.

A UI converte para America/Sao_Paulo.

Collector envia clientNow e o backend mede clockSkewMs.

Skew acima de 2 minutos degrada o Collector para impedir interpretação excessivamente confiante de latência/timestamps.

### Regression Detection
Amostras operacionais são armazenadas e comparadas contra baseline robusto.

Métricas monitoradas:
- captureLatencyP95;
- outboxOldestAgeMs;
- errorCount;
- coveragePct;
- reliabilityScore;
- predictionLatencyMs;
- queueOldestAgeMs.

A regressão só é sinalizada com amostra mínima e desvio robusto relevante.

Não existem números fictícios para preencher baseline.

### Daily / Weekly Reliability
Relatórios diário e semanal usam dados operacionais medidos.

Antes de amostra suficiente:
INSUFFICIENT DATA.

### Kill switches e configuração
Controles:
- maintenanceMode;
- predictionDisabled;
- investigationDisabled;
- automationsPaused;
- source kill switch.

Configurações são versionadas.

Rollback de configuração é suportado onde tecnicamente seguro.

## Antes × Depois

| Área | Antes | Depois |
|---|---|---|
| Health | health parcial | componentes tipados + heartbeat real + score conservador |
| Silent failure | heartbeat/DOM | observer + scan + DOM + heartbeat + clock skew |
| Recovery | retries existentes | retry corrigido + backoff + limite + manual attention |
| Restart | ciclo normal drenava fila | startup replay explícito e auditado |
| Outbox | persistente | persistente + startup handler validation + replay audit |
| DLQ | existente | UI + replay/discard + correlation/idempotency |
| Trace | eventos por correlation | replay estruturado com estado e pendências |
| Integrity | duplicidades e contamination | órfãos + relacionamentos quebrados + outbox reconciliation |
| Safe mode | política criada | aplicada ao Prediction Engine com cap real |
| Backup | backup rotativo | backup + hash + restore test real |
| Incidents | básicos | agrupamento + MTTD/MTTR/self-healing |
| Regressão | limitada | baseline robusto e incidentes operacionais |
| Collector health | heartbeat | heartbeat + DOM + observer + scan + skew |

## Métricas atuais
Uptime: INSUFFICIENT DATA até existir janela real suficiente.
Coverage: calculado em runtime a partir do Collector real.
Eventos perdidos: medidos por missed detection/reconciliation; sem histórico operacional não é possível publicar taxa real.
Duplicidades: medidas em runtime e por auditoria de integridade.
Latência: P50/P95/P99 do collector já são medidas; baseline comparativo depende de uso real.
MTTR: INSUFFICIENT DATA até existirem incidentes resolvidos suficientes.
MTTD: INSUFFICIENT DATA até existirem incidentes resolvidos suficientes.
Self-healing: INSUFFICIENT DATA até existirem incidentes resolvidos suficientes.
System Reliability Score: só é publicado quando há componentes reais suficientes medidos.

## Limitações atuais
- PostgreSQL continua preparado/validado no CI, mas o runtime principal atual usa storage persistente próprio.
- PITR não é considerado ativo enquanto o runtime não utilizar um banco que suporte PITR de produção.
- Backup A/B atual é local ao storage do runtime; disaster recovery completo deve incluir cópia externa/independente da máquina.
- CPU, memória e disco do host dependem do ambiente de hospedagem e não podem ser medidos de forma universal pelo runtime atual.
- múltiplos Collectors ainda são arquitetura futura; a identidade revogável já existe, mas o fluxo atual é centrado em um Collector ativo.
- SLOs formais devem ser definidos após baseline real, não inventados.

## Regra operacional final
Se qualquer componente crítico estiver quebrado, o Boss Radar deve preferir:
DEGRADED / UNKNOWN / INSUFFICIENT DATA
em vez de confiança artificialmente alta.

Uma falha de observação nunca deve ser convertida em evidência negativa.
