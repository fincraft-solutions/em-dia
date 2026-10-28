import { criarProvedor } from "./email/provedores.ts";
import { cabecalhoDe, carregarRemetente, emailValido, validarRemetente } from "./email/remetente.ts";
import { escaparHtml } from "./mensagem.ts";

// Confere a configuração do remetente e, se estiver completa, manda um e-mail de teste de verdade.
const destino = process.argv[2];

let remetente;
try {
  remetente = carregarRemetente();
} catch (erro) {
  console.error((erro as Error).message);
  process.exit(1);
}

console.log(`Provedor: ${remetente.provedor}`);
console.log(`De: ${cabecalhoDe(remetente)}`);
console.log(`Responder para: ${remetente.responderPara ?? "(mesmo do remetente)"}`);
console.log(`Descadastro: ${remetente.linkDescadastro ?? "(não configurado)"}`);

const erros = validarRemetente(remetente);
if (erros.length > 0) {
  console.error(`\nConfiguração incompleta:\n- ${erros.join("\n- ")}`);
  process.exit(1);
}
const simulacao = remetente.provedor === "console";
if (simulacao) {
  console.log("\nProvedor console: nada será enviado de verdade. Use EM_DIA_EMAIL_PROVEDOR=resend para testar o envio real.");
}
if (!destino) {
  console.log("\nConfiguração OK. Para enviar um teste: npm run testar-remetente -- voce@seudominio.com.br");
  process.exit(0);
}
if (!emailValido(destino)) {
  console.error(`\nDestino inválido: ${destino}`);
  process.exit(1);
}

const mensagem = `Se você recebeu este e-mail na caixa de entrada (e não no spam), o remetente ${remetente.email} está pronto.`;
const { id } = await criarProvedor(remetente).enviar({
  para: destino,
  assunto: "Teste do remetente do Em Dia",
  texto: `${mensagem}\n\n${remetente.assinatura}`,
  html: `<p>${escaparHtml(mensagem)}</p><p>${escaparHtml(remetente.assinatura)}</p>`,
});
console.log(
  simulacao
    ? `\nNada foi enviado: o e-mail foi gravado em saida/emails/ (id ${id}).`
    : `\nEnviado (id ${id}). Confira a caixa de entrada e o spam de ${destino}.`,
);
