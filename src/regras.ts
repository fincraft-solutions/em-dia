import { readFileSync } from "node:fs";
import {
  competencia,
  competenciaAnterior,
  diasAte,
  formatarCompetencia,
  formatarData,
  formatarPercentual,
  formatarReais,
  plural,
  validarData,
  vencimentoDas,
} from "./datas.ts";
import type { EmpresaEmDia, Parametros, Pendencia, Prioridade } from "./tipos.ts";
import { validarEmpresa } from "./validacao.ts";

export function carregarParametros(): Parametros {
  return JSON.parse(readFileSync(new URL("../dados/parametros.json", import.meta.url), "utf8")) as Parametros;
}

const PESO: Record<Prioridade, number> = { alta: 0, media: 1, baixa: 2 };

export function ordenar(pendencias: Pendencia[]): Pendencia[] {
  return [...pendencias].sort(
    (a, b) => PESO[a.prioridade] - PESO[b.prioridade] || (a.prazo ?? "9999").localeCompare(b.prazo ?? "9999"),
  );
}

/** "hoje", "amanhã" ou "em N dias". */
function emDias(dias: number): string {
  if (dias === 0) return "hoje";
  if (dias === 1) return "amanhã";
  return `em ${dias} dias`;
}

function pendenciasDas(empresa: EmpresaEmDia, hoje: string, p: Parametros): Pendencia[] {
  const pendencias: Pendencia[] = [];
  const inicio = empresa.dataAbertura ? competencia(empresa.dataAbertura) : "0000-00";
  const pagos = new Set(empresa.dasPagos);

  // Olha as 12 últimas competências fechadas.
  let comp = competenciaAnterior(competencia(hoje));
  for (let i = 0; i < 12 && comp >= inicio; i++, comp = competenciaAnterior(comp)) {
    // MEI paga o valor fixo todo mês; no Simples só há DAS quando houve receita.
    const devido = empresa.regime === "MEI" || (empresa.receitas[comp] ?? 0) > 0;
    if (!devido || pagos.has(comp)) continue;

    const vencimento = vencimentoDas(comp, p.diaVencimentoDas, p.feriadosNacionais);
    const dias = diasAte(hoje, vencimento);
    if (dias < 0) {
      pendencias.push({
        codigo: "das-atrasado",
        titulo: `DAS de ${formatarCompetencia(comp)} em atraso`,
        detalhe: `Venceu em ${formatarData(vencimento)} e não consta pagamento. A multa e os juros crescem a cada dia.`,
        acao: "Emitir a guia atualizada e pagar.",
        prioridade: "alta",
        prazo: vencimento,
      });
    } else if (dias <= p.diasAvisoPrazo) {
      pendencias.push({
        codigo: "das-a-vencer",
        titulo: `DAS de ${formatarCompetencia(comp)} vence ${emDias(dias)}`,
        detalhe: `Vencimento em ${formatarData(vencimento)}.`,
        acao: "Emitir e pagar a guia até o vencimento.",
        prioridade: dias <= 3 ? "alta" : "media",
        prazo: vencimento,
      });
    }
  }
  return pendencias;
}

// Cobra no máximo os últimos 5 anos-base: mais que isso já passou da decadência e vira assunto do contador.
const ANOS_DECLARACAO = 5;

function pendenciasDeclaracaoAnual(empresa: EmpresaEmDia, hoje: string, p: Parametros): Pendencia[] {
  // Ausente = dado desconhecido: melhor não avisar do que avisar errado.
  if (empresa.ultimaDeclaracaoEntregue === undefined) return [];

  const anoBase = Number(hoje.slice(0, 4)) - 1;
  const anoAbertura = empresa.dataAbertura ? Number(empresa.dataAbertura.slice(0, 4)) : null;
  const primeiroAno = Math.max(
    empresa.ultimaDeclaracaoEntregue === null ? (anoAbertura ?? anoBase) : empresa.ultimaDeclaracaoEntregue + 1,
    anoAbertura ?? 0,
    anoBase - ANOS_DECLARACAO + 1,
  );

  const nome = empresa.regime === "MEI" ? "DASN-SIMEI" : "DEFIS";
  const pendencias: Pendencia[] = [];
  for (let ano = primeiroAno; ano <= anoBase; ano++) {
    const prazo = `${ano + 1}-${empresa.regime === "MEI" ? p.prazoDasnSimei : p.prazoDefis}`;
    const dias = diasAte(hoje, prazo);

    if (dias < 0) {
      pendencias.push({
        codigo: "declaracao-atrasada",
        titulo: `${nome} de ${ano} atrasada`,
        detalhe: `O prazo era ${formatarData(prazo)}. A entrega fora do prazo gera multa.`,
        acao: `Entregar a ${nome} de ${ano} o quanto antes.`,
        prioridade: "alta",
        prazo,
      });
      continue;
    }
    pendencias.push({
      codigo: "declaracao-anual",
      titulo: `${nome} de ${ano} pendente`,
      detalhe: dias === 0 ? `O prazo termina hoje (${formatarData(prazo)}).` : `Prazo até ${formatarData(prazo)} (${dias === 1 ? "falta 1 dia" : `faltam ${dias} dias`}).`,
      acao: `Conferir o faturamento de ${ano} e entregar a ${nome}.`,
      prioridade: dias <= 15 ? "alta" : dias <= 45 ? "media" : "baixa",
      prazo,
    });
  }
  return pendencias;
}

function receitaDoAno(empresa: EmpresaEmDia, ano: string): number {
  return Object.entries(empresa.receitas)
    .filter(([comp]) => comp.startsWith(`${ano}-`))
    .reduce((soma, [, valor]) => soma + valor, 0);
}

/** Limite do MEI no ano (tabela `limitesMei`, vale a maior chave ≤ ano) e se é o proporcional do ano de abertura. */
function limiteMei(empresa: EmpresaEmDia, ano: string, p: Parametros): { limite: number; proporcional: boolean } {
  const anos = Object.keys(p.limitesMei).map(Number).sort((a, b) => a - b);
  const vigente = p.limitesMei[String(anos.filter((inicio) => inicio <= Number(ano)).at(-1) ?? anos[0])];
  if (!empresa.dataAbertura?.startsWith(`${ano}-`)) return { limite: vigente.anual, proporcional: false };
  const meses = 13 - Number(empresa.dataAbertura.slice(5, 7));
  return { limite: Math.round(vigente.mensalProporcional * meses * 100) / 100, proporcional: true };
}

/** Acima de 20% do limite, o desenquadramento retroage ao início do ano ou, no ano de abertura, à data de abertura. */
function inicioRetroativo(empresa: EmpresaEmDia, proporcional: boolean): string {
  return proporcional && empresa.dataAbertura ? `à data de abertura (${formatarData(empresa.dataAbertura)})` : "a 1º de janeiro";
}

function pendenciasTetoMei(empresa: EmpresaEmDia, hoje: string, p: Parametros): Pendencia[] {
  const ano = hoje.slice(0, 4);
  const pendencias: Pendencia[] = [];

  // Em janeiro, o estouro do ano que acabou ainda precisa ser comunicado.
  if (hoje.slice(5, 7) === "01") {
    const anterior = String(Number(ano) - 1);
    const receita = receitaDoAno(empresa, anterior);
    const { limite, proporcional } = limiteMei(empresa, anterior, p);
    if (receita > limite) {
      const retroativo = receita > limite * 1.2;
      pendencias.push({
        codigo: "teto-mei-ano-anterior",
        titulo: `Limite do MEI ultrapassado em ${anterior}`,
        detalhe: `Faturamento de ${anterior}: ${formatarReais(receita)} (${formatarPercentual(receita / limite)} do limite de ${formatarReais(limite)}). ${
          retroativo
            ? `Acima de 20%, o desenquadramento retroage ${inicioRetroativo(empresa, proporcional)} daquele ano.`
            : "Até 20% acima, a empresa deixa de ser MEI a partir deste janeiro e paga DAS complementar sobre o excesso."
        }`,
        acao: "Comunicar o desenquadramento com o contador.",
        prioridade: "alta",
      });
    }
  }

  const acumulado = receitaDoAno(empresa, ano);
  const { limite, proporcional } = limiteMei(empresa, ano, p);
  const uso = acumulado / limite;
  if (uso < p.alertaTetoPercentual) return pendencias;

  const base = `Faturamento de ${ano} até agora: ${formatarReais(acumulado)} (${formatarPercentual(uso)} do limite de ${formatarReais(limite)}).`;
  if (uso > 1.2) {
    pendencias.push({ codigo: "teto-mei", titulo: "Limite do MEI estourado em mais de 20%", detalhe: `${base} O desenquadramento retroage ${inicioRetroativo(empresa, proporcional)}.`, acao: "Falar com o contador agora para migrar para microempresa e recalcular os tributos do ano.", prioridade: "alta" });
  } else if (uso > 1) {
    pendencias.push({ codigo: "teto-mei", titulo: "Limite do MEI ultrapassado", detalhe: `${base} Até 20% acima, a empresa deixa de ser MEI em janeiro e paga DAS complementar sobre o excesso.`, acao: "Comunicar o desenquadramento e planejar a mudança para microempresa.", prioridade: "alta" });
  } else {
    pendencias.push({ codigo: "teto-mei", titulo: "Perto do limite do MEI", detalhe: `${base} Restam ${formatarReais(limite - acumulado)} até o fim do ano.`, acao: "Acompanhar o faturamento dos próximos meses e avaliar a migração para microempresa.", prioridade: "media" });
  }
  return pendencias;
}

/** Até 20% acima do limite, o efeito vem em janeiro do ano seguinte; acima de 20%, no mês seguinte (LC 123, art. 20, §§ 1º e 1º-A). */
function efeitoDoExcesso(receita: number, limite: number): string {
  return receita > limite * 1.2 ? "a partir do mês seguinte ao do excesso" : "a partir de janeiro do ano seguinte";
}

function pendenciasLimites(empresa: EmpresaEmDia, hoje: string, p: Parametros): Pendencia[] {
  if (empresa.regime === "MEI") return pendenciasTetoMei(empresa, hoje, p);

  // Os limites do Simples são medidos no ano-calendário; o RBT12 só serve para o aviso de "perto".
  const ano = hoje.slice(0, 4);
  const doAno = receitaDoAno(empresa, ano);
  const referencia = Math.max(empresa.rbt12 ?? 0, doAno);
  if (doAno > p.limiteSimples) {
    return [{ codigo: "limite-simples", titulo: "Faturamento acima do limite do Simples", detalhe: `A receita de ${ano} (${formatarReais(doAno)}) passou ${formatarReais(p.limiteSimples)}. A exclusão do Simples vale ${efeitoDoExcesso(doAno, p.limiteSimples)}.`, acao: "Avaliar a exclusão do Simples com o contador.", prioridade: "alta" }];
  }
  if (doAno > p.sublimiteIcmsIss) {
    return [{ codigo: "sublimite", titulo: "Acima do sublimite de ICMS/ISS", detalhe: `A receita de ${ano} (${formatarReais(doAno)}) passou ${formatarReais(p.sublimiteIcmsIss)}: ICMS e ISS saem do DAS ${efeitoDoExcesso(doAno, p.sublimiteIcmsIss)}.`, acao: "Confirmar com o contador a apuração de ICMS/ISS fora do DAS.", prioridade: "alta" }];
  }
  if (referencia >= p.sublimiteIcmsIss * p.alertaTetoPercentual) {
    return [{ codigo: "sublimite", titulo: "Perto do sublimite de ICMS/ISS", detalhe: `Receita de ${formatarReais(referencia)} (${formatarPercentual(referencia / p.sublimiteIcmsIss)} de ${formatarReais(p.sublimiteIcmsIss)}), considerando o maior valor entre os últimos 12 meses e o ano de ${ano}.`, acao: "Planejar com o contador o impacto de recolher ICMS/ISS fora do DAS.", prioridade: "media" }];
  }
  return [];
}

function pendenciaFatorR(empresa: EmpresaEmDia, p: Parametros): Pendencia[] {
  if (empresa.regime !== "SIMPLES" || empresa.atividade !== "servico_fator_r") return [];
  if (!empresa.rbt12 || empresa.folha12 == null) return [];

  const fatorR = empresa.folha12 / empresa.rbt12;
  const [minimo, maximo] = p.faixaAlertaFatorR;
  if (fatorR < minimo || fatorR > maximo) return [];

  const percentual = formatarPercentual(fatorR);
  if (fatorR < p.limiteFatorR) {
    const falta = p.limiteFatorR * empresa.rbt12 - empresa.folha12;
    return [{ codigo: "fator-r", titulo: `Fator R em ${percentual}, perto dos 28%`, detalhe: `Faltam cerca de ${formatarReais(falta)} de folha (com pró-labore) nos últimos 12 meses para a empresa passar do Anexo V para o Anexo III, de alíquota menor.`, acao: "Avaliar com o contador um ajuste de pró-labore.", prioridade: "media" }];
  }
  return [{ codigo: "fator-r", titulo: `Fator R em ${percentual}, pouco acima dos 28%`, detalhe: "Uma queda na folha ou um mês de faturamento alto pode levar a empresa para o Anexo V, de alíquota maior.", acao: "Manter o pró-labore e a folha estáveis e acompanhar mês a mês.", prioridade: "baixa" }];
}

function pendenciaNotas(empresa: EmpresaEmDia, hoje: string): Pendencia[] {
  const notas = empresa.notasRegistradas;
  if (!notas) return [];
  const atual = competencia(hoje);
  const semNotas = Object.entries(empresa.receitas)
    .filter(([comp, valor]) => comp < atual && comp.startsWith(`${hoje.slice(0, 4)}-`) && valor > 0 && !((notas[comp] ?? 0) > 0))
    .map(([comp]) => comp)
    .sort()
    .map(formatarCompetencia);
  if (semNotas.length === 0) return [];
  const rotulo = semNotas.length === 1 ? "Mês com receita e nenhuma nota no Wavern" : `${plural(semNotas.length, "mês", "meses")} com receita e nenhuma nota no Wavern`;
  return [{ codigo: "notas-faltando", titulo: "Faturamento sem notas registradas", detalhe: `${rotulo}: ${semNotas.join(", ")}.`, acao: `Registrar as notas ${semNotas.length === 1 ? "desse mês" : "desses meses"} para comprovar o faturamento.`, prioridade: semNotas.length > 2 ? "media" : "baixa" }];
}

/** Valida a data e a empresa (lança erro em dado inválido) e devolve as pendências em ordem de prioridade. */
export function verificarPendencias(entrada: EmpresaEmDia, hoje: string, parametros: Parametros): Pendencia[] {
  validarData(hoje);
  const empresa = validarEmpresa(entrada);
  return ordenar([
    ...pendenciasDas(empresa, hoje, parametros),
    ...pendenciasDeclaracaoAnual(empresa, hoje, parametros),
    ...pendenciasLimites(empresa, hoje, parametros),
    ...pendenciaFatorR(empresa, parametros),
    ...pendenciaNotas(empresa, hoje),
  ]);
}
