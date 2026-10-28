---
name: agendar-envio
description: Colocar o Em Dia para rodar sozinho todo mês (ou toda semana) - GitHub Actions, Supabase (pg_cron + Edge Function) ou cron de servidor - com segredos, data de execução e proteção contra envio duplicado. Use quando o agente já envia corretamente em teste e precisa virar rotina.
---

# Agendar o Em Dia

Pré-requisito: remetente configurado e testado (skill `configurar-remetente`) e uma rodada em simulação revisada. O `--enviar` recusa rodar enquanto `dados/parametros.json` não tiver `verificado_em`; a opção `--aceitar-parametros-nao-verificados` existe para testes controlados, não para o agendamento.

Códigos de saída: 0 = tudo certo; 1 = a rodada terminou, mas algum envio falhou (veja `saida/envios-AAAA-MM-DD.json`); 2 = nada foi enviado (uso, configuração ou entrada inválida). Configure o alerta do agendador para qualquer código diferente de 0.

## Quando rodar

- **Dia 10 de cada mês:** pega o DAS do mês anterior ainda a tempo (vence dia 20) e as notas do mês fechado.
- **Opcional, dia 17:** segunda rodada só para quem ainda tem DAS em aberto, como lembrete final.
- Em março (DEFIS) e maio (DASN-SIMEI), uma rodada semanal nas últimas semanas do prazo ajuda.

Use sempre `--hoje` explícito em testes; em produção o padrão é a data do dia.

## Opção A: GitHub Actions (mais simples para começar)

1. Copie `exemplos/agendamento-github-actions.yml` para `.github/workflows/em-dia.yml` no repositório do agente.
2. Em **Settings → Secrets and variables → Actions**, cadastre os segredos `ANTHROPIC_API_KEY` e `RESEND_API_KEY`, e as variáveis do remetente (`EM_DIA_REMETENTE_EMAIL`, `EM_DIA_REMETENTE_NOME`, `EM_DIA_RESPONDER_PARA`, `EM_DIA_LINK_DESCADASTRO`, `EM_DIA_ASSINATURA`).
3. Troque o passo "Gerar carteira" pelo comando que exporta a carteira do Wavern (skill `conectar-dados`). Nunca comite a carteira real.
4. Rode uma vez manualmente pelo botão "Run workflow" (o exemplo tem `workflow_dispatch`) com envio desligado.

O cron do GitHub é em UTC: `0 12 10 * *` = dia 10 às 9h de Brasília.

## Opção B: Supabase (mesmo stack do Wavern)

1. Crie uma Edge Function que monta a `Carteira` direto do banco, chama `verificarCarteira`, `redigirComIa`, `montarEmail` e o provedor (importe os módulos de `src/`; o SDK entra como `npm:@anthropic-ai/sdk`).
2. Guarde os segredos com `supabase secrets set ANTHROPIC_API_KEY=... RESEND_API_KEY=...`.
3. Agende com `pg_cron` + `pg_net` chamando a URL da função no dia escolhido.
4. Rode por contador (uma chamada por escritório) para cada execução ficar pequena e respeitar o limite de tempo da função.

## Opção C: cron num servidor

```
0 9 10 * * cd /srv/em-dia && npm run rodar -- /dados/carteira.json --enviar >> /var/log/em-dia.log 2>&1
```

## Não mandar duas vezes

Cada rodada grava `saida/envios-AAAA-MM-DD.json` (enviado, falhou ou em dia, por cnpj) e manda ao Resend uma chave de idempotência por empresa e dia: repetir a rodada no mesmo dia, por exemplo para reenviar as falhas, não duplica quem já recebeu. Entre dias diferentes não há essa proteção. Antes de agendar mais de uma rodada por mês:

- registre em uma tabela (`em_dia_envios`: cnpj, competência, código da pendência, data) o que foi avisado, e
- filtre na exportação da carteira (ou em `verificarCarteira`) o que já foi avisado nos últimos dias.

## Acompanhar

- Guarde a saída (`saida/fila-AAAA-MM-DD.md` e o log) como artefato da execução.
- Métricas de vitrine: empresas avisadas, pendências resolvidas até o vencimento, DAS pagos em dia após o aviso.
