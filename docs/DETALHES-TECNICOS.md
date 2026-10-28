# Em Dia

Checagem mensal de pendências fiscais de MEI e Simples Nacional. Para cada empresa, avisa por e-mail o que vence e o que está faltando. Para o contador, monta uma fila única da carteira, da pendência mais urgente para a menos urgente.


## O que ele verifica

| Pendência | MEI | Simples | Prioridade |
|---|---|---|---|
| DAS em atraso / vencendo nos próximos dias | ✓ | ✓ | alta / média |
| DASN-SIMEI ou DEFIS pendente ou atrasada | ✓ | ✓ | conforme o prazo |
| Perto ou acima do limite do MEI (com proporcional no ano de abertura) | ✓ | | média / alta |
| Perto ou acima do sublimite de R$ 3,6 mi e do limite do Simples | | ✓ | média / alta |
| Fator R na zona de virada (25% a 31%), com quanto falta de folha | | ✓ | média / baixa |
| Meses com faturamento e nenhuma nota registrada | ✓ | ✓ | baixa / média |

As pendências são calculadas por regras (`src/regras.ts`). A IA só **redige** o e-mail a partir delas, em formato estruturado. Se a IA falhar ou não houver chave, entra um texto padrão.

## Começar

```bash
npm install
npm test
npm run rodar -- exemplos/carteira.json --sem-ia --hoje 2026-10-24   # simulação
```

Sem `--enviar`, **nada é enviado**: os e-mails vão para `saida/emails/`, a fila do contador para `saida/fila-AAAA-MM-DD.md` e o registro de quem recebeu para `saida/envios-AAAA-MM-DD.json`. Sem `--hoje`, vale a data de hoje no fuso de Brasília.

Para envio real:

```bash
cp .env.example .env              # preencha o remetente e as chaves
npm run testar-remetente -- voce@seudominio.com.br
npm run rodar -- caminho/da/carteira.json --enviar
```

O envio real se recusa a começar (código 2, nada enviado) quando:
- o provedor é `console` (o `--enviar` não finge que enviou);
- o remetente está incompleto ou inválido;
- `dados/parametros.json` ainda não foi verificado, a menos que você passe `--aceitar-parametros-nao-verificados` de propósito.

Durante a rodada, um erro de envio numa empresa não interrompe as outras: ele fica registrado em `saida/envios-AAAA-MM-DD.json`, a fila é gravada do mesmo jeito e o comando termina com código 1. O Resend é chamado com timeout, repete em 429/5xx (até 3 tentativas) e recebe uma chave de idempotência por empresa e dia, então repetir a rodada no mesmo dia não duplica e-mails.

### Entrada inválida

A carteira é validada antes de qualquer regra (`src/validacao.ts`). Empresa com competência fora de `AAAA-MM`, data inválida, valor que não é número ≥ 0, regime desconhecido ou contato sem e-mail válido é **descartada com aviso** (cnpj e campo), sem derrubar as demais. `regime` aceita minúsculas. Data, arquivo ou JSON inválidos encerram com mensagem clara e código 2.

## Parametrização

| O quê | Onde | Skill |
|---|---|---|
| **Remetente do e-mail** (domínio, SPF/DKIM/DMARC, Resend, descadastro, teste) | `.env`, `src/email/` | `configurar-remetente` |
| Agendamento mensal (GitHub Actions, Supabase, cron) | `exemplos/agendamento-github-actions.yml` | `agendar-envio` |
| Formato da carteira e integração com o Wavern | `src/tipos.ts` (`Carteira`) | `conectar-dados` |
| Prazos, limites e faixas de alerta | `dados/parametros.json` | — |
| Tom do e-mail | `prompts/mensagem.md`; modelo em `EM_DIA_MODELO` | — |

### Variáveis do remetente

| Variável | Para quê |
|---|---|
| `EM_DIA_EMAIL_PROVEDOR` | `console` (simulação, padrão) ou `resend` |
| `EM_DIA_REMETENTE_EMAIL` | Endereço "De:", de domínio próprio verificado |
| `EM_DIA_REMETENTE_NOME` | Nome que aparece no "De:" |
| `EM_DIA_RESPONDER_PARA` | Para onde vão as respostas do cliente |
| `EM_DIA_LINK_DESCADASTRO` | Página para parar de receber (obrigatória no envio real) |
| `EM_DIA_ASSINATURA` | Fecho de todo e-mail |
| `RESEND_API_KEY` | Chave de envio do Resend |

O envio real se recusa a começar com remetente incompleto ou de e-mail gratuito (gmail, hotmail etc.) e lista o que falta.

## Estrutura

```
src/
  regras.ts             pendências de uma empresa
  carteira.ts           roda a carteira e monta a fila do contador
  mensagem.ts           rascunho com IA (JSON estruturado) ou texto padrão; e-mail final com assinatura e descadastro
  email/remetente.ts    configuração e validação do remetente
  email/provedores.ts   provedores console e Resend (interface para outros)
  datas.ts              datas, vencimentos e formatação
  cli.ts                npm run rodar
  testar-remetente.ts   npm run testar-remetente
dados/parametros.json   prazos e limites
exemplos/               carteira fictícia e modelo de agendamento
```

## Antes de usar em produção

- `dados/parametros.json` está **não verificado**. O vencimento do DAS vai para o próximo dia útil quando cai em fim de semana ou feriado nacional de data fixa (`feriadosNacionais`); essa regra de prorrogação está a validar, e a lista não tem feriados móveis (Carnaval, Sexta-feira Santa, Corpus Christi) nem locais.
- O sublimite e o limite do Simples são medidos pela receita do ano-calendário (LC 123, art. 3º e art. 20), com o efeito da regra dos 20%; o aviso de "perto" também considera o RBT12. Ainda não há o proporcional no ano de abertura: confirmar com o contador.
- O limite do MEI segue a tabela `limitesMei` por ano: R$ 81 mil até 2026, R$ 110 mil em 2027 e R$ 140 mil a partir de 2028 (LC 238/2026).
- Exporte só empresas que aceitaram receber avisos e com DAS pagos confiáveis (aviso falso de atraso é o pior erro).
- O registro `saida/envios-AAAA-MM-DD.json` e a chave de idempotência evitam duplicar no mesmo dia, mas não entre rodadas de dias diferentes: para mais de uma rodada por mês, veja "Não mandar duas vezes" na skill `agendar-envio`.
