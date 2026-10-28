---
name: configurar-remetente
description: Preparar o remetente de e-mail do Em Dia para envio real - domínio próprio, conta no Resend, registros DNS (SPF, DKIM, DMARC), variáveis de ambiente, link de descadastro e e-mail de teste. Use antes do primeiro envio real, ao trocar o endereço ou o provedor, ou quando os avisos estiverem caindo no spam.
---

# Configurar o remetente do Em Dia

Sem remetente configurado, o Em Dia só **simula**: grava os e-mails em `saida/emails/`. O envio real só acontece com `--enviar` e com a configuração validada por `validarRemetente` (`src/email/remetente.ts`). Se faltar algo, ele recusa começar e lista o que falta.

## O que precisa existir

1. **Um domínio próprio** (ex. `wavern.com.br` ou o domínio do escritório). Gmail, Hotmail e outros e-mails gratuitos são recusados de propósito: não dá para autenticá-los, e os avisos cairiam no spam.
2. **Um endereço de envio** nesse domínio, de preferência um subdomínio só para avisos (ex. `avisos@mail.wavern.com.br`). Assim a reputação dos avisos não afeta o e-mail do dia a dia.
3. **Uma conta no provedor de envio.** O código já vem com o Resend (`provedorResend`). Para outro provedor, veja "Trocar de provedor" abaixo.
4. **Uma página de descadastro (https).** Todo aviso automático precisa de um jeito de parar de receber (boa prática e exigência dos provedores; a LGPD também pede respeito à oposição do titular). Pode ser uma página do Wavern que desliga o aviso daquela empresa.

## Passo a passo (Resend)

1. Crie a conta em resend.com e adicione o domínio (ou subdomínio) em **Domains**.
2. O Resend mostra os registros DNS. Cadastre todos no DNS do domínio (Registro.br, Cloudflare etc.):
   - **SPF** (TXT): autoriza o Resend a enviar pelo domínio.
   - **DKIM** (TXT): assinatura que prova que o e-mail não foi alterado.
   - **MX** do subdomínio de retorno, se o Resend pedir.
3. Cadastre também um **DMARC** (TXT em `_dmarc.seudominio.com.br`). Comece com `v=DMARC1; p=none; rua=mailto:dmarc@seudominio.com.br` e, depois de algumas semanas sem problema, endureça para `p=quarantine`.
4. Espere o domínio aparecer como **Verified** no Resend (minutos a algumas horas).
5. Crie uma API key em **API Keys** com permissão **só de envio** (Sending access), restrita ao domínio.
6. Preencha o `.env` (a partir do `.env.example`):

   ```
   EM_DIA_EMAIL_PROVEDOR=resend
   EM_DIA_REMETENTE_EMAIL=avisos@mail.seudominio.com.br
   EM_DIA_REMETENTE_NOME=Wavern
   EM_DIA_RESPONDER_PARA=contato@seudominio.com.br
   EM_DIA_LINK_DESCADASTRO=https://seudominio.com.br/preferencias/avisos
   EM_DIA_ASSINATURA=Equipe Wavern
   RESEND_API_KEY=re_...
   ```

   Em produção, guarde `RESEND_API_KEY` no cofre de segredos da hospedagem, nunca no repositório.
7. Confira e teste:

   ```bash
   npm run testar-remetente                       # só valida a configuração
   npm run testar-remetente -- voce@seudominio.com.br   # envia um e-mail real de teste
   ```

   Abra o e-mail recebido e, no Gmail, "Mostrar original": SPF, DKIM e DMARC devem aparecer como **PASS**.
8. Rode a carteira em simulação, revise os textos em `saida/emails/` e só então rode com `--enviar`.

## Remetente por escritório

Se cada contador quiser que o aviso saia em nome do escritório, há dois caminhos:

- **Simples:** remetente do Wavern (`avisos@mail.wavern.com.br`), `EM_DIA_REMETENTE_NOME` com o nome do escritório e `EM_DIA_RESPONDER_PARA` com o e-mail do contador. As respostas vão direto para ele.
- **Completo:** o escritório verifica o próprio domínio no Resend e o Em Dia roda com a configuração dele. Exige uma execução (ou um conjunto de variáveis) por escritório.

## Trocar de provedor

Implemente a interface `ProvedorEmail` de `src/email/provedores.ts` (um método `enviar` que devolve `{ id }`), seguindo o modelo de `provedorResend`, e escolha-o em `criarProvedor`. Provedores comuns: Amazon SES, SendGrid, Postmark ou SMTP do próprio domínio. Acrescente o nome em `NomeProvedor` e as regras de validação em `validarRemetente`.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Resend responde 403 | Domínio ainda não verificado, ou remetente de outro domínio |
| E-mail cai no spam | DMARC ausente, DKIM falhando, ou primeiro envio em volume (aqueça mandando poucos por dia na primeira semana) |
| Cliente responde e ninguém vê | `EM_DIA_RESPONDER_PARA` não configurado ou caixa sem dono |
| "Remetente mal configurado" | Rode `npm run testar-remetente` e corrija cada item listado |
| "EM_DIA_EMAIL_PROVEDOR desconhecido" | Use `console` ou `resend` (maiúsculas são aceitas) |
| "--enviar exige EM_DIA_EMAIL_PROVEDOR=resend" | Com o provedor `console` nada sai; o `--enviar` recusa em vez de simular |
| "precisa ser um endereço https://" | O link de descadastro precisa ser `https://` (vai no rodapé e no cabeçalho `List-Unsubscribe`) |

O Em Dia manda também `List-Unsubscribe-Post: List-Unsubscribe=One-Click`: para o descadastro de um clique do Gmail e do Yahoo funcionar, a página de descadastro precisa aceitar um `POST` nesse endereço. O nome do remetente vai sempre entre aspas no "De:" e não pode ter `<`, `>` nem quebra de linha.
