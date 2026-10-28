**Idioma:** [English](../en/guide.md) | **Português (Brasil)**

# Trabalhando com Em Dia

[Voltar para Em Dia](../../README.pt-BR.md)

## Para começar

O Em Dia transforma uma carteira de empresas em uma fila de obrigações para acompanhamento. Ele confere prazos, prepara lembretes para revisão e pode redigir mensagens. O exemplo permite explorar esse fluxo com dados locais.

O exemplo mais simples está no README:

```bash
npm ci
npm run rodar -- exemplos/carteira.json --sem-ia --hoje 2026-10-24
```

## Componentes

- `exemplos/carteira.json`: empresas e obrigações de exemplo.
- `src/carteira.ts` e `src/regras.ts`: normalização das entradas e verificação de prazos.
- `dados/parametros.json`: parâmetros editáveis.
- `src/mensagem.ts`: composição das mensagens, com redação opcional por IA.
- `src/email/`: adaptadores de envio, que exigem configuração explícita.

## Integração

O exemplo usa `--sem-ia` e cria a fila localmente. O envio é uma ação separada, configurada pelo provedor. Revise calendários, autorização dos destinatários e credenciais antes de habilitá-lo.

## Desenvolvimento

```bash
npm ci
npm run typecheck
npm test
```

O projeto utiliza Node.js 22.20 ou superior.
