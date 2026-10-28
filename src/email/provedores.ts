import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { cabecalhoDe, type ConfigRemetente, validarRemetente } from "./remetente.ts";

export interface Email {
  para: string;
  assunto: string;
  texto: string;
  html: string;
  /** Mesma chave = mesmo envio: o provedor não manda duas vezes se a rodada for repetida. */
  chaveIdempotencia?: string;
}

export interface ProvedorEmail {
  nome: string;
  enviar(email: Email): Promise<{ id: string }>;
}

/** Não envia nada: grava cada e-mail em saida/emails/ para conferência. É o padrão. */
export function provedorConsole(config: ConfigRemetente, pasta = "saida/emails"): ProvedorEmail {
  return {
    nome: "console",
    async enviar(email) {
      mkdirSync(pasta, { recursive: true });
      const id = `${Date.now()}-${randomUUID().slice(0, 8)}-${email.para.replace(/[^a-z0-9]/gi, "_")}`;
      const conteudo = [`De: ${cabecalhoDe(config)}`, `Para: ${email.para}`, `Assunto: ${email.assunto}`, "", email.texto].join("\n");
      // "wx": nunca sobrescreve um e-mail já gravado.
      writeFileSync(`${pasta}/${id}.txt`, conteudo, { flag: "wx" });
      return { id };
    },
  };
}

export interface OpcoesResend {
  /** Tentativas no total (a primeira mais as repetições em 429, 5xx ou falha de rede). */
  tentativas?: number;
  timeoutMs?: number;
  /** Espera entre tentativas; injetável para os testes não dormirem. */
  esperar?: (ms: number) => Promise<void>;
}

const esperarDeVerdade = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

function chavePadrao(email: Email): string {
  return `em-dia-${createHash("sha256").update(`${email.para}\n${email.assunto}\n${email.texto}`).digest("hex").slice(0, 32)}`;
}

/** Envio real pela API do Resend (https://resend.com/docs/api-reference/emails/send-email). */
export function provedorResend(config: ConfigRemetente, fetchFn: typeof fetch = fetch, opcoes: OpcoesResend = {}): ProvedorEmail {
  const { tentativas = 3, timeoutMs = 15_000, esperar = esperarDeVerdade } = opcoes;
  const headers: Record<string, string> = {};
  if (config.linkDescadastro) {
    headers["List-Unsubscribe"] = `<${config.linkDescadastro}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  return {
    nome: "resend",
    async enviar(email) {
      const corpo = JSON.stringify({
        from: cabecalhoDe(config),
        to: [email.para],
        subject: email.assunto,
        text: email.texto,
        html: email.html,
        ...(config.responderPara ? { reply_to: config.responderPara } : {}),
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      });
      const chave = email.chaveIdempotencia ?? chavePadrao(email);

      let ultimoErro: Error = new Error("Resend não respondeu.");
      for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
        if (tentativa > 1) await esperar(1000 * 2 ** (tentativa - 2));
        let resposta: Response;
        try {
          resposta = await fetchFn("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${config.resendApiKey}`, "Content-Type": "application/json", "Idempotency-Key": chave },
            body: corpo,
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (erro) {
          // Rede ou timeout: a chave de idempotência evita duplicar se o primeiro pedido chegou.
          ultimoErro = new Error(`Falha de rede ao chamar o Resend: ${(erro as Error).message}`);
          continue;
        }

        if (resposta.ok) {
          const texto = await resposta.text();
          try {
            return { id: String((JSON.parse(texto) as { id?: unknown }).id ?? "sem-id") };
          } catch {
            return { id: "sem-id" };
          }
        }
        ultimoErro = new Error(`Resend recusou o envio (${resposta.status}): ${await resposta.text()}`);
        if (resposta.status !== 429 && resposta.status < 500) break;
      }
      throw ultimoErro;
    },
  };
}

/** Escolhe o provedor pela configuração e recusa começar se o remetente estiver incompleto. */
export function criarProvedor(config: ConfigRemetente): ProvedorEmail {
  const erros = validarRemetente(config);
  if (erros.length > 0) {
    throw new Error(`Remetente mal configurado (veja a skill configurar-remetente):\n- ${erros.join("\n- ")}`);
  }
  return config.provedor === "resend" ? provedorResend(config) : provedorConsole(config);
}
