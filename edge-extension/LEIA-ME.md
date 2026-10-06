# Boss Radar no Edge

Versão 1.2: adiciona envio das fotos carregadas para a galeria e conexão com hospedagem workers.dev; corrige a seleção de Dados do perfil como conversa, permite informar o nome exato manualmente, mostra status ao vivo e inclui Ler grupo agora. O painel lista todos os bosses reconhecidos, incluindo registros automáticos e relatos pendentes.

Para atualizar uma instalação existente: substitua os arquivos da pasta carregada no Edge por este pacote e clique Recarregar na extensão em edge://extensions. Atualize também a aba do WhatsApp Web para carregar o novo leitor. Se o grupo anterior ficou salvo como Dados do perfil, gere outro código no painel e conecte novamente o nome correto. Não é necessário apagar o histórico do painel.

1. Abra edge://extensions e habilite Modo de desenvolvedor.
2. Escolha Carregar sem compactação e selecione esta pasta, que contém manifest.json.
3. Abra o painel local ou hospedado e o WhatsApp Web no mesmo Edge. No campo Endereço do painel da extensão, informe o endereço local ou HTTPS workers.dev; autorize acesso somente ao seu endereço.
4. Abra o grupo dedicado e, no botão da extensão, escolha Usar grupo aberto. Confira o nome e o mundo. Use um nome exclusivo; conversas com nomes iguais não podem ser distinguidas com segurança por esta versão.
5. Em Checagens e grupo no painel, gere o código de conexão. Cole na extensão e clique Conectar e automatizar.

A primeira leitura começa nas mensagens carregadas naquele momento. A extensão guarda no painel um marcador da última mensagem confirmada. Ao reabrir o WhatsApp Web, tenta abrir o grupo selecionado, carregar o histórico e localizar esse marcador. Mensagens repetidas não duplicam checagens. Sem alcançar o marcador, informa recuperação incompleta e não avança esse ponto; abra o grupo e carregue mensagens mais antigas para tentar novamente.

O Edge, a aba do WhatsApp Web e o servidor local precisam estar abertos durante a leitura. Não há coleta enquanto o WhatsApp Web está fechado. Outras conversas pausam a leitura. A busca automática depende da interface do WhatsApp; se ela não localizar o grupo, abra-o manualmente. A recuperação é limitada por tentativa para não rolar indefinidamente. Mensagens apagadas ou indisponíveis podem impedir a recuperação completa.

Relatos explícitos em Estavam/Não estavam e nomes reconhecidos são importados. Perguntas, planos, relatos de ontem, resultados não claros ou fotos sem nome ficam para revisão no painel. Fotos com legenda podem ser interpretadas pelo texto; esta versão não identifica bosses visualmente. Envia versões reduzidas das fotos carregadas ao seu painel, sem nomes de remetentes e não envia mensagens ao grupo. O texto pertinente é transmitido apenas ao endereço do seu painel para análise, sem armazenamento da mensagem original.

Configure o WhatsApp com dia/mês/ano e horário de Brasília. O horário é o da mensagem, não uma prova do momento do spawn ou da checagem. Corrija relatos atrasados no painel antes de utilizá-los como evidência horária. Os padrões são de encontros durante checagens, não probabilidades calibradas de spawn.

Use Pausar leitura na extensão ou Desconectar extensão no painel. A conexão é restrita ao identificador desta extensão e ao nome do grupo selecionado. Não compartilhe o código; ele vence em dez minutos. Para mudar de grupo, desconecte e conecte novamente.

A integração depende do HTML do WhatsApp Web. Mudanças nele podem exigir atualizar o adaptador. Os testes de interpretação, autorização, duplicatas e recuperação passaram; a leitura de uma conta real ainda depende de validação após a instalação.
