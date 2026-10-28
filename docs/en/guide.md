**Language:** **English** | [Português (Brasil)](../pt-BR/guide.md)

# Working with Em Dia

[Back to Em Dia](../../README.md)

## Starting point

Em Dia turns a small-business portfolio into a working queue of upcoming obligations. It checks dates, prepares reviewable reminders, and can draft outgoing messages. The sample run gives you the complete flow on local data.

The first example in the README is the easiest route through the project:

```bash
npm ci
npm run rodar -- exemplos/carteira.json --sem-ia --hoje 2026-10-24
```

## Components

- `exemplos/carteira.json`: sample companies and obligations.
- `src/carteira.ts` and `src/regras.ts`: input normalization and due-date checks.
- `dados/parametros.json`: editable parameters.
- `src/mensagem.ts`: message composition, including optional AI copy.
- `src/email/`: delivery adapters, requiring explicit configuration.

## Integration notes

The sample uses `--sem-ia` and generates a local review queue. Sending messages is a separate action configured through a delivery provider. Review calendars, recipient permissions and authentication before enabling delivery.

## Development

```bash
npm ci
npm run typecheck
npm test
```

The repository is built around Node.js 22.20 or newer.
