# Boss Investigation Engine — relatório técnico

## Objetivo
Transformar o CandidateBossEvent existente em uma investigação automática e explicável sem criar outra extensão, sem auto-confirmar WhatsApp e sem misturar o modelo investigativo com o Prediction Engine.

## Arquitetura anterior
Lunarian Collector → CommunityEvidence → CandidateBossEvent → cross-check simples → confirmação manual → inteligência principal.

Já existiam: Manifest V3, filtro local, fila/idempotência, reputação básica de reporters, registro/reputação/circuit breaker de fontes, consenso de eventos canônicos, Prediction Engine, Data Intelligence e SSE.

## Arquitetura atual
Lunarian Collector → CommunityEvidence → CandidateBossEvent → Boss Investigation Engine → Evidence Engine → Source Adapters → cross-check automático → consenso/conflito/anomalia/plausibilidade → dossiê → Recommended Action → decisão humana → Investigation Learning → somente CONFIRMAR/CORRIGIR segue para o dataset de previsão.

## Componentes
- investigation/evidence.mjs: tipos de evidência, freshness, reputação regularizada e decay.
- investigation/source-adapters.mjs: interface checkBoss/getRecentEvents/getSourceHealth/getReliability/getLatency.
- investigation/scoring.mjs: consenso, conflito, diversidade, coordenação, plausibilidade e calibração.
- investigation/engine.mjs: orquestração, timeline, dossiê, memória de casos, feedback, drift, incidentes, missed detection, backtest e Shadow challenger.
- database/migrations/006_investigation_engine.sql: estrutura relacional aditiva para migração futura.

## Evidências
Tipos suportados: COMMUNITY_REPORT, COMMUNITY_CONFIRMATION, COMMUNITY_NEGATION, WEBSITE_SIGNAL, API_SIGNAL, MANUAL_SIGNAL, SCREENSHOT_SIGNAL, HISTORICAL_SIGNAL, MODEL_SIGNAL e OFFICIAL_SIGNAL.

MODEL_SIGNAL e HISTORICAL_SIGNAL são contexto e nunca contam como confirmação independente. Isso impede circularidade do Prediction Engine.

## Candidate Confidence
O engine calcula primeiro um score bruto determinístico e explicável usando evidência independente, concordância temporal, diversidade, freshness, plausibilidade, saúde/cobertura, conflitos, anomalias e possível coordenação.

Candidate Confidence só é apresentada como calibrada quando existe amostra suficiente de decisões humanas na mesma faixa. Com menos de 20 decisões resolvidas na faixa, o status é INSUFFICIENT_DATA.

A recomendação CONFIRM_RECOMMENDED exige confiança calibrada, pelo menos duas evidências independentes e ausência de anomalia alta. Nenhuma recomendação executa confirmação automática.

## Reputação
Fonte e reporter usam posterior Beta regularizado e memória por boss. A atualização aplica decay temporal para permitir adaptação. A interface mostra sample size e drift; poucos acertos nunca produzem confiança absoluta.

## Independência, cópia e spam
Cada reporter conta no máximo como uma contribuição independente por candidato. Dependências de fontes já registradas são respeitadas pelos adapters. Relatos idênticos de pessoas diferentes em janela muito sincronizada recebem coordination_score e penalização, sem serem apagados.

## Investigation Mode
Uma investigação nova consulta as fontes imediatamente. Durante os primeiros cinco minutos, casos ativos podem ser reavaliados a cada minuto usando o scheduler já existente. Depois passam a WAITING. Após 30 minutos sem nova evidência, tornam-se EXPIRED sem apagar histórico. Novo candidato próximo do mesmo boss pode ser ligado ao caso expirado como REOPENED.

## Safe failure
Falha de fonte ou do cross-check nunca confirma boss. O caso muda para MANUAL_REVIEW_REQUIRED/REVIEW_RECOMMENDED, preservando CommunityEvidence e CandidateBossEvent.

## Decisão humana
CONFIRMAR ou CORRIGIR E CONFIRMAR gera o fluxo oficial já existente. REJEITAR não cria spawn, mas atualiza reputação e o Investigation Engine. AGUARDAR mantém o candidato pendente.

Valores originais e valores finais validados ficam separados no caso investigativo.

## Métricas
A Central de Investigação expõe: investigações ativas, conflitos, waiting, confirmed/rejected, calibration bins, false positive rate, Investigation Accuracy, Time to Detect, Time to Investigate, Time to Confirm, Source Intelligence, Reporter Intelligence, incidents e missed detections.

Sem histórico operacional suficiente, métricas estatísticas exibem INSUFFICIENT DATA em vez de números inventados.

## Missed/false negative
Eventos confirmados por fontes externas são reconciliados com casos Lunarian. MISSED_DETECTION só é registrado quando há cobertura do collector suficiente no período. Com gap/offline, o caso é classificado COVERAGE_INSUFFICIENT e não conta como falso negativo.

Sugestões de alias reaproveitam o mecanismo existente e continuam exigindo aprovação manual.

## Investigation Model
Champion atual: investigation_rules_v1, determinístico e explicável.
Challenger: empirical_similar_cases_v1 em SHADOW_MODE. Só produz estimativa após amostra suficiente e nunca influencia recomendação de produção nesta fase.

O backtest usa snapshots imutáveis gravados no momento de cada decisão e não recalcula com evidências futuras.

## Limitações
- O estado operacional real não é versionado no GitHub; portanto taxas de confirmação, calibração e latências reais só aparecem após uso em produção.
- CPU/memória reais continuam dependentes do navegador/WhatsApp e exigem profiling real.
- Fonte externa sem API pública/autorizada permanece indisponível; ausência de resposta não é evidência negativa.
- O runtime ainda persiste o estado operacional no armazenamento legado; a migration 006 é preparação relacional, não migração automática.
