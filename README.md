**Language:** **English** | [Português (Brasil)](README.pt-BR.md)

# Em Dia

```text
   ___
  | __|   FINCRAFT / EM-DIA
  | _|
  |_|
```

**Keep every obligation on the radar.**

Em Dia turns a small-business portfolio into a working queue of upcoming obligations. It checks dates, prepares reviewable reminders, and can draft outgoing messages. The sample run gives you the complete flow on local data.

## Try it

Requires Node.js 22.20 or newer. Clone the repository and run:

```bash
npm ci
npm run rodar -- exemplos/carteira.json --sem-ia --hoje 2026-10-24
```

Open `saida/fila-2026-10-24.md` for the review queue and `saida/envios-2026-10-24.json` for the dry-run log. The sample uses fictional companies and does not send email.

## What's inside

- **Portfolio view.** Loads a list of companies and relevant dates.
- **Rule-based queue.** Flags upcoming work using locally configured parameters.
- **Ready for review.** Produces a Markdown queue and message drafts.

## Explore the code

[Example portfolio](exemplos/carteira.json) · [Rules](src/regras.ts) · [Scheduling example](exemplos/agendamento-github-actions.yml) · [Technical guide](docs/en/guide.md)

## Extend it

For real email delivery, configure a sender and explicitly enable the sending path. The default workflow is designed for local review.

## Project notes

The sample parameters are illustrative. Production calendars, recipients and credentials require configuration for the business using the tool.

[Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [Fincraft](https://github.com/fincraft-solutions)
