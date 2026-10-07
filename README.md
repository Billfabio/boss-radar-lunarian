# Boss Radar · RubinOT

> Infraestrutura MLOps, implementação e limites: [RELATORIO-MLOPS.md](RELATORIO-MLOPS.md). A Central de Inteligência possui registro de modelos, datasets reproduzíveis, modelos Shadow e aprendizado controlado. Modelos novos exigem avaliação temporal antes de qualquer promoção.

> Auditoria de confiabilidade atual: [RELATORIO-CONFIABILIDADE-V42.md](RELATORIO-CONFIABILIDADE-V42.md).

> Camada de confiabilidade da IA: consulte [RELATORIO-CONFIABILIDADE-IA.md](RELATORIO-CONFIABILIDADE-IA.md).

> Inteligência Investigativa do Lunarian: [RELATORIO-INVESTIGATION-ENGINE.md](RELATORIO-INVESTIGATION-ENGINE.md).

> Confiabilidade operacional 24x7: [RELATORIO-SYSTEM-RELIABILITY-24X7.md](RELATORIO-SYSTEM-RELIABILITY-24X7.md).

> Experimentação científica de IA: [RELATORIO-AI-LAB.md](RELATORIO-AI-LAB.md).

> Auditoria técnica: consulte [AUDITORIA-TECNICA.md](AUDITORIA-TECNICA.md).\n> Evolução da camada de confiança: consulte [RELATORIO-CONFIABILIDADE-V4.md](RELATORIO-CONFIABILIDADE-V4.md).

Plataforma de monitoramento, histórico e previsão de bosses do RubinOT.

O projeto é desenvolvido com foco em **precisão, automação e independência de hospedagem**. A infraestrutura final pode ser VPS, AWS, Azure, Google Cloud, servidor dedicado, Cloudflare ou outro ambiente compatível com Node.js.

## Motor de inteligência

O Boss Radar mantém um ciclo contínuo:

COLETAR → VALIDAR → NORMALIZAR → DEDUPLICAR → CRUZAR FONTES → CALCULAR CONFIANÇA → ATUALIZAR HISTÓRICO → ANALISAR PADRÕES → PREVER → COMPARAR COM O RESULTADO REAL → APRENDER COM O ERRO → RECALIBRAR.

A inteligência atual inclui:

- histórico por boss e mundo;
- consolidação de múltiplas evidências no mesmo evento;
- pesos dinâmicos por fonte;
- detecção de anomalias;
- intervalo histórico e intervalo recente;
- maior peso para mudanças recentes de comportamento;
- padrões de horário;
- padrões de dia da semana;
- ensemble adaptativo por boss;
- pesos dos métodos aprendidos pelo erro real;
- livro persistente de previsões;
- comparação automática previsão × aparição real;
- erro em minutos;
- acerto da janela;
- métricas em 7, 30 e 90 dias;
- explicabilidade da previsão;
- correções humanas auditadas.

O sistema evita falsa precisão. Um horário específico só é exibido quando existe histórico temporal suficiente; caso contrário, utiliza uma janela e reduz a confiança.

## Fontes atuais

A arquitetura de fontes é modular. Atualmente existem integrações e/ou evidências provenientes de:

- catálogo público do RubinOT;
- estatísticas oficiais disponíveis;
- OT Boss Tracker;
- checagens manuais;
- rodadas do grupo;
- WhatsApp Web por extensão autorizada.

Conectores adicionais ficam desativados até existir endpoint público/autorizado compatível. Dados não são simulados.

## Aprendizado por boss

Cada boss pode aprender pesos diferentes para os métodos:

- intervalo histórico;
- intervalo recente;
- horário do dia;
- dia da semana.

Quando uma nova aparição real é confirmada, a previsão anterior é resolvida e o sistema mede o erro de cada método. Métodos com desempenho melhor ganham influência nas próximas previsões daquele boss.

## Banco de dados

A aplicação atual preserva compatibilidade com o armazenamento existente.

A pasta `database/` contém:

- `schema.sql`: modelo relacional para histórico de grande volume;
- `repository.mjs`: contrato de persistência independente de provedor.

O esquema separa bosses, mundos, fontes, eventos, evidências, previsões, desempenho dos métodos, correções e auditoria. Isso permite migrar posteriormente para PostgreSQL, MySQL ou outra implementação sem alterar o motor de previsão.

A migração do armazenamento legado deve ser feita de forma controlada para preservar todo o histórico existente. **O runtime atual ainda serializa o estado operacional em armazenamento legado; portanto, o esquema relacional está preparado, mas a aplicação ainda não deve ser considerada pronta para milhões de eventos até essa migração ser concluída.**

## Executar localmente

Requer Node.js 24 recomendado.

```bash
pnpm install --frozen-lockfile
pnpm start
```

Abra:

```text
http://127.0.0.1:4317/
```


## Configuração de execução

Por padrão o servidor inicia apenas em `127.0.0.1`, sem exigir login externo.

Variáveis suportadas:

| Variável | Uso |
| --- | --- |
| `PORT` | Porta HTTP. Padrão: `4317`. |
| `HOST` | Interface de rede. Padrão: `127.0.0.1`. Use `0.0.0.0` somente em ambiente controlado. |
| `PUBLIC_ORIGIN` | Origem pública completa, por exemplo `https://radar.exemplo.com`. Obrigatória quando o servidor é exposto fora do localhost. |
| `ALLOWED_HOSTS` | Lista separada por vírgulas de valores válidos do header Host. |
| `REQUIRE_AUTH` | Use `true` para exigir autenticação mesmo em uma origem local/customizada. |
| `SITE_PASSWORD` | Senha do painel público. Obrigatória com pelo menos 12 caracteres quando a autenticação pública estiver ativa. |

Não inclua `SITE_PASSWORD` ou outros secrets no GitHub.

Em uma VPS ou cloud, use HTTPS no proxy/reverse proxy e configure `PUBLIC_ORIGIN` com a origem HTTPS final.

## Testes

```bash
pnpm test
```

O CI também valida instalação, testes, build e compatibilidade do pacote hospedado. A validação de Cloudflare existe apenas como teste de regressão; não define a arquitetura principal do projeto.

## Extensão do WhatsApp

Consulte `edge-extension/LEIA-ME.md`.

Novos registros aceitos pela extensão são enviados imediatamente para o motor de inteligência, sem depender de atualizar o dashboard.

## Segurança

Credenciais, tokens, senhas, chaves e secrets não devem ser incluídos no repositório.

O estado pessoal, imagens, chaves de push e dados privados permanecem fora do código-fonte.

## Princípio do projeto

**Mais dados → mais conhecimento → padrões melhores → previsões melhores → maior precisão.**
# Data Intelligence 4.4

A área Inteligência → DATA INTELLIGENCE contém eventos canônicos versionados, timestamps separados, pesquisa de sinais com walk-forward/holdouts/FDR, ablação de challengers de uma variável, grafos de bosses/fontes, fontes candidatas isoladas em Shadow, skill de previsibilidade, probabilidades experimentais e reprodução histórica sem resultados futuros. Nenhuma descoberta nova entra automaticamente em produção.

Janelas negativas e o dataset probabilístico exigem monitoramento contínuo verificado; checagem isolada ou previsão expirada não comprovam ausência. Horários desconhecidos ficam nulos. Registros apenas de morte não são tratados como spawn preciso. Sem histórico real, cobertura ou calibração, o painel informa insuficiência.

Consulte [RELATORIO-DATA-INTELLIGENCE.md](RELATORIO-DATA-INTELLIGENCE.md) para alcance das doze prioridades, resultados disponíveis, fontes públicas candidatas, APIs, requisitos dos gates, validação e etapas ainda pendentes. A migration PostgreSQL `database/migrations/004_signal_discovery.sql` é aditiva; o runtime permanece no armazenamento legado.
