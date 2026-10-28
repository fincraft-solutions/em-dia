export type NomeProvedor = "console" | "resend";

const PROVEDORES: NomeProvedor[] = ["console", "resend"];

export interface ConfigRemetente {
  provedor: NomeProvedor;
  /** Endereço que aparece no "De:". No Resend, precisa ser de um domínio verificado. */
  email: string;
  nome: string;
  responderPara?: string;
  /** Link https para a pessoa parar de receber os avisos. Obrigatório para envio real. */
  linkDescadastro?: string;
  /** Texto que fecha todo e-mail (ex. "Equipe Wavern" ou o nome do escritório). */
  assinatura: string;
  resendApiKey?: string;
}

// Provedores de e-mail gratuitos não deixam verificar o domínio: e-mails "de" lá caem no spam ou são recusados.
const DOMINIOS_GRATUITOS = [
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.com.br", "outlook.com", "outlook.com.br", "live.com", "msn.com",
  "yahoo.com", "yahoo.com.br", "ymail.com", "bol.com.br", "uol.com.br", "terra.com.br", "ig.com.br", "icloud.com", "me.com",
  "aol.com", "proton.me", "protonmail.com",
];
const FORMATO_EMAIL = /^[^\s@<>"(),;:\\]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

export function emailValido(email: string): boolean {
  return FORMATO_EMAIL.test(email.trim());
}

/** Domínio em minúsculas e sem o ponto final (gmail.com. = gmail.com). */
function dominioDe(email: string): string {
  return (email.split("@")[1] ?? "").toLowerCase().replace(/\.+$/, "");
}

/** Lê o provedor sem diferenciar maiúsculas; valor desconhecido é erro, nunca simulação silenciosa. */
function lerProvedor(valor: string | undefined): NomeProvedor {
  const normalizado = (valor ?? "").trim().toLowerCase() || "console";
  if (!PROVEDORES.includes(normalizado as NomeProvedor)) {
    throw new Error(`EM_DIA_EMAIL_PROVEDOR desconhecido: "${valor}". Use ${PROVEDORES.join(" ou ")}.`);
  }
  return normalizado as NomeProvedor;
}

export function carregarRemetente(env: NodeJS.ProcessEnv = process.env): ConfigRemetente {
  const nome = env.EM_DIA_REMETENTE_NOME?.trim() || "Wavern";
  return {
    provedor: lerProvedor(env.EM_DIA_EMAIL_PROVEDOR),
    email: env.EM_DIA_REMETENTE_EMAIL?.trim() || "",
    nome,
    responderPara: env.EM_DIA_RESPONDER_PARA?.trim() || undefined,
    linkDescadastro: env.EM_DIA_LINK_DESCADASTRO?.trim() || undefined,
    assinatura: env.EM_DIA_ASSINATURA?.trim() || `Equipe ${nome}`,
    resendApiKey: env.RESEND_API_KEY?.trim() || undefined,
  };
}

function linkHttps(link: string): boolean {
  try {
    return new URL(link).protocol === "https:";
  } catch {
    return false;
  }
}

/** Lista os problemas da configuração. Vazio = pronto para enviar. */
export function validarRemetente(config: ConfigRemetente): string[] {
  const erros: string[] = [];
  if (config.provedor === "console") return erros;

  if (!emailValido(config.email)) erros.push("EM_DIA_REMETENTE_EMAIL ausente ou inválido.");
  const dominio = dominioDe(config.email);
  if (dominio && DOMINIOS_GRATUITOS.includes(dominio)) {
    erros.push(`O remetente usa ${dominio}. Use um endereço do seu domínio (ex. avisos@seudominio.com.br) verificado no provedor.`);
  }
  if (/[<>\r\n]/.test(config.nome)) erros.push("EM_DIA_REMETENTE_NOME não pode ter < > nem quebra de linha.");
  if (config.responderPara && !emailValido(config.responderPara)) erros.push("EM_DIA_RESPONDER_PARA inválido.");
  if (!config.linkDescadastro) erros.push("EM_DIA_LINK_DESCADASTRO ausente: todo aviso automático precisa de um jeito de parar de receber.");
  else if (!linkHttps(config.linkDescadastro)) erros.push("EM_DIA_LINK_DESCADASTRO precisa ser um endereço https://.");
  if (config.provedor === "resend" && !config.resendApiKey) erros.push("RESEND_API_KEY ausente.");
  return erros;
}

/** Cabeçalho "De:" com o nome entre aspas (nomes com vírgula, como "Silva, Contábil", exigem). */
export function cabecalhoDe(config: ConfigRemetente): string {
  const nome = config.nome.replace(/[\r\n<>]/g, " ").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${nome}" <${config.email || "remetente-nao-configurado"}>`;
}
