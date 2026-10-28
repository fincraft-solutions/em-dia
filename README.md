# Em Dia

```text
   ___  __________
  |   ||   _____ /   FINCRAFT
  |___||  |____/    OPEN LAB
       |  |
       |__|
```

**Uma fila fiscal precisa ser legível antes de ser automatizada.**


O Em Dia lê uma carteira de demonstração, aplica regras de pendência e prepara uma fila para revisão. Também consegue redigir mensagens, mas **não dispara e-mail na demonstração padrão**: primeiro você enxerga o que aconteceria.

> **Estado:** protótipo. Parâmetros e prazos fiscais dos exemplos não estão homologados para uso operacional.

## Rode sem credenciais, sem envio e sem IA

```bash
# Node.js 22.20+
npm ci
npm run typecheck
npm test
npm run rodar -- exemplos/carteira.json --sem-ia --hoje 2026-10-24
```

O que observar: `saida/fila-2026-10-24.md` (visão para revisão) e `saida/envios-2026-10-24.json` (registro da simulação). Os e-mails gerados localmente ficam em `saida/emails/`. Os arquivos de entrada são **fictícios**.

## Três decisões deliberadas

- **Regras primeiro.** A detecção de pendências é determinística; IA é opcional apenas para a redação.
- **Envio é escolha explícita.** O provedor padrão é `console`; envio real exige configuração, `--enviar`, destinatários autorizados e conferência dos parâmetros.
- **Contador no circuito.** A fila expõe o que está pendente e o que precisa de atenção, em vez de encerrar um processo fiscal automaticamente.

Leia [`src/carteira.ts`](src/carteira.ts), os [dados de parâmetros](dados/parametros.json) e as [skills de configuração](.claude/skills/) para entender as fronteiras.

## Onde não usar ainda

Não confunda a execução de demonstração com controle de obrigações reais. A atualização de calendários, as regras aplicáveis e o consentimento dos destinatários são responsabilidades de implantação. O exemplo de agendamento em [`exemplos/`](exemplos/) é apenas um ponto de partida, não uma automação já ativada.

**Continue por:** [detalhes técnicos](docs/DETALHES-TECNICOS.md) · [limites](STATUS.md) · [como contribuir](CONTRIBUTING.md) · [versões](CHANGELOG.md) · [licença](LICENCIAMENTO.md).

Projeto da [Fincraft](https://github.com/fincraft-solutions). Não use listas reais de clientes em issues ou exemplos públicos.
