# Boss Radar · RubinOT

Painel pessoal para acompanhar bosses em Lunarian, registrar Bosstiary, checagens do grupo e lembretes no navegador. Inclui personagens públicos, mapas e integração com WhatsApp Web por extensão.

## Executar localmente

Com Node.js 24, execute `node server.mjs` e abra http://127.0.0.1:4317/.

## Publicar na Cloudflare pelo GitHub

Conecte este repositório em Workers & Pages. Use a raiz do repositório, comando de compilação `npm run cloud:build` e comando de implantação `npx wrangler deploy`. Configure `SITE_PASSWORD` como segredo com pelo menos 12 caracteres. O painel ficará indisponível enquanto a senha não existir. Consulte [os detalhes de publicação](cloud/PUBLICAR.md).

A primeira publicação precisa ser validada na Cloudflare; não foi possível executar a ferramenta de implantação neste ambiente. Os testes de lógica e de restauração com armazenamento simulado passaram.

## Extensão

Consulte [as instruções da extensão](edge-extension/LEIA-ME.md). A leitura é restrita ao grupo conectado e depende do WhatsApp Web aberto. Fotos carregadas aparecem na galeria, mas não há reconhecimento visual automático de bosses.

## Dados pessoais

Este repositório contém somente código e catálogo público. Estado pessoal, senha, fotos e chaves push ficam fora do repositório. O histórico do mundo não representa suas kills; as previsões não determinam o horário de spawn. Mapas do Tibia podem diferir no RubinOT.

## Verificar

Execute `npm test`. Para verificar a adaptação hospedada, execute `npm run cloud:build` e `npm run cloud:check`.
