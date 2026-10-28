import { readFileSync } from "node:fs";
import type { BetaMessage, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { ConfigRemetente } from "./email/remetente.ts";
import type { Email } from "./email/provedores.ts";
import type { EmpresaEmDia, Pendencia } from "./tipos.ts";

const PROMPT = readFileSync(new URL("../prompts/mensagem.md", import.meta.url), "utf8");
const MODELOS_COM_FALLBACK = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);

export interface ClienteClaude {
  beta: { messages: { create(params: MessageCreateParamsNonStreaming): Promise<BetaMessage> } };
}

export interface Rascunho {
  assunto: string;
  corpo: string;
  /** "ia" quando o Claude redigiu; "modelo" quando caiu no texto padrão. */
  origem: "ia" | "modelo";
}

const MAXIMO_ASSUNTO = 120;
const MAXIMO_CORPO = 4000;
const TEM_LINK = /https?:\/\/|www\./i;

/** Assunto em uma linha só (quebra de linha no assunto é injeção de cabeçalho) e com tamanho limitado. */
export function sanearAssunto(assunto: string): string {
  return assunto.replace(/\s+/g, " ").trim().slice(0, MAXIMO_ASSUNTO);
}

function saudacao(nome: string): string {
  const primeiro = nome.trim().split(/\s+/)[0];
  return primeiro ? `Olá, ${primeiro}!` : "Olá!";
}

/** Texto padrão, sem IA. Também é a rede de segurança quando a API falha. */
export function rascunhoPadrao(empresa: EmpresaEmDia, pendencias: Pendencia[]): Rascunho {
  const linhas = pendencias.map((pendencia) => `- ${pendencia.titulo}: ${pendencia.detalhe} ${pendencia.acao}`);
  return {
    assunto: pendencias.length === 1 ? pendencias[0].titulo : `${pendencias.length} pendências fiscais de ${empresa.razaoSocial}`,
    corpo: [
      saudacao(empresa.contato.nome),
      "",
      `Fizemos a checagem mensal da ${empresa.razaoSocial} e encontramos ${pendencias.length === 1 ? "1 ponto" : `${pendencias.length} pontos`} para você resolver:`,
      "",
      ...linhas,
      "",
      "Se tiver qualquer dúvida, é só responder este e-mail.",
    ].join("\n"),
    origem: "modelo",
  };
}

export function montarRequisicaoMensagem(empresa: EmpresaEmDia, pendencias: Pendencia[], modelo: string): MessageCreateParamsNonStreaming {
  const requisicao: MessageCreateParamsNonStreaming = {
    model: modelo,
    max_tokens: 4000,
    system: PROMPT,
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: { assunto: { type: "string" }, corpo: { type: "string" } },
          required: ["assunto", "corpo"],
          additionalProperties: false,
        },
      },
    },
    messages: [
      {
        role: "user",
        content: JSON.stringify({ contato: empresa.contato.nome, empresa: empresa.razaoSocial, regime: empresa.regime, pendencias }),
      },
    ],
  };
  if (MODELOS_COM_FALLBACK.has(modelo)) {
    requisicao.betas = ["server-side-fallback-2026-07-01"];
    requisicao.fallbacks = "default";
  }
  return requisicao;
}

export async function redigirComIa(
  empresa: EmpresaEmDia,
  pendencias: Pendencia[],
  cliente: ClienteClaude,
  modelo: string = process.env.EM_DIA_MODELO || "claude-opus-5-5",
): Promise<Rascunho> {
  try {
    const mensagem = await cliente.beta.messages.create(montarRequisicaoMensagem(empresa, pendencias, modelo));
    if (mensagem.stop_reason !== "end_turn") return rascunhoPadrao(empresa, pendencias);
    const texto = mensagem.content.flatMap((bloco) => (bloco.type === "text" ? [bloco.text] : [])).join("");
    const { assunto, corpo } = (JSON.parse(texto) ?? {}) as { assunto?: unknown; corpo?: unknown };
    if (typeof assunto !== "string" || typeof corpo !== "string") return rascunhoPadrao(empresa, pendencias);
    const assuntoLimpo = sanearAssunto(assunto);
    const corpoLimpo = corpo.trim();
    // O prompt proíbe links: se vier um, pode ser alucinação ou injeção (ex. boleto falso). Usa o texto padrão.
    if (!assuntoLimpo || !corpoLimpo || corpoLimpo.length > MAXIMO_CORPO || TEM_LINK.test(corpoLimpo) || TEM_LINK.test(assuntoLimpo)) {
      return rascunhoPadrao(empresa, pendencias);
    }
    return { assunto: assuntoLimpo, corpo: corpoLimpo, origem: "ia" };
  } catch (erro) {
    console.warn(`Redação com IA falhou para ${empresa.cnpj} (${((erro as Error)?.message ?? String(erro)).split("\n")[0]}); usando o texto padrão.`);
    return rascunhoPadrao(empresa, pendencias);
  }
}

export const escaparHtml = (texto: string) =>
  texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Junta rascunho, assinatura e rodapé de descadastro no e-mail final. */
export function montarEmail(empresa: EmpresaEmDia, rascunho: Rascunho, remetente: ConfigRemetente): Email {
  const rodape = remetente.linkDescadastro ? `Não quer mais receber estes avisos? ${remetente.linkDescadastro}` : "";
  const texto = [rascunho.corpo, "", remetente.assinatura, ...(rodape ? ["", rodape] : [])].join("\n");

  const paragrafos = rascunho.corpo
    .split(/\n{2,}/)
    .map((bloco) => `<p>${escaparHtml(bloco).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const linkRodape = remetente.linkDescadastro
    ? `<p style="color:#666;font-size:12px">Não quer mais receber estes avisos? <a href="${escaparHtml(remetente.linkDescadastro)}">Descadastrar</a></p>`
    : "";
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5">${paragrafos}<p>${escaparHtml(remetente.assinatura)}</p>${linkRodape}</div>`;

  return { para: empresa.contato.email, assunto: sanearAssunto(rascunho.assunto), texto, html };
}
