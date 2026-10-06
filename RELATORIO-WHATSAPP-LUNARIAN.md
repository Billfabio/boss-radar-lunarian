# Auditoria e evolução — WhatsApp Web / Lunarian Collector 1.5

## Extensão original
A extensão existente em edge-extension/ já utilizava Manifest V3, content script no WhatsApp Web, service worker, popup, storage local, pairing próprio com o Boss Radar, fila persistente, MutationObserver, dictionary sincronizado, matching exact/alias/fuzzy, heartbeat, gaps/coverage e Central de Confirmações. Ela foi preservada e evoluída; nenhum segundo collector paralelo foi criado.

## Problemas encontrados
- identidade do Lunarian dependia primariamente do nome visual quando o identificador estável não era fixado;
- ausência de cache TTL próprio para impedir reprocessamento local após mutações do DOM/checkpoint degradado;
- retry exponencial sem jitter;
- métrica de capture latency media na prática extensão → backend;
- pergunta/negação isolada podia abrir CandidateBossEvent;
- revogação funcionava pela chave, mas sem histórico técnico explícito;
- documentação e pacote estavam na versão 1.4.0.

## Alterações
- versão 1.5.0;
- identidade estável local do Lunarian quando disponível via @g.us;
- cache de mensagens processadas: TTL 24h, máximo 10.000;
- retry exponencial com jitter criptográfico;
- heartbeat local persistido;
- perguntas/negações só enriquecem candidato existente;
- histórico limitado de collectorId revogados em disconnect/re-pair;
- telemetria separa extensão→backend de mensagem→captura aproximada;
- dashboard e popup atualizados;
- ZIP reconstruído a partir dos fontes atuais;
- novos testes para cache, gating de contexto, revogação e jitter.

## Fluxo Lunarian
WhatsApp Web → WhatsAppDomAdapter → normalização → exact → alias → fuzzy → classificação → fingerprint → fila local → /api/community/evidence → CommunityEvidence → CandidateBossEvent → cross-check → Central de Confirmações → CONFIRMAR/CORRIGIR/REJEITAR.

Nenhuma CommunityEvidence, candidato, pending ou rejected treina a inteligência. Somente confirmação manual cria o registro confirmado que pode seguir para o dataset.

## Performance e privacidade
O processamento permanece local até encontrar boss. O content script usa um único MutationObserver no #main com debounce e watchdog de 1 minuto apenas para recuperação. Não existe polling agressivo por segundos. Cache local e fila são limitados.

Não são enviados telefones ou nomes brutos dos participantes. O autor vira hash local com salt aleatório. Mensagens irrelevantes não são enviadas nem logadas.

## Limitações de medição
CPU e memória reais do WhatsApp Web dependem da versão do navegador/WhatsApp e não podem ser medidos de forma representativa pelo CI Node. A suíte automatizada comprova limites, ausência de polling agressivo, idempotência, deduplicação, matching e fluxo manual; profiling de CPU/memória deve ser feito em sessão real antes de definir metas.

## Segurança
Manifest V3; CSP sem scripts remotos; permissões obrigatórias limitadas a storage, alarms, web.whatsapp.com e localhost; origem HTTPS remota requer permissão opcional explícita; pairing temporário; chave aleatória por collector; backend guarda apenas hash; disconnect/re-pair revoga chave anterior.

## Pendências
- DOM do WhatsApp é externo e pode mudar;
- identificador @g.us não é garantido em toda versão do DOM, portanto existe fallback controlado pelo nome;
- profiling real de CPU/memória ainda precisa ser executado no navegador alvo;
- métricas mensagem→captura são aproximadas porque o timestamp visível pode ter precisão apenas de minuto.
## Benchmark final validado no CI
Commit de implementação validado: 312e617ded9c0a6d4e4bb374faebc7e35e9a9607.

Benchmark sintético: 6.000 mensagens e 333 bosses.

- filtro legado simples: 152,3 ms total; 25,4 µs/mensagem; 372 matches;
- primeira versão fuzzy auditada: 6.652,3 ms total; 1.108,7 µs/mensagem;
- versão 1.5 otimizada final: 336,1 ms total; 56 µs/mensagem; 588 matches;
- redução de aproximadamente 95% no custo por mensagem em relação à primeira versão fuzzy auditada;
- aproximadamente 58% mais matches que o filtro legado no cenário sintético, devido a aliases/fuzzy;
- heap delta sintético da execução atual: 12.656 bytes; este número não substitui profiling real do Chrome/WhatsApp.

O CI agora reprova o matcher se ultrapassar 250 µs/mensagem nesse benchmark ou se perder recall em relação ao filtro legado.

Validação final: 95 arquivos JavaScript/MJS verificados; 160 testes executados; 160 aprovados; 0 falhas. Regression gate, load benchmark, fault injection, benchmark Lunarian, build, smoke e Wrangler dry-run passaram.
