---
name: conectar-dados
description: Montar a carteira de entrada do Em Dia (contrato Carteira/EmpresaEmDia) a partir dos dados do Wavern - cadastro, receitas, DAS pagos, notas, declarações e contato. Use ao integrar o agente com a plataforma ou quando uma pendência esperada não aparecer.
---

# Conectar dados ao Em Dia

O Em Dia recebe **um JSON de carteira** (`Carteira` em `src/tipos.ts`): o contador (opcional) e a lista de empresas. Ele não lê o banco: quem integra exporta os dados nesse formato. O exemplo completo está em `exemplos/carteira.json`.

## Contrato, campo a campo

| Campo | Obrigatório | De onde vem no Wavern | Pendências que dependem dele |
|---|---|---|---|
| `cnpj`, `razaoSocial`, `regime` | sim | cadastro da empresa | todas |
| `contato.nome`, `contato.email` | sim | usuário administrador da empresa | destino do e-mail |
| `dataAbertura` | não | cadastro (início da atividade) | limite proporcional do MEI, início da checagem de DAS |
| `receitas` | sim | faturamento por competência (`AAAA-MM`: valor) | teto do MEI, sublimite, DAS do Simples, notas |
| `dasPagos` | sim | competências com DAS pago (status do DAS) | DAS a vencer e em atraso |
| `notasRegistradas` | não | quantidade de notas por competência | notas faltando |
| `ultimaDeclaracaoEntregue` | não | último ano com DASN-SIMEI/DEFIS entregue. Ausente = não checar; `null` = nunca entregou | declaração anual (cobra cada ano pendente, até 5 anos) |
| `rbt12`, `folha12`, `atividade` | Simples | motor de DAS e Fator R | sublimite, Fator R |
| `contador.email` | não | portfólio do contador | recebe a fila priorizada |

## Regras de exportação

1. **Só quem aceitou receber.** Exporte apenas empresas com o aviso ativo (o link de descadastro desliga esse campo).
2. **Uma carteira por contador** quando o envio for em nome do escritório; uma carteira "Wavern" para empresas sem contador.
3. **Sem `dasPagos` confiável, não exporte a empresa.** Um DAS pago tratado como em aberto gera aviso falso de atraso, que é o pior erro para a credibilidade do produto.
4. Use a chave de serviço do Supabase só no servidor e respeite a permissão do portfólio do contador.
5. Não comite carteiras reais (têm e-mail e faturamento). Use `saida/` ou um caminho fora do repositório.

## Pendência não apareceu?

- DAS: a checagem cobre as 12 últimas competências fechadas e, no Simples, só meses com receita maior que zero.
- Declaração anual: precisa de `ultimaDeclaracaoEntregue` (ausente = não checa; `null` = nunca entregou); empresa aberta no ano corrente é ignorada.
- Empresa sumiu da rodada? Veja os avisos no início da saída: empresa com dado inválido é descartada com o cnpj e o campo com problema (`src/validacao.ts`). Competências em `AAAA-MM` com dois dígitos no mês, datas em `AAAA-MM-DD`, valores numéricos ≥ 0 e `contato.email` válido.
- Teto do MEI e sublimite: alertam a partir de 80% (`alertaTetoPercentual` em `dados/parametros.json`).
- Fator R: só com `atividade: "servico_fator_r"`, `rbt12` e `folha12`, e dentro da faixa `faixaAlertaFatorR`.
