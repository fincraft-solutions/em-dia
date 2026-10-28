import { ehCompetencia, ehData } from "./datas.ts";
import { emailValido } from "./email/remetente.ts";
import type { Carteira, EmpresaEmDia } from "./tipos.ts";

// Aviso falso de atraso é o pior erro do produto: dado duvidoso é recusado, nunca adivinhado.

const ATIVIDADES = ["comercio", "servico_fator_r", "servico_anexo_iii", "outra"] as const;

const ehObjeto = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor);

const ehValor = (valor: unknown): valor is number => typeof valor === "number" && Number.isFinite(valor) && valor >= 0;

/** Valida e normaliza uma empresa. Lança erro listando todos os campos com problema. */
export function validarEmpresa(entrada: unknown): EmpresaEmDia {
  if (!ehObjeto(entrada)) throw new Error("empresa não é um objeto");
  const erros: string[] = [];
  const campo = (nome: string, problema: string) => erros.push(`${nome}: ${problema}`);

  const { cnpj, razaoSocial, contato } = entrada;
  if (typeof cnpj !== "string" || !cnpj.trim()) campo("cnpj", "ausente");
  if (typeof razaoSocial !== "string" || !razaoSocial.trim()) campo("razaoSocial", "ausente");

  const regime = typeof entrada.regime === "string" ? entrada.regime.trim().toUpperCase() : entrada.regime;
  if (regime !== "MEI" && regime !== "SIMPLES") campo("regime", `${JSON.stringify(entrada.regime)} não é MEI nem SIMPLES`);

  if (!ehObjeto(contato) || typeof contato.email !== "string" || !emailValido(contato.email)) {
    campo("contato.email", "ausente ou inválido");
  }
  const nome = ehObjeto(contato) && typeof contato.nome === "string" ? contato.nome.trim() : "";

  const { dataAbertura } = entrada;
  if (dataAbertura !== undefined && dataAbertura !== null && !ehData(dataAbertura)) {
    campo("dataAbertura", `${JSON.stringify(dataAbertura)} não é AAAA-MM-DD`);
  }

  const receitas = entrada.receitas ?? {};
  if (!ehObjeto(receitas)) campo("receitas", "não é um objeto { AAAA-MM: valor }");
  else {
    for (const [comp, valor] of Object.entries(receitas)) {
      if (!ehCompetencia(comp)) campo("receitas", `competência ${JSON.stringify(comp)} não é AAAA-MM`);
      else if (!ehValor(valor)) campo(`receitas.${comp}`, `${JSON.stringify(valor)} não é número ≥ 0`);
    }
  }

  const { dasPagos } = entrada;
  if (!Array.isArray(dasPagos)) campo("dasPagos", "ausente (sem ele todo DAS pareceria em atraso)");
  else {
    const invalidas = dasPagos.filter((comp) => !ehCompetencia(comp));
    if (invalidas.length > 0) campo("dasPagos", `competências fora do formato AAAA-MM: ${invalidas.map((c) => JSON.stringify(c)).join(", ")}`);
  }

  const { notasRegistradas } = entrada;
  if (notasRegistradas !== undefined && notasRegistradas !== null) {
    if (!ehObjeto(notasRegistradas)) campo("notasRegistradas", "não é um objeto { AAAA-MM: quantidade }");
    else {
      for (const [comp, quantidade] of Object.entries(notasRegistradas)) {
        if (!ehCompetencia(comp)) campo("notasRegistradas", `competência ${JSON.stringify(comp)} não é AAAA-MM`);
        else if (!ehValor(quantidade)) campo(`notasRegistradas.${comp}`, `${JSON.stringify(quantidade)} não é número ≥ 0`);
      }
    }
  }

  const { ultimaDeclaracaoEntregue } = entrada;
  if (ultimaDeclaracaoEntregue !== undefined && ultimaDeclaracaoEntregue !== null && !(Number.isInteger(ultimaDeclaracaoEntregue) && (ultimaDeclaracaoEntregue as number) > 1900)) {
    campo("ultimaDeclaracaoEntregue", `${JSON.stringify(ultimaDeclaracaoEntregue)} não é um ano`);
  }

  for (const nomeCampo of ["rbt12", "folha12"] as const) {
    const valor = entrada[nomeCampo];
    if (valor !== undefined && valor !== null && !ehValor(valor)) campo(nomeCampo, `${JSON.stringify(valor)} não é número ≥ 0`);
  }

  const { atividade } = entrada;
  if (atividade !== undefined && atividade !== null && !ATIVIDADES.includes(atividade as (typeof ATIVIDADES)[number])) {
    campo("atividade", `${JSON.stringify(atividade)} não é ${ATIVIDADES.join(", ")}`);
  }

  if (erros.length > 0) throw new Error(erros.join("; "));

  const empresa: EmpresaEmDia = {
    cnpj: (cnpj as string).trim(),
    razaoSocial: (razaoSocial as string).trim(),
    regime: regime as EmpresaEmDia["regime"],
    contato: { nome, email: ((contato as Record<string, unknown>).email as string).trim() },
    dataAbertura: (dataAbertura as string | null | undefined) ?? null,
    receitas: receitas as Record<string, number>,
    dasPagos: dasPagos as string[],
  };
  if (ehObjeto(notasRegistradas)) empresa.notasRegistradas = notasRegistradas as Record<string, number>;
  // Ausente continua ausente: a declaração não é checada.
  if (ultimaDeclaracaoEntregue !== undefined) empresa.ultimaDeclaracaoEntregue = ultimaDeclaracaoEntregue as number | null;
  if (ehValor(entrada.rbt12)) empresa.rbt12 = entrada.rbt12;
  if (ehValor(entrada.folha12)) empresa.folha12 = entrada.folha12;
  if (atividade) empresa.atividade = atividade as EmpresaEmDia["atividade"];
  return empresa;
}

/**
 * Valida a carteira inteira. Empresa com dado inválido é descartada com aviso (citando cnpj e campo),
 * sem derrubar as demais. Só lança erro se a carteira em si não tiver o formato esperado.
 */
export function validarCarteira(entrada: unknown): { carteira: Carteira; avisos: string[] } {
  if (!ehObjeto(entrada) || !Array.isArray(entrada.empresas)) {
    throw new Error('Carteira inválida: esperado um objeto com "empresas": [...].');
  }

  const avisos: string[] = [];
  const empresas: EmpresaEmDia[] = [];
  entrada.empresas.forEach((bruta, indice) => {
    const identificacao = ehObjeto(bruta) && typeof bruta.cnpj === "string" && bruta.cnpj ? bruta.cnpj : `#${indice + 1}`;
    try {
      const empresa = validarEmpresa(bruta);
      if (empresa.dasPagos.length === 0 && !empresa.dataAbertura) {
        avisos.push(`Empresa ${identificacao}: dasPagos vazio e sem dataAbertura; confira se o histórico de DAS foi exportado.`);
      }
      empresas.push(empresa);
    } catch (erro) {
      avisos.push(`Empresa ${identificacao} ignorada: ${(erro as Error).message}`);
    }
  });

  const carteira: Carteira = { empresas };
  const { contador } = entrada;
  if (contador !== undefined && contador !== null) {
    if (ehObjeto(contador) && typeof contador.email === "string" && emailValido(contador.email)) {
      carteira.contador = {
        nome: typeof contador.nome === "string" ? contador.nome : "",
        email: contador.email.trim(),
        ...(typeof contador.escritorio === "string" ? { escritorio: contador.escritorio } : {}),
      };
    } else {
      avisos.push("Contador ignorado: e-mail ausente ou inválido; a fila não será enviada.");
    }
  }
  return { carteira, avisos };
}
