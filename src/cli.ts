import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { filaDoContador, verificarCarteira } from "./carteira.ts";
import { hojeEmBrasilia, plural, validarData } from "./datas.ts";
import { criarProvedor, provedorConsole } from "./email/provedores.ts";
import { carregarRemetente } from "./email/remetente.ts";
import { type ClienteClaude, escaparHtml, montarEmail, rascunhoPadrao, redigirComIa } from "./mensagem.ts";
import { carregarParametros } from "./regras.ts";
import { validarCarteira } from "./validacao.ts";

const USO = "Uso: npm run rodar -- exemplos/carteira.json [--enviar] [--sem-ia] [--hoje AAAA-MM-DD] [--aceitar-parametros-nao-verificados]";

/** Erro de uso ou de configuração: nada foi enviado. */
function falhar(mensagem: string, codigo = 2): never {
  console.error(mensagem);
  process.exit(codigo);
}

let opcoes;
try {
  opcoes = parseArgs({
    allowPositionals: true,
    options: {
      enviar: { type: "boolean", default: false },
      "sem-ia": { type: "boolean", default: false },
      hoje: { type: "string" },
      "aceitar-parametros-nao-verificados": { type: "boolean", default: false },
    },
  });
} catch (erro) {
  falhar(`${(erro as Error).message}\n${USO}`);
}
const { values, positionals } = opcoes;

const arquivo = positionals[0];
if (!arquivo) falhar(USO, 1);

let hoje: string;
try {
  hoje = values.hoje === undefined ? hojeEmBrasilia() : validarData(values.hoje, "--hoje");
} catch (erro) {
  falhar((erro as Error).message);
}

let entrada: unknown;
try {
  entrada = JSON.parse(readFileSync(arquivo, "utf8"));
} catch (erro) {
  const motivo = (erro as NodeJS.ErrnoException).code === "ENOENT" ? "arquivo não encontrado" : "JSON inválido";
  falhar(`Não consegui ler ${arquivo}: ${motivo}.`);
}

let validada;
try {
  validada = validarCarteira(entrada);
} catch (erro) {
  falhar((erro as Error).message);
}
const { carteira, avisos } = validada;
for (const aviso of avisos) console.warn(`Aviso: ${aviso}`);

const parametros = carregarParametros();
let remetente;
try {
  remetente = carregarRemetente();
} catch (erro) {
  falhar((erro as Error).message);
}

if (values.enviar && remetente.provedor === "console") {
  falhar("--enviar exige EM_DIA_EMAIL_PROVEDOR=resend. Com o provedor console nada é enviado (rode sem --enviar para simular).");
}

// Sem --enviar é sempre simulação: os e-mails vão para saida/emails/, mesmo com o Resend configurado.
let provedor;
try {
  provedor = values.enviar ? criarProvedor(remetente) : provedorConsole(remetente);
} catch (erro) {
  falhar((erro as Error).message);
}

if (!parametros.verificado_em) {
  if (values.enviar && !values["aceitar-parametros-nao-verificados"]) {
    falhar("dados/parametros.json ainda não foi verificado. Confira prazos e limites e preencha verificado_em, ou use --aceitar-parametros-nao-verificados.");
  }
  console.warn("Aviso: dados/parametros.json ainda não verificado (prazos e limites de demonstração).");
}

let cliente: ClienteClaude | null = null;
if (!values["sem-ia"]) {
  if (process.env.ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim()) cliente = new Anthropic();
  else console.warn("Aviso: sem ANTHROPIC_API_KEY; os e-mails usam o texto padrão.");
}

interface RegistroEnvio {
  cnpj: string;
  razaoSocial: string;
  para: string;
  situacao: "enviado" | "falhou" | "em-dia";
  pendencias: number;
  id?: string;
  erro?: string;
}

const registros: RegistroEnvio[] = [];
const resultados = verificarCarteira(carteira, hoje, parametros);

// Uma empresa com erro não impede as demais: o erro é registrado e a rodada continua.
for (const { empresa, pendencias } of resultados) {
  const registro: RegistroEnvio = { cnpj: empresa.cnpj, razaoSocial: empresa.razaoSocial, para: empresa.contato.email, situacao: "em-dia", pendencias: pendencias.length };
  registros.push(registro);
  if (pendencias.length === 0) {
    console.log(`✓ ${empresa.razaoSocial}: em dia, nenhum e-mail.`);
    continue;
  }
  try {
    const rascunho = cliente ? await redigirComIa(empresa, pendencias, cliente) : rascunhoPadrao(empresa, pendencias);
    const email = { ...montarEmail(empresa, rascunho, remetente), chaveIdempotencia: `em-dia-${empresa.cnpj.replace(/\D/g, "")}-${hoje}` };
    const { id } = await provedor.enviar(email);
    Object.assign(registro, { situacao: "enviado", id });
    console.log(`✉ ${empresa.razaoSocial}: ${plural(pendencias.length, "pendência")} → ${empresa.contato.email} [${provedor.nome}, texto ${rascunho.origem}, ${id}]`);
  } catch (erro) {
    Object.assign(registro, { situacao: "falhou", erro: (erro as Error).message });
    console.error(`✗ ${empresa.razaoSocial}: falhou o envio para ${empresa.contato.email}: ${(erro as Error).message}`);
  }
}

const fila = filaDoContador(resultados, hoje, Boolean(parametros.verificado_em));
mkdirSync("saida", { recursive: true });
writeFileSync(`saida/fila-${hoje}.md`, fila);
console.log(`\nFila do contador salva em saida/fila-${hoje}.md`);

if (carteira.contador?.email) {
  const registro: RegistroEnvio = { cnpj: "contador", razaoSocial: carteira.contador.nome, para: carteira.contador.email, situacao: "enviado", pendencias: 0 };
  registros.push(registro);
  try {
    const { id } = await provedor.enviar({
      para: carteira.contador.email,
      assunto: `Em Dia: fila da carteira em ${hoje}`,
      texto: fila,
      html: `<pre style="font-family:monospace">${escaparHtml(fila)}</pre>`,
      chaveIdempotencia: `em-dia-fila-${carteira.contador.email}-${hoje}`,
    });
    registro.id = id;
    console.log(`Fila enviada para ${carteira.contador.email} [${provedor.nome}].`);
  } catch (erro) {
    Object.assign(registro, { situacao: "falhou", erro: (erro as Error).message });
    console.error(`✗ Fila do contador: falhou o envio para ${carteira.contador.email}: ${(erro as Error).message}`);
  }
}

// Registro de quem recebeu: base para reenviar só as falhas sem duplicar os demais.
writeFileSync(`saida/envios-${hoje}.json`, `${JSON.stringify(registros, null, 2)}\n`);
const falhas = registros.filter((registro) => registro.situacao === "falhou").length;
console.log(`Registro de envios salvo em saida/envios-${hoje}.json`);
if (falhas > 0) {
  console.error(`${plural(falhas, "envio falhou", "envios falharam")}. Veja saida/envios-${hoje}.json.`);
  process.exitCode = 1;
}
