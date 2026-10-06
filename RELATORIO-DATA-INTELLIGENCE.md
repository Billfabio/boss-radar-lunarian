# Boss Radar — conclusão da infraestrutura Data Intelligence 4.5

Branch exclusiva: `feature/intelligent-boss-radar`. Base remota auditada: `3d4d3f261fb782af53dc11e0922796fae7d99602`. `main` permanece em `8195919d6478f6b7d255dd6d1715fdab469e42aa`; não houve merge nem deploy.

Esta fase implementa a infraestrutura dos cinquenta requisitos, incluindo as partes que faltavam na entrega 4.4. **Conclusão de implementação não equivale a descoberta estatística aprovada.** O checkout não contém o histórico operacional `data/state.json`, cobertura contínua real nem resultados prospectivos de produção. Não foram inventados spawns, rótulos negativos, relações, scores ou ganhos. Os dados controlados dos testes não são importados para o produto.

## Resultados verificáveis

| Medida | Resultado |
|---|---|
| Testes funcionais e de regressão | 143 executados; 143 aprovados |
| Sintaxe e auditoria anti-IA-de-fachada | Aprovadas |
| Regression gate temporal | Ensemble 116,9 min de MAE; melhor baseline 116,9 min; 33 casos precisos de teste |
| Antes / depois no mesmo cenário de referência | 116,9 / 116,9 min; ganho de MAE 0% |
| Build, smoke e pacote Cloudflare | Aprovados; Wrangler dry-run concluído, sem publicação |
| Fault injection | Aprovada no runtime ativo |
| Carga Windows local | Falhou: 36 ECONNREFUSED em 1.000 e 36 em 10.000 requisições; limiares preservados. Mesmo tipo/quantidade observado na base anterior |
| CI Linux e migrations PostgreSQL | Pipeline anterior c98fde3 aprovada em todos os checks, incluindo carga Linux e aplicação dupla das migrations; verificar commit final no PR |
| Eventos reais de spawn utilizados nesta análise operacional | 0; histórico do serviço não disponível no checkout |
| Pesquisa pública real | 12 URLs candidatas, incluindo 3 raízes iniciais e 9 links encontrados; 5 notícias oficiais coletadas; 0 spawns coletados |
| Novos sinais aprovados / rejeitados em dados operacionais | 0 / 0; sem dataset elegível. Estados e experimentos negativos são persistidos quando houver execução real |
| Fontes validadas para previsão | 0; acesso público não comprova precisão de detecção |
| Relações comprovadas entre bosses / fontes | Nenhuma mensurada em histórico operacional |
| Bosses mais / menos previsíveis | Não mensurados; score permanece indisponível sem evidência suficiente |

A inspeção real foi executada com o mesmo coletor público entregue no produto. O arquivo `docs/public-discovery-2026-10-06.json` conserva URLs, resultados, textos públicos e horários reais da coleta; é evidência de pesquisa, **não é estado operacional pré-carregado**. Uma das URLs encontradas é um endpoint de imagem, ainda candidato sem valor preditivo comprovado.

## Rastreabilidade dos cinquenta requisitos

| Nº | Implementação |
|---|---|
| 1 | `signals.mjs`: calendário, tempo decorrido, ordem/sequência, densidade, confirmações, fontes independentes, incerteza, acontecimentos, ciclos conhecidos e publicações externas; pesquisa diária no polling quando existir cobertura e histórico |
| 2 | Comparação baseline versus sinal em validação e teste cronológicos; não promove frequência descritiva |
| 3 | `graphs.mjs`: dependências entre pares por janelas; cada relação remete ao experimento da feature `after:boss` |
| 4 | Boss Relationship Graph no painel: ocorrência, amostra, probabilidade, IC, médias/medianas, última ocorrência e valor preditivo |
| 5 | Sequências consecutivas e feature dos últimos dois bosses; qualquer ganho exige holdout e etapas prospectivas |
| 6 | Janelas 0–2, 2–6, 6–12 e 12–24h, com denominadores realmente observados |
| 7 | Configuração de server save com origem, validade e disponibilidade; fase, tempo até próximo ciclo e número de saves; acontecimentos efetivamente observados separados |
| 8 | Contextos restart, maintenance, update, hotfix, special_event e reset com proveniência; notícia de manutenção permanece anúncio |
| 9 | Regimes explícitos de update/reset e regimes detectados com `detectedAt`; features não antecipam a detecção |
| 10 | `regimes.mjs`: breakpoints com 20 intervalos observados antes e depois, mudança de mediana ≥20%, teste por ranks e BY; segmentos candidatos com relação a notícias/contextos, sem causalidade presumida |
| 11 | `collectors.mjs`: pesquisa em links públicos, HTML/RSS/Atom, feed JSON explícito e Discord autorizado; sem executar scripts ou contornar proteção |
| 12 | Cadastro, estados, revisão, amostras e configuração de coletor na área administrativa |
| 13 | Amostras de fonte em armazenamento isolado; Shadow prospectivo, comparação, quality gate, Challenger e canários 5/20/50/100 antes de ativação |
| 14 | Latência de detecção versus spawn preciso; média, mediana, p95 de qualidade e exigência de histórico independente |
| 15 | Ordem de publicação, hashes de conteúdo idêntico e atraso recorrente; classificações indicam suspeita, não prova causal de cópia |
| 16 | Source Dependency Graph; redução conjunta conservadora exige confirmação prospectiva e validação administrativa; união transitiva dos grupos |
| 17 | Fusão ponderada do motor existente com contribuição máxima por fonte, grupo dependente e ator; atualização Bayesiana apenas com taxas estimadas em controles independentes |
| 18 | Eventos canônicos estáveis e versionados, provenientes de spawns confirmados com origem rastreável |
| 19 | Deduplicação de evidência/evento e enriquecimento do spawn existente; repetições não viram independência |
| 20 | Spawn, detecção, publicação, coleta, processamento e confirmação separados; desconhecidos nulos |
| 21 | Limites mínimo/máximo, estimativa e incerteza; censura atravessando limite da janela gera resultado desconhecido |
| 22 | Resultados negativos apenas com observação contínua independente; janelas prospectivas abertas/resolvidas/sem cobertura persistidas |
| 23 | `survival.mjs`: ajuste discreto por auto-consistência de Turnbull para observações exatas, censuradas por intervalo e à direita; sem preenchimento fictício de horário |
| 24 | `fusion.mjs` e operação `evidence`: atualização limitada por independência, sensibilidade e FPR; FPR exige controles negativos, não é 1−precisão |
| 25 | Live Probability por prefixo disponível, cobertura recente e continuidade desde último spawn; previsões prospectivas emitidas possuem dataset imutável e janela explícita |
| 26 | Ranking utiliza somente horizonte de 6h calibrado e cobertura atual; probabilidades ausentes não entram |
| 27 | `experiments.mjs`: experimento global agrupado por servidor com contexto, bosses recentes, densidade e regime; treino contém só rótulos já conhecidos |
| 28 | Modelo hierárquico experimental com prior do servidor/grupo, shrinkage e informação de suporte/confiança reduzida |
| 29 | K-medoids determinístico sobre mediana de intervalo, variabilidade e concentração horária; intervalos exigem cobertura; clusters continuam descritivos até validação |
| 30 | Skill relativo de Brier penalizado por ECE no holdout; não é “porcentagem de acerto” |
| 31 | Pesquisa nos horizontes 2/6/12/24h; horizonte útil é o maior com ganho validado; não extrapola além dos horizontes avaliados |
| 32 | CDF condicional e bins normalizados, com massa residual após 72h; calibrador próprio por horizonte 2/6/12/24/48/72; rejeita inconsistência de monotonicidade e mostra curva somente quando elegível |
| 33 | Brier, log loss, ECE, recall, suporte e comparação sem/com feature; MAE adicional condicional a spawn preciso dentro da janela, explicitamente rotulado |
| 34 | Ablação de uma feature e de receitas multivariadas completas no holdout; mede Brier com/sem cada feature |
| 35 | Features sem ganho não são promovidas; o baseline e a receita mais simples seguem disponíveis; qualquer receita reduzida é novo challenger |
| 36 | Registro de hipótese, dataset, receita, splits, métricas, ablação, decisão e política vinculada |
| 37 | BY para hipóteses dependentes em uma família conjunta; orçamento somável de buscas repetidas; exigências mínimas e blocos diários |
| 38 | Descoberta/validação/teste cronológicos 60/20/20; receita definida antes dos holdouts; posterior validação prospectiva |
| 39 | Walk-forward com treino expansivo e rótulos conhecidos antes de cada landmark |
| 40 | Replay de até 24h: versões, contextos, publicações, Champion/Shadow/Challenger emitidos, probabilidades, configurações e alertas históricos; entregas virtuais, sem envio |
| 41 | `red-team.mjs`: ataques executados em cópias de registros reais disponíveis; repetições, atores em vários canais, cópias, futuro, intervalos impossíveis, timestamps alterados e padrões de fontes não validadas |
| 42 | Testes de aumento adversarial de confiança; Bayes limita razão por grupo e total, não confirma com evidência não validada |
| 43 | Contribuição por ator/fonte/grupo, limites de amostras e API existentes; fonte desconhecida/inativa fica em quarentena; rollback retira sua contribuição |
| 44 | Freshness canônica e componente de qualidade/atraso existentes; cobertura atual obrigatória para ranking de sobrevivência |
| 45 | Knowledge Graph tipado: servidor, boss, spawn, fonte, confirmação, contexto, publicação, previsão, modelo e dataset; API paginada, somente proveniência |
| 46 | Dashboard com coleta, políticas, resultados, grafos, ablação, regimes, clusters, curvas, fontes, latência, quality gates, pesquisa pública e Red Team |
| 47 | Top descobertas calculado dos experimentos; notícias/latências/relacionamentos vêm de dados; não há texto com números fabricados |
| 48 | Resultados REJEITADO e AMOSTRA_INSUFICIENTE guardados por dataset/receita; execução idêntica reaproveita resultados |
| 49 | Orquestração de pesquisa, comparação, falsificação, monitoramento e revisão; conclusões permanecem desconhecidas sem dados elegíveis |
| 50 | Descoberta → backtest → holdouts → Shadow prospectivo → comparação → quality gate → Challenger → canário → produção; rollback por regressão/correção; fontes obedecem gates próprios |

## Operação

Abrir **DATA INTELLIGENCE**. “Pesquisar fontes públicas” executa uma coleta limitada; a coleta automática pode ser ativada ou pausada no painel, com frequência horária. Hosts novos exigem revisão pública explícita. DNS é resolvido e fixado a endereço público; acesso privado, credenciais na URL, redirects, captcha e proibição de robots são recusados. Crawl-delay e intervalo mínimo são respeitados; páginas possuem limite de tamanho e tempo.

Notícias HTML/RSS/Atom não são spawns. Feeds de boss precisam fornecer explicitamente `eventType: appearance`, boss, servidor, limites de spawn e detecção. Discord exige autorização de canal e token `BOSS_RADAR_DISCORD_TOKEN` no ambiente; o token não é salvo em estado nem retornado ao painel. O leitor aceita mensagens com o contrato JSON explícito, sem adivinhar horário em texto livre.

Cadastrar cobertura independente para verdade de referência e cobertura da própria fonte para medir recall/FPR. Cada amostra nova permanece em Shadow. A validação inicial exige 50 correspondências independentes, 50 eventos esperados, 20 dias, precisão ≥95%, recall ≥80% e p95 de atraso ≤15min em ao menos 30 horários precisos. A fonte validada entra em um novo período prospectivo; “Avaliar próxima etapa” verifica evidência adicional. Cada aumento do canário exige dados novos. Bloqueio/revisão negativa revoga elegibilidade.

Sinais precisam de 30 casos de descoberta, 20 por holdout e suporte temporal independente. A comparação prospectiva exige 50 janelas em 20 dias, ≥5% de ganho de Brier, teste pareado, controle conjunto e ausência de regressão em log loss/ECE. Os datasets e as previsões emitidas são imutáveis; correção do ground truth invalida o resultado e pode reverter um rollout.

Os sinais promovidos são expostos como probabilidades para uma **janela explícita**, associada à política. Não trocam silenciosamente o significado da probabilidade ou o horário do motor legado. Experimentos de outros horizontes não são automaticamente usados na política operacional de 6h.

Rotas POST em `/api/intelligence/discovery/`: run, historical, candidate, review, sample, context, coverage, collector, collect, automatic, schedule, discord, discord-collect, advance, dependency, knowledge, evidence e red-team. Mantêm autenticação/sessão, origem e limites existentes; operações pesadas usam a fila.

## Persistência e limites

Migration `005-discovery-governance.sql` adiciona políticas, datasets prospectivos, previsões/resultados, histórico de gates, versões de configuração, alertas, publicações, snapshots de análise e configurações públicas de coletores. A CI aplica todas as migrations duas vezes no PostgreSQL 16.

O runtime do projeto continua em arquivo legado. As migrations não significam que o runtime foi migrado para PostgreSQL. Há limites explícitos de candidatos, amostras, páginas, nós, bosses e janelas; análise histórica em memória e datasets preservados precisam de banco, retenção/arquivamento e processamento distribuído antes de milhões de eventos. O benchmark de entrega de snapshots não certifica o desempenho de toda a pesquisa nem de Internet ou banco externo.

Survival usa suporte discreto nos limites observados e cauda explícita; não identifica segundos dentro de censura larga. Sem convergência, cobertura ou calibração, recusa probabilidade. A distribuição só é exibida como calibrada com seis horizontes validados e CDF monotônica. O grafo de fontes encontra suspeitas de réplica por conteúdo idêntico, sem inferir causalidade de cópia. Dados anteriores à captura não ganham disponibilidade histórica retroativa.

Os arquivos /mnt/data mencionados no início não estão anexados neste ambiente Windows. A auditoria anterior foi feita sobre código e resumo recuperado; não se afirma comparação literal com um arquivo ausente. A solicitação completa dos cinquenta requisitos enviada neste chat é a especificação desta fase.

## Próximos experimentos com dados reais

1. Tempo desde Boss A versus baseline de Boss B nos quatro horizontes e nas janelas de influência.
2. Fase do server save conhecido versus calendário/tempo decorrido.
3. Sequência dos últimos bosses e estado global do servidor.
4. Anúncios públicos, somente a partir da disponibilidade real ao coletor.
5. Regimes antes/depois de updates confirmados, com breakpoints tratados como hipóteses.
6. Hierarquia por servidor/cluster para bosses raros, mantendo suporte/confiança explícitos.
7. Remover features que não reduzam erro; registrar rejeições e evitar promover ruído.

Referência matemática: [Turnbull, 1976 — nonparametric estimation with censored data](https://rss.onlinelibrary.wiley.com/doi/10.1111/j.2517-6161.1976.tb01597.x). Integração de mensagens: [documentação oficial Discord](https://github.com/discord/discord-api-docs/blob/main/developers/resources/message.mdx).
