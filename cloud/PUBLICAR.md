# Publicação do Boss Radar

Destino preparado: Cloudflare Workers Free com subdomínio workers.dev e armazenamento SQLite em Durable Object. Ainda não publicado: falta criar uma conta Cloudflare e autenticar a publicação. O endereço final será fornecido pela conta, sem compra de domínio.

1. Crie uma conta em https://dash.cloudflare.com/sign-up e verifique o e-mail.
2. Na pasta do projeto, com Node 24 instalado, execute `npm install` e `npx wrangler login`.
3. Execute `npm run cloud:build` e `npm run cloud:check`. Antes de publicar, valide `npx wrangler deploy --dry-run`.
4. Execute `npx wrangler secret put SITE_PASSWORD` e escolha uma senha com pelo menos 12 caracteres. Se o comando solicitar criar o Worker, aceite criá-lo. Não envie a senha no chat nem coloque no código.
5. Execute `npm run cloud:deploy`. Se o Worker precisou ser criado primeiro com deploy, configure a senha logo depois; o site permanece indisponível até existir a senha.
6. Entre no endereço HTTPS mostrado pela Cloudflare. Restaure seu progresso com Exportar/Importar no painel. Checagens, fotos, inscrições push e conexão da extensão não são transferidas por esse backup de progresso: mantenha os arquivos locais e faça a migração completa separadamente antes de desativar o servidor local.
7. Atualize a extensão para 1.2, informe o endereço HTTPS do painel e conecte com um novo código. As fotos carregadas no WhatsApp Web aparecerão na galeria; fotos antigas indisponíveis não podem ser recuperadas automaticamente.

O pacote não inclui estado pessoal, chaves push, senha nem fotos privadas. A versão hospedada protege o painel e as imagens com senha; a extensão usa sua própria conexão autorizada. A leitura continua dependendo do Edge e do WhatsApp Web abertos. A hospedagem monitora lembretes por alarme mesmo quando o painel está fechado.

Verificação realizada: testes de lógica, imagens, autenticação e restauração do servidor em armazenamento simulado. O teste da ferramenta Cloudflare foi bloqueado neste ambiente por EPERM ao iniciar seus processos auxiliares; execução no ambiente Cloudflare e envio push precisam ser validados antes de considerar a hospedagem concluída. Não há domínio online atribuído neste momento.

Limites do plano: https://developers.cloudflare.com/workers/platform/limits/ e https://developers.cloudflare.com/durable-objects/platform/pricing/ . O mapa usa coordenadas disponíveis nas páginas de bosses do TibiaWiki, com fallback do catálogo, e visualização do TibiaMaps. Localizações do Tibia podem diferir no RubinOT.
