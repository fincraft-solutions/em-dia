/** Contrato de entrada. Veja a skill conectar-dados para mapear as tabelas do Wavern para este formato. */
export interface EmpresaEmDia {
  cnpj: string;
  razaoSocial: string;
  regime: "MEI" | "SIMPLES";
  contato: { nome: string; email: string };
  /** AAAA-MM-DD. Usada no limite proporcional do MEI. */
  dataAbertura?: string | null;
  /** Receita por competência (AAAA-MM). Basta o ano corrente e o anterior. */
  receitas: Record<string, number>;
  /** Competências (AAAA-MM) com DAS pago. */
  dasPagos: string[];
  /** Quantidade de notas registradas por competência. Ausente = não checar notas. */
  notasRegistradas?: Record<string, number>;
  /**
   * Último ano-calendário cuja declaração anual (DASN-SIMEI ou DEFIS) já foi entregue.
   * Ausente = dado desconhecido, a declaração não é checada. null = nunca entregou.
   */
  ultimaDeclaracaoEntregue?: number | null;
  /** Simples: receita e folha dos últimos 12 meses (o motor do Wavern já calcula). */
  rbt12?: number;
  folha12?: number;
  /** servico_fator_r = atividade do Anexo V que pode ir ao III pelo Fator R. */
  atividade?: "comercio" | "servico_fator_r" | "servico_anexo_iii" | "outra";
}

export interface Carteira {
  contador?: { nome: string; email: string; escritorio?: string };
  empresas: EmpresaEmDia[];
}

export type Prioridade = "alta" | "media" | "baixa";

export interface Pendencia {
  codigo: string;
  titulo: string;
  detalhe: string;
  acao: string;
  prioridade: Prioridade;
  /** AAAA-MM-DD, quando a pendência tem data. */
  prazo?: string;
}

export interface Parametros {
  verificado_em: string | null;
  diaVencimentoDas: number;
  /** Feriados nacionais de data fixa (MM-DD); o vencimento do DAS vai para o próximo dia útil. */
  feriadosNacionais: string[];
  prazoDasnSimei: string;
  prazoDefis: string;
  /** Limite do MEI por ano-calendário: vale a maior chave menor ou igual ao ano. */
  limitesMei: Record<string, { anual: number; mensalProporcional: number }>;
  sublimiteIcmsIss: number;
  limiteSimples: number;
  limiteFatorR: number;
  faixaAlertaFatorR: [number, number];
  alertaTetoPercentual: number;
  diasAvisoPrazo: number;
}
