# Estado de validação — Em Dia

**Em 28/10/2026:** protótipo. A documentação recebida relata testes locais com dependências simuladas, mas os testes TypeScript **não puderam ser reproduzidos neste ambiente** (Node 22.16, abaixo do mínimo usado no CI de 22.20). O workflow do GitHub Actions executará `npm ci`, `npm run typecheck` e `npm test` após a publicação.

Prazos e parâmetros fiscais precisam de verificação; envio de e-mail real é opt-in, com configuração e autorização dos destinatários.

Sem teste externo com chave real, sem verificação operacional/fiscal ponta a ponta. Reavalie os parâmetros e regulamentos por competência antes do uso em produção.

Veja [detalhes técnicos](docs/DETALHES-TECNICOS.md) e [testes do projeto](test/).
