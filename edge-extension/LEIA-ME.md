# Boss Radar · Fatal - Bosses Nemesis Collector

Versão atual: **1.5.0**. Esta é a evolução da extensão original do Boss Radar; não existe um segundo collector paralelo.

## O que mudou

A extensão agora funciona como um sensor local e restrito ao grupo **Fatal - Bosses Nemesis**. Ela não confirma bosses e não escreve diretamente no histórico de aprendizado.

Fluxo:

WhatsApp Web → filtro local → boss match → CommunityEvidence → CandidateBossEvent → revisão manual no Boss Radar → evento confirmado → inteligência.

Somente a sua ação **CONFIRMAR** ou **CORRIGIR** na Central de Confirmações cria o registro que pode alimentar a inteligência. **REJEITAR**, PENDING e evidências isoladas nunca representam spawn confirmado.

## Instalação / atualização

1. Abra `edge://extensions` ou `chrome://extensions` e habilite o modo de desenvolvedor.
2. Se já usa a extensão antiga, substitua os arquivos pela versão 1.5.0 e clique **Recarregar**. Não apague o histórico do Boss Radar.
3. Abra o Boss Radar e o WhatsApp Web no mesmo navegador.
4. No painel, gere um código de conexão do Collector.
5. No popup, informe o mundo e o endereço local/HTTPS do seu Boss Radar. O grupo é fixo: **Fatal - Bosses Nemesis**. O mundo selecionado pode continuar sendo **Lunarian**.
6. Cole o código e conecte.
7. Abra o grupo Fatal - Bosses Nemesis. Na primeira leitura é criado um checkpoint das mensagens já visíveis; elas **não** viram candidatos históricos automaticamente.

O pacote `boss-radar-extension.zip` deve corresponder aos arquivos desta pasta.

## Privacidade

A extensão não observa conversas privadas, outros grupos, status ou contatos como fonte do Collector. O content script só processa a conversa principal quando o cabeçalho detectado corresponde a **Fatal - Bosses Nemesis**. Quando o WhatsApp expõe um identificador interno estável @g.us, a extensão o vincula localmente e rejeita outra conversa com o mesmo nome visual; esse identificador bruto não é enviado ao Boss Radar.

A maior parte do descarte ocorre localmente. Mensagens sem boss são filtradas e não entram na fila do backend. Quando uma mensagem relevante é enviada, o backend recebe somente os campos necessários para revisão: texto relacionado ao boss, timestamp, candidatos, classificação contextual, fingerprint e um identificador pseudonimizado do autor.

Telefone/nome bruto do participante não é enviado. O `author_hash` é produzido localmente com salt aleatório persistido no navegador.

Fotos só são reduzidas/enviadas quando a mesma mensagem já foi classificada localmente como relacionada a um boss.

## Matching

O dicionário de bosses vem do Boss Radar, com versão própria. Ele contém:

- `boss_id`;
- nome oficial;
- aliases aprovados.

A extensão mantém cache local para continuar filtrando durante uma indisponibilidade temporária do backend.

Pipeline:

1. normalização;
2. exact match;
3. alias match;
4. fuzzy match com pré-filtro por trigramas;
5. classificação de contexto;
6. fingerprint;
7. fila local.

Contextos:

- `POSSIBLE_REPORT`;
- `CONFIRMATION`;
- `QUESTION`;
- `NEGATION`;
- `SPECULATION`;
- `CORRECTION`;
- `UNKNOWN`.

A detecção é deliberadamente sensível; a confirmação é conservadora e manual.

## Coleta e performance

O polling de 20 segundos da versão antiga foi removido. O content script usa um único `MutationObserver` no `#main` do WhatsApp Web, com debounce. Existe apenas um alarme de 1 minuto no service worker como watchdog/reconexão.

A extensão não depende do service worker permanecer vivo. Configuração, fila, métricas, checkpoint, salt e estado de pausa ficam em `chrome.storage.local`.

Caches e filas possuem limite. A fila de evidências suporta até 5.000 itens e descarta apenas entradas com mais de 48 horas. Mensagens analisadas usam cache local de até 10.000 chaves com TTL de 24 horas para evitar reprocessamento. O retry usa backoff exponencial com jitter criptográfico e batching de até 50 evidências.

## Offline e gaps

Se o Boss Radar ficar offline, mensagens relevantes continuam sendo filtradas e entram na fila local. O envio é retomado quando o backend volta.

O Collector envia heartbeat e o painel diferencia:

- `CONNECTED`;
- `WHATSAPP_NOT_FOUND`;
- `TARGET_GROUP_NOT_FOUND`;
- `LUNARIAN_NOT_FOUND` apenas como compatibilidade com collectors antigos;
- `PAUSED`;
- `BACKEND_OFFLINE`;
- `DEGRADED`;
- `ERROR`;
- `DISCONNECTED`;
- `WHATSAPP_WEB_STRUCTURE_CHANGED`.

Se houver quebra de heartbeat ou um salto no checkpoint visível, o backend registra `COLLECTION_GAP`/gap de DOM. Ausência de relato durante um gap nunca é convertida em evidência negativa.

## Segurança

A extensão usa Manifest V3 e CSP explícita. Permissões obrigatórias continuam restritas a:

- `storage`;
- `alarms`;
- `https://web.whatsapp.com/*`;
- `http://127.0.0.1:4317/*`.

Para um Boss Radar remoto HTTPS, o navegador solicita permissão opcional somente para a origem escolhida pelo usuário.

O código de pairing expira. O Collector recebe uma chave aleatória própria; o backend persiste apenas seu hash. Desconectar pelo painel revoga esse Collector. Reparear também revoga a chave anterior, mantendo apenas histórico técnico limitado dos collectorId revogados.

Nenhuma senha administrativa, secret ou token permanente é incluído na extensão.

## Central de Confirmações

Mensagens do mesmo boss em uma janela próxima são agrupadas em um único candidato. O painel mostra quantidade de mensagens, participantes pseudonimizados, exact/fuzzy match, investigação externa e evidências.

Ações:

- **CONFIRMAR**;
- **CORRIGIR**;
- **REJEITAR**;
- **VER EVIDÊNCIAS**.

Somente CONFIRMAR/CORRIGIR chega ao fluxo de inteligência.

Reporters ganham reputação somente a partir dessas decisões manuais. Grafias fuzzy recorrentes podem virar sugestões de alias; o alias só entra no dicionário depois de aprovação manual e é sincronizado pela versão do dicionário.

## Limitações

A integração continua dependente da estrutura pública do DOM do WhatsApp Web. O `adapter.js` concentra seletores e parsing; se a estrutura mudar, o Collector deve sinalizar `WHATSAPP_WEB_STRUCTURE_CHANGED` em vez de fingir ONLINE.

Os testes automatizados usam snapshots sanitizados. CPU e memória reais do WhatsApp Web dependem do navegador, conta, quantidade de mensagens e versão do próprio WhatsApp; o benchmark do repositório mede o custo do filtro de forma reproduzível, mas não substitui profiling em uma sessão real.
