import { formatarData, plural } from "./datas.ts";
import { verificarPendencias } from "./regras.ts";
import type { Carteira, EmpresaEmDia, Parametros, Pendencia } from "./tipos.ts";

export interface ResultadoEmpresa {
  empresa: EmpresaEmDia;
  pendencias: Pendencia[];
}

const ROTULO = { alta: "🔴 Alta", media: "🟡 Média", baixa: "⚪ Baixa" } as const;

/** Célula de tabela Markdown: sem quebra de linha, sem `|` cru e sem HTML. */
function celula(texto: string): string {
  return texto.replace(/[\r\n]+/g, " ").replace(/\|/g, "\\|").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function verificarCarteira(carteira: Carteira, hoje: string, parametros: Parametros): ResultadoEmpresa[] {
  const resultados = carteira.empresas.map((empresa) => ({ empresa, pendencias: verificarPendencias(empresa, hoje, parametros) }));
  // Primeiro quem tem mais pendências altas; depois o total.
  const altas = (resultado: ResultadoEmpresa) => resultado.pendencias.filter((p) => p.prioridade === "alta").length;
  return resultados.sort((a, b) => altas(b) - altas(a) || b.pendencias.length - a.pendencias.length);
}

/** Fila priorizada para o contador: uma linha por pendência, das mais urgentes para as menos. */
export function filaDoContador(resultados: ResultadoEmpresa[], hoje: string, parametrosVerificados = true): string {
  const linhas = resultados.flatMap(({ empresa, pendencias }) =>
    pendencias.map((pendencia) => ({ empresa, pendencia })),
  );
  const ordem = { alta: 0, media: 1, baixa: 2 };
  linhas.sort((a, b) => ordem[a.pendencia.prioridade] - ordem[b.pendencia.prioridade] || (a.pendencia.prazo ?? "9999").localeCompare(b.pendencia.prazo ?? "9999"));

  const empresasEmDia = resultados.filter((resultado) => resultado.pendencias.length === 0).length;
  const saida = [
    `# Em Dia — fila da carteira em ${formatarData(hoje)}`,
    "",
    `${plural(resultados.length, "empresa")} · ${plural(linhas.length, "pendência")} · ${empresasEmDia} em dia`,
    "",
    ...(parametrosVerificados ? [] : ["> ⚠ Prazos e limites ainda não verificados (dados/parametros.json): confira antes de agir.", ""]),
  ];
  if (linhas.length === 0) return [...saida, "Nenhuma pendência na carteira."].join("\n");

  saida.push("| Prioridade | Empresa | Pendência | Prazo | Ação |", "|---|---|---|---|---|");
  for (const { empresa, pendencia } of linhas) {
    const celulas = [ROTULO[pendencia.prioridade], empresa.razaoSocial, pendencia.titulo, pendencia.prazo ? formatarData(pendencia.prazo) : "—", pendencia.acao];
    saida.push(`| ${celulas.map(celula).join(" | ")} |`);
  }
  return saida.join("\n");
}
