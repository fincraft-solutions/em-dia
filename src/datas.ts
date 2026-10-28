// Datas como texto AAAA-MM-DD e contas em UTC, para não depender do fuso do servidor.

const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/;
const FORMATO_COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;

export function paraData(texto: string): Date {
  const [ano, mes, dia] = texto.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia ?? 1));
}

export function paraTexto(data: Date): string {
  return data.toISOString().slice(0, 10);
}

/** Data AAAA-MM-DD que existe no calendário (recusa 2026-02-30 e 2026-13-01). */
export function ehData(texto: unknown): texto is string {
  return typeof texto === "string" && FORMATO_DATA.test(texto) && paraTexto(paraData(texto)) === texto;
}

export function ehCompetencia(texto: unknown): texto is string {
  return typeof texto === "string" && FORMATO_COMPETENCIA.test(texto);
}

/** Devolve a data se for AAAA-MM-DD válida; senão lança erro com o nome do campo. */
export function validarData(texto: unknown, campo = "hoje"): string {
  if (!ehData(texto)) throw new Error(`Data inválida em ${campo}: ${JSON.stringify(texto)}. Use AAAA-MM-DD.`);
  return texto;
}

/** Data de hoje no fuso de Brasília, para o dia não virar depois das 21h. */
export function hojeEmBrasilia(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora);
}

export function diasAte(hoje: string, prazo: string): number {
  return Math.round((paraData(prazo).getTime() - paraData(hoje).getTime()) / 86_400_000);
}

export function competencia(data: string): string {
  return data.slice(0, 7);
}

/** Competência anterior a uma competência AAAA-MM. */
export function competenciaAnterior(atual: string): string {
  const data = paraData(`${atual}-01`);
  data.setUTCMonth(data.getUTCMonth() - 1);
  return paraTexto(data).slice(0, 7);
}

/** Sábado, domingo ou feriado nacional de data fixa (MM-DD). */
export function ehDiaUtil(data: string, feriados: string[] = []): boolean {
  const diaSemana = paraData(data).getUTCDay();
  return diaSemana !== 0 && diaSemana !== 6 && !feriados.includes(data.slice(5));
}

/** Próximo dia útil a partir da data (a própria data, se já for útil). */
export function proximoDiaUtil(data: string, feriados: string[] = []): string {
  const atual = paraData(data);
  while (!ehDiaUtil(paraTexto(atual), feriados)) atual.setUTCDate(atual.getUTCDate() + 1);
  return paraTexto(atual);
}

/**
 * Vencimento do DAS de uma competência: dia fixo do mês seguinte, prorrogado para o
 * próximo dia útil quando cai em fim de semana ou feriado da lista.
 */
export function vencimentoDas(comp: string, dia: number, feriados: string[] = []): string {
  const data = paraData(`${comp}-01`);
  data.setUTCMonth(data.getUTCMonth() + 1);
  data.setUTCDate(dia);
  return proximoDiaUtil(paraTexto(data), feriados);
}

export function formatarData(texto: string): string {
  const [ano, mes, dia] = texto.split("-");
  return `${dia}/${mes}/${ano}`;
}

/** AAAA-MM → MM/AAAA. */
export function formatarCompetencia(comp: string): string {
  const [ano, mes] = comp.split("-");
  return `${mes}/${ano}`;
}

export function formatarReais(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Percentual truncado em uma casa, para 27,999% nunca aparecer como 28,0%. */
export function formatarPercentual(fracao: number): string {
  return `${(Math.floor(Math.round(fracao * 1e6) / 1000) / 10).toFixed(1).replace(".", ",")}%`;
}

/** "1 empresa", "2 empresas". */
export function plural(quantidade: number, singular: string, pluralForma = `${singular}s`): string {
  return `${quantidade} ${quantidade === 1 ? singular : pluralForma}`;
}
