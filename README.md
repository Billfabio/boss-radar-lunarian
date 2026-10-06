# Boss Radar · RubinOT

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

A migração do armazenamento legado deve ser feita de forma controlada para preservar todo o histórico existente.

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
