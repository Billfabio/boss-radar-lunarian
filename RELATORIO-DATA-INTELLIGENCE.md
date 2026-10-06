# Boss Radar — Data Intelligence 4.4

Trabalho restrito à `feature/intelligent-boss-radar`. A base examinada foi a etapa MLOps publicada no commit `77602621667f59eacdf5eb52296a9f0b4789d22b`. O desenvolvimento não altera nem mescla `main`.

## Resultado desta entrega

Foi implementada a primeira infraestrutura executável das doze prioridades. Esta entrega **não conclui todos os cinquenta requisitos** e não afirma ganho de precisão em produção. O checkout contém catálogo, mas não contém `data/state.json`, histórico operacional, cobertura contínua ou snapshots de previsões reais. Nenhum histórico foi criado para preencher esse vazio. Dados de teste permanecem exclusivamente nos testes.

| Prioridade | Implementação e alcance |
|---|---|
| Eventos canônicos | Projeção identificada de forma estável, evidências rastreáveis, incerteza, fontes independentes e versões por disponibilidade. Correção conserva identidade; exclusão gera tombstone. Evidência apenas de morte não fornece horário de spawn. |
| Timestamps | Spawn mínimo/máximo, detecção, publicação, coleta, processamento e confirmação separados. Timestamps desconhecidos ficam nulos; não são preenchidos com o horário do spawn. |
| Signal Discovery | Busca calendário, densidade recente, boss anterior, sequências, janelas após outros bosses, contexto e regime explicitamente registrado. Compara baseline de probabilidade por tempo decorrido com um challenger que acrescenta uma variável. Não altera Champion. |
| Relações entre bosses | Janelas 0–2h, 2–6h, 6–12h e 12–24h, denominadores com cobertura, frequência, IC Wilson, intervalos médio/mediano, suporte e última ocorrência. Relações descritivas não comprovam previsão. |
| Boss Relationship Graph | Nós, arestas e sequências visualizados no painel. Probabilidade descritiva só aparece com ao menos 20 janelas observadas. Experimento associado indica validação retrospectiva, sem habilitar produção. |
| Source Dependency Graph | Comparação de publicação, conteúdo idêntico por hash e atraso, incluindo amostras de fontes em Shadow quando correspondem a eventos independentes. Com 30 pares e 95% de correspondência marca dependência suspeita; não afirma cópia causal nem reduz automaticamente pesos em produção. |
| Feature Ablation | Remove a variável de cada challenger de uma feature e mede a diferença de Brier no mesmo holdout. Não é ainda ablação de um modelo multivariado global completo. |
| Walk-forward | Treino expansivo usando somente rótulos conhecidos antes de cada previsão. Descoberta/validação/teste cronológicos 60/20/20; vocabulário selecionado na descoberta; receita e shrinkage fixos. |
| Simulador histórico | Até 24h, versões de eventos/contexto disponíveis a cada passo, probabilidades e snapshots íntegros de previsões já emitidas. Oculta resultados adicionados depois. Não envia alertas. Configurações e alertas históricos ainda precisam ser versionados para reproduzir esse comportamento. |
| Predictability Score | Skill relativo de Brier penalizado por ECE no holdout. Só aparece após ganho validado; não é uma porcentagem de acerto. Horizonte útil atualmente limitado ao teste de 6h. |
| Live Probability | Probabilidade experimental para 6h, reestimada conforme tempo e evidências disponíveis. Calibrador com treino/holdout separados e gates de Brier/log loss/ECE. Ranking exclui probabilidades não calibradas. Não envia alertas nem modifica previsão estável. |
| Dashboard | Sinais aprovados/rejeitados/insuficientes, ablação, grafos, sequências, fontes candidatas, latência, ranking, skill, timestamps, cobertura, simulador e curva empírica com limites de censura. |

## Proteções contra aprendizado incorreto

- Janelas negativas exigem cobertura contínua verificada e independente. Uma previsão expirada, uma checagem vazia isolada ou monitoramento de uma fonte em Shadow não produz ground truth negativo.
- Janelas positivas também exigem cobertura para compor o dataset probabilístico: selecionar somente sucessos conhecidos distorceria a taxa-base.
- Um spawn censurado atravessando o limite da janela recebe resultado desconhecido.
- A disponibilidade de um rótulo considera correções e remoções posteriores. Uma remoção futura não transforma retroativamente um sucesso em negativo conhecido no passado.
- Não se retrodata a disponibilidade de registros antigos. Sua primeira versão canônica é conhecida na captura/migração atual, salvo quando já há versões contemporâneas preservadas.
- Evidências repetidas da mesma fonte têm contribuição limitada na fusão e na reputação. Grupos de dependência previamente configurados contam uma vez. A suspeita descoberta no grafo não configura esses grupos automaticamente.
- Publicação/coleta/detecção não são confundidas ao estimar latência. Latência de spawn exige referência com horário preciso; caso contrário permanece desconhecida.
- O teste pareado usa diferenças de Brier agregadas por dia, teste exato de sinais unilateral e Benjamini–Hochberg em todas as hipóteses tentadas na execução, em validação e teste. Agregação diária reduz pseudorreplicação, mas não prova independência temporal. Antes de produção são necessárias validação prospectiva e auditoria da dependência entre blocos.
- Receita fixa exige pelo menos 30 janelas de descoberta, 20 em cada holdout e dez blocos diários por holdout; ganho de Brier ≥5%, log loss e ECE sem regressão, q ≤0,05 nos dois holdouts.
- Passar esses gates resulta em `SHADOW_MODE`, sempre com `productionEligible=false`. Ainda não existe promoção automática de sinal para produção. Um teste retrospectivo favorável não substitui comparação prospectiva, Challenger e gate operacional.
- Experimentos negativos são persistidos por versão e hash do dataset. A mesma base fechada não cria um experimento novo a cada clique. Novos dados justificam reavaliação; o controle FDR atual é por execução, não uma garantia de controle sequencial vitalício.

## Fontes candidatas realmente encontradas

URLs inspecionadas em 06/10/2026 e registradas como metadados de descoberta, sem dados de spawn importados:

1. [Notícias oficiais RubinOT](https://rubinot.com.br/news): publicações de atualizações, eventos e manutenção, potencialmente úteis como contexto. Anúncio de manutenção não comprova execução nem horário real do reinício.
2. [RubinOT Hub](https://rubinot.app/): diretório público com ferramentas de estatísticas, hunts e bosses; não fornece por si só ground truth de spawn.
3. [Rubinot Tools](https://www.rubinottools.com/): ferramenta comunitária candidata; a página requer inspeção adicional do acesso e dos endpoints públicos.

**Fontes validadas nesta entrega: 0. Fontes novas ativas: 0.** Não há novo crawler genérico: o sistema não busca URLs arbitrárias, não contorna autenticação/proteções e não interpreta páginas sem parser auditado. Coletadores públicos e integrações autorizadas já existentes foram preservados.

Fontes novas podem ser cadastradas, revisadas e receber amostras em armazenamento isolado. Estados: DESCOBERTA, EM_ANALISE, TESTE, VALIDADA, ATIVA, BAIXA_QUALIDADE, BLOQUEADA, DESCARTADA. A ativação está bloqueada nesta fase. A validação exige ao menos 50 correspondências independentes, 50 eventos esperados em período de observação da candidata, 20 dias, precisão ≥95%, recall ≥80% e p95 de detecção ≤15min com 30 horários precisos. Sem cobertura, relatos não correspondidos permanecem pendentes; não viram automaticamente falsos positivos. Monitoramento da candidata e ground truth independente são registrados separadamente.

## Resultados disponíveis

| Resultado solicitado | Resultado operacional verificável nesta entrega |
|---|---|
| Eventos reais elegíveis disponíveis no checkout | 0; isso não afirma que a instalação em produção tenha zero eventos |
| Sinais novos comprovados | Nenhum: amostra indisponível |
| Sinais reais rejeitados | Nenhum experimento operacional executável sem histórico/cobertura; resultados negativos futuros serão preservados |
| Relações reais entre bosses | Não determináveis com o checkout disponível |
| Relações reais entre fontes | Não determináveis sem publicações/detecções observadas |
| Melhoria nas previsões de produção | Não mensurável; nenhum ganho alegado |
| Bosses mais/menos previsíveis | Ranking indisponível até validação suficiente |
| Próximos experimentos | Tempo desde outro boss, densidade de spawns nas últimas 24h, contexto após server save explicitamente registrado, update/regime, sequência anterior e latência/independência de fonte |

No regression gate controlado já existente, antes e depois desta fase: ensemble MAE **116,9 min**, melhor baseline **116,9 min**, 33 previsões de teste e acerto de janela **90,9%**. Trata-se de cenário de teste, não resultado operacional. ECE calibrado **22,2 p.p.** contra ECE bruto **2,5 p.p.**: permanece uma limitação real da calibração legada nesse cenário. O novo ranking usa gate próprio e não transforma esse resultado em probabilidade calibrada.

## Validação

- **114 testes aprovados, zero falhas**, incluindo 27 testes da nova fase.
- Integridade do núcleo aprovada: sem aleatoriedade nem dados de demonstração no runtime.
- Regressão temporal e fault injection aprovados localmente.
- Build e smoke Cloudflare aprovados, incluindo assets, persistência e novas APIs do painel.
- O benchmark local no Windows apresentou 36 conexões recusadas em cada cenário de 1.000/10.000 consumidores, problema também reproduzido na base anterior. Não houve redução dos limites de aprovação. A pipeline Linux deve confirmar o resultado de carga da nova branch.
- CI ampliada com PostgreSQL 16: aplicação do schema e das migrations duas vezes, com interrupção em qualquer erro. Validação SQL local não foi alegada: o runtime/banco local não está ativo.

## Operação e persistência

Abra a área Inteligência → DATA INTELLIGENCE. Use Atualizar painel, Pesquisar sinais, registrar fonte candidata, revisar estados, informar contexto/cobertura/amostras e reproduzir um dia histórico. Campos temporais do painel usam Brasília.

Rotas GET: `/api/intelligence/discovery`. Rotas POST sob `/api/intelligence/discovery/`: `run`, `historical`, `candidate`, `review`, `sample`, `context`, `coverage`. Preservam sessão, origem, token e limite de requisições do painel. Trabalhos pesados usam a fila existente.

A pesquisa automática é disparada pelo polling no máximo diariamente quando houver ao menos dez spawns canônicos elegíveis e cobertura independente registrada. A busca não depende de envio de alertas e não aciona alertas novos. Coleta em Shadow é uma API de ingestão isolada; conectar parsers/coletores de cada fonte pública ainda é trabalho adicional.

A migration `004_signal_discovery.sql` é aditiva e PostgreSQL. O runtime continua no armazenamento legado em arquivo; **não foi migrado para banco relacional**. Versões e experimentos preservados aumentam esse arquivo: retenção, compactação/arquivamento e processamento distribuído precisam ser implementados antes de grande escala. A análise limita bosses/janelas por execução e ainda percorre histórico em memória; não foi certificada para milhões de eventos.

Engine: **4.4.0**, família **adaptive-ensemble-v4.4**, separando métricas após a proteção da fusão/reputação contra repetição. O algoritmo estável de previsão temporal permanece. Histórico MLOps, replay, qualidade, drift, circuit breaker, Champion/Challenger, propostas controladas e canary existentes foram preservados.

## Trabalho ainda necessário

Não estão concluídos nesta entrega: crawler automático para encontrar fontes, parsers públicos de notícias/status e regras de acesso auditadas, treinamento prospectivo das features em Shadow, integração de sinais aprovados ao Challenger/Champion, aplicação automática validada de dependência entre fontes, modelo global/hierárquico, clusterização, detecção estatística e segmentação automática de breakpoints, Knowledge Graph completo, inferência Bayesiana de detecção calibrada, Survival Analysis ajustada por Turnbull/Cox, distribuição normalizada calibrada em múltiplos horizontes e replay fiel dos alertas/configurações históricas.

Server save, restart e manutenção são contextos explicitamente registrados e candidatos em teste, não influências assumidas. A curva com intervalos censurados fornece **limites empíricos não calibrados**, não substitui um estimador completo de sobrevivência. A arquitetura inicial permite evoluir essas etapas mantendo o veto a descobertas entrando diretamente em produção.

O próximo passo com maior valor é alimentar versões contemporâneas de spawns realmente observados, timestamps explícitos e períodos verificáveis de observação contínua. Isso permite testar as hipóteses implementadas sem inventar horários, negativos ou ganhos.
