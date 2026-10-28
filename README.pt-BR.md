**Idioma:** [English](README.md) | **Português (Brasil)**

# Em Dia

```text
   ___
  | __|   FINCRAFT / EM-DIA
  | _|
  |_|
```

**O Em Dia transforma uma carteira de empresas em uma fila de obrigações para acompanhamento. Ele confere prazos, prepara lembretes para revisão e pode redigir mensagens. O exemplo permite explorar esse fluxo com dados locais.**

## Primeiros passos

Requer Node.js 22.20 ou superior. Clone o repositório e rode o exemplo:

```bash
npm ci
npm run rodar -- exemplos/carteira.json --sem-ia --hoje 2026-10-24
```

Abra `saida/fila-2026-10-24.md` para conferir a fila e `saida/envios-2026-10-24.json` para examinar o registro da simulação. O exemplo usa empresas fictícias e não envia e-mails.

## O que você encontra

- **Visão de carteira.** Organiza empresas e datas relevantes.
- **Fila por regras.** Identifica demandas a partir de parâmetros locais.
- **Revisão facilitada.** Gera uma fila em Markdown e rascunhos de mensagens.

## Para explorar

[Carteira de exemplo](exemplos/carteira.json) · [Regras](src/regras.ts) · [Exemplo de agendamento](exemplos/agendamento-github-actions.yml) · [Guia técnico](docs/pt-BR/guide.md)

## Integração

Para envio real de mensagens, configure o remetente e habilite explicitamente a etapa de envio. O fluxo padrão foi pensado para revisão local.

## Sobre o projeto

Os parâmetros do exemplo são ilustrativos. Calendários, destinatários e credenciais precisam ser configurados para cada operação.

[Como contribuir](CONTRIBUTING.pt-BR.md) · [Notas de versão](CHANGELOG.pt-BR.md) · [Fincraft](https://github.com/fincraft-solutions)
