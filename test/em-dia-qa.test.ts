// Casos da rodada de testes por eixos (bordas, robustez, integração). Cada bug corrigido tem um caso aqui.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { filaDoContador, verificarCarteira } from "../src/carteira.ts";
import { competenciaAnterior, formatarPercentual, hojeEmBrasilia, vencimentoDas } from "../src/datas.ts";
import { provedorConsole, provedorResend } from "../src/email/provedores.ts";
import { cabecalhoDe, carregarRemetente, validarRemetente } from "../src/email/remetente.ts";
import { montarEmail, rascunhoPadrao, redigirComIa } from "../src/mensagem.ts";
import { carregarParametros, ordenar, verificarPendencias } from "../src/regras.ts";
import type { EmpresaEmDia, Pendencia } from "../src/tipos.ts";
import { validarCarteira } from "../src/validacao.ts";

const p = carregarParametros();
const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const TESTAR_REMETENTE = fileURLToPath(new URL("../src/testar-remetente.ts", import.meta.url));
const CARTEIRA = fileURLToPath(new URL("../exemplos/carteira.json", import.meta.url));

function emp(parcial: Partial<EmpresaEmDia>): EmpresaEmDia {
  return {
    cnpj: "x",
    razaoSocial: "Empresa X",
    regime: "MEI",
    contato: { nome: "Maria da Silva", email: "maria@example.com" },
    dataAbertura: "2020-01-01",
    receitas: {},
    dasPagos: [],
    ultimaDeclaracaoEntregue: 2025,
    ...parcial,
  };
}
function meses(de: string, ate: string): string[] {
  const lista: string[] = [];
  for (let c = ate; c >= de; c = competenciaAnterior(c)) lista.push(c);
  return lista.reverse();
}
const PAGOS = meses("2025-01", "2026-09");
const semSetembro = PAGOS.filter((c) => c !== "2026-09");
const pendencias = (e: EmpresaEmDia, hoje: string) => verificarPendencias(e, hoje, p);
const receitaDistribuida = (total: number, de = "2026-01", ate = "2026-09") => {
  const lista = meses(de, ate);
  return Object.fromEntries(lista.map((m) => [m, total / lista.length]));
};
const iaResponde = (resposta: unknown) => ({ beta: { messages: { async create() { return resposta as BetaMessage; } } } });
const texto = (t: string, stop = "end_turn") => ({ stop_reason: stop, content: [{ type: "text", text: t }] });
const REMETENTE_OK = {
  EM_DIA_EMAIL_PROVEDOR: "resend",
  EM_DIA_REMETENTE_EMAIL: "avisos@empresa.com.br",
  EM_DIA_LINK_DESCADASTRO: "https://empresa.com.br/sair",
  RESEND_API_KEY: "re_falsa",
};
const pastaTemporaria = () => mkdtempSync(join(tmpdir(), "em-dia-qa-"));
const rodar = (script: string, args: string[], env: Record<string, string> = {}, preload?: string) => {
  const cwd = pastaTemporaria();
  const resultado = spawnSync(process.execPath, [...(preload ? ["--import", preload] : []), script, ...args], {
    cwd,
    env: { PATH: process.env.PATH ?? "", ...env },
    encoding: "utf8",
  });
  return { ...resultado, cwd };
};

describe("bordas das regras", () => {
  it("vencimento: dezembro vira janeiro; janeiro volta para dezembro", () => {
    assert.equal(vencimentoDas("2026-12", 20), "2027-01-20");
    assert.equal(competenciaAnterior("2026-01"), "2025-12");
  });

  it("DAS: hoje e até 3 dias = alta; 4 a 10 dias = média; 11 dias = nada; dia seguinte = atrasado", () => {
    const e = emp({ dasPagos: semSetembro });
    const das = (hoje: string) => pendencias(e, hoje).filter((x) => x.codigo.startsWith("das"));
    assert.deepEqual(das("2026-10-20").map((x) => [x.codigo, x.prioridade]), [["das-a-vencer", "alta"]]);
    assert.match(das("2026-10-20")[0].titulo, /vence hoje/);
    assert.match(das("2026-10-19")[0].titulo, /vence amanhã/);
    assert.equal(das("2026-10-17")[0].prioridade, "alta");
    assert.equal(das("2026-10-16")[0].prioridade, "media");
    assert.equal(das("2026-10-10")[0].prioridade, "media");
    assert.deepEqual(das("2026-10-09"), []);
    assert.equal(das("2026-10-21")[0].codigo, "das-atrasado");
  });

  it("vencimento em domingo (20/09/2026) vai para segunda: pagar dia 21 está em dia", () => {
    assert.equal(vencimentoDas("2026-08", 20, p.feriadosNacionais), "2026-09-21");
    const r = pendencias(emp({ dasPagos: PAGOS.filter((c) => c !== "2026-08") }), "2026-09-21");
    assert.ok(!r.some((x) => x.codigo === "das-atrasado"));
  });

  it("vencimento em feriado nacional de data fixa vai para o próximo dia útil", () => {
    // 20/11/2026 (Consciência Negra) é sexta: vai para segunda, 23/11.
    assert.equal(vencimentoDas("2026-10", 20, p.feriadosNacionais), "2026-11-23");
  });

  it("abertura: neste mês não há DAS; no mês passado o DAS do mês de abertura é devido", () => {
    assert.deepEqual(pendencias(emp({ dataAbertura: "2026-10-03", ultimaDeclaracaoEntregue: null }), "2026-10-24"), []);
    const passado = pendencias(emp({ dataAbertura: "2026-09-25", ultimaDeclaracaoEntregue: null }), "2026-10-24");
    assert.deepEqual(passado.map((x) => x.titulo), ["DAS de 09/2026 em atraso"]);
  });

  it("declaração anual: ausente não é checada; null é 'nunca entregou'", () => {
    const { ultimaDeclaracaoEntregue: _, ...semDado } = emp({ dasPagos: PAGOS });
    assert.deepEqual(pendencias(semDado as EmpresaEmDia, "2026-04-15"), []);
    const nunca = pendencias(emp({ dasPagos: PAGOS, dataAbertura: "2025-03-01", ultimaDeclaracaoEntregue: null }), "2026-04-15");
    assert.ok(nunca.some((x) => x.codigo === "declaracao-anual" && /2025/.test(x.titulo)));
  });

  it("declaração anual: anos anteriores pendentes também são cobrados", () => {
    const r = pendencias(emp({ dasPagos: PAGOS, ultimaDeclaracaoEntregue: 2023 }), "2026-02-10");
    assert.ok(r.some((x) => x.codigo === "declaracao-atrasada" && /2024/.test(x.titulo)));
    assert.ok(r.some((x) => x.codigo === "declaracao-anual" && /2025/.test(x.titulo)));
  });

  it("declaração anual: no máximo 5 anos-base para trás", () => {
    const r = pendencias(emp({ dasPagos: PAGOS, dataAbertura: "2010-01-01", ultimaDeclaracaoEntregue: null }), "2026-10-24");
    assert.equal(r.filter((x) => x.codigo.startsWith("declaracao")).length, 5);
  });

  it("DASN: 31/05 vence hoje (alta), 30/05 'falta 1 dia', 01/06 atrasada", () => {
    const e = emp({ dasPagos: PAGOS, ultimaDeclaracaoEntregue: 2024 });
    assert.equal(pendencias(e, "2026-05-31")[0].prioridade, "alta");
    assert.match(pendencias(e, "2026-05-31")[0].detalhe, /termina hoje/);
    assert.match(pendencias(e, "2026-05-30")[0].detalhe, /falta 1 dia\)/);
    assert.equal(pendencias(e, "2026-06-01")[0].codigo, "declaracao-atrasada");
  });

  it("teto MEI: 79,99% nada; 80% e 100% 'perto'; até 120% 'ultrapassado'; acima 'estourado'", () => {
    const teto = (total: number, extra: Partial<EmpresaEmDia> = {}) =>
      pendencias(emp({ dasPagos: PAGOS, receitas: receitaDistribuida(total), ...extra }), "2026-10-24").find((x) => x.codigo === "teto-mei")?.titulo;
    assert.equal(teto(64799.99), undefined);
    assert.equal(teto(64800), "Perto do limite do MEI");
    assert.equal(teto(81000), "Perto do limite do MEI");
    assert.equal(teto(81000.01), "Limite do MEI ultrapassado");
    assert.equal(teto(97200), "Limite do MEI ultrapassado");
    assert.match(teto(97200.01) ?? "", /mais de 20%/);
    assert.equal(teto(64800, { dataAbertura: "2026-01-10", ultimaDeclaracaoEntregue: null }), "Perto do limite do MEI");
  });

  it("teto MEI: em janeiro avisa o estouro do ano que acabou", () => {
    const receitas = receitaDistribuida(100000, "2026-01", "2026-12");
    const r = pendencias(emp({ dasPagos: meses("2026-01", "2026-12"), receitas, ultimaDeclaracaoEntregue: 2025 }), "2027-01-15");
    assert.ok(r.some((x) => x.codigo === "teto-mei-ano-anterior" && /2026/.test(x.titulo)));
    assert.deepEqual(pendencias(emp({ dasPagos: meses("2026-01", "2026-12"), receitas, ultimaDeclaracaoEntregue: 2025 }), "2027-02-15").filter((x) => x.codigo === "teto-mei-ano-anterior"), []);
  });

  it("Simples: sublimite e limite medidos no ano-calendário, nos valores exatos", () => {
    const ano = (total: number) => receitaDistribuida(total, "2026-01", "2026-09");
    const s = (receitas: Record<string, number>, rbt12 = 0) => pendencias(emp({ regime: "SIMPLES", dasPagos: PAGOS, rbt12, receitas }), "2026-10-24").map((x) => x.titulo);
    assert.deepEqual(s({}, 2879999), []);
    assert.deepEqual(s({}, 3600000), ["Perto do sublimite de ICMS/ISS"]);
    // RBT12 acima do sublimite sem o ano ter passado: só "perto" (o limite é por ano-calendário).
    assert.deepEqual(s({}, 3600000.01), ["Perto do sublimite de ICMS/ISS"]);
    assert.deepEqual(s(ano(3600000)), ["Perto do sublimite de ICMS/ISS"]);
    assert.deepEqual(s(ano(3600009)), ["Acima do sublimite de ICMS/ISS"]);
    assert.deepEqual(s(ano(4800000)), ["Acima do sublimite de ICMS/ISS"]);
    assert.deepEqual(s(ano(4800009)), ["Faturamento acima do limite do Simples"]);
  });

  it("Simples: excesso de até 20% vale em janeiro; acima de 20%, no mês seguinte", () => {
    const detalhe = (total: number) => pendencias(emp({ regime: "SIMPLES", dasPagos: PAGOS, receitas: receitaDistribuida(total, "2026-01", "2026-09") }), "2026-10-24")[0]?.detalhe ?? "";
    assert.match(detalhe(3700008), /janeiro do ano seguinte/);
    assert.match(detalhe(4400001), /mês seguinte/);
  });

  it("LC 238/2026: limite do MEI de R$ 110 mil em 2027 e R$ 140 mil a partir de 2028", () => {
    const uso = (total: number, ano: string) =>
      pendencias(emp({ dasPagos: meses(`${ano}-01`, `${ano}-09`), receitas: receitaDistribuida(total, `${ano}-01`, `${ano}-09`), ultimaDeclaracaoEntregue: Number(ano) - 1 }), `${ano}-10-24`).find((x) => x.codigo === "teto-mei");
    assert.match(uso(90000, "2026")?.titulo ?? "", /ultrapassado/);
    assert.match(uso(90000, "2027")?.detalhe ?? "", /R\$\s110\.000,00/);
    assert.equal(uso(100000, "2028"), undefined);
  });

  it("teto MEI no ano de abertura: retroage à data de abertura", () => {
    const r = pendencias(emp({ dataAbertura: "2026-07-10", dasPagos: meses("2026-07", "2026-09"), receitas: { "2026-07": 20000, "2026-08": 20000, "2026-09": 20000 } }), "2026-10-24");
    assert.match(r.find((x) => x.codigo === "teto-mei")?.detalhe ?? "", /data de abertura \(10\/07\/2026\)/);
  });

  it("Fator R: 25% e 31% inclusive; 28% já é Anexo III; folha zero não alerta; 27,999% não vira 28,0%", () => {
    const f = (folha12: number) =>
      pendencias(emp({ regime: "SIMPLES", atividade: "servico_fator_r", rbt12: 100000, folha12, dasPagos: PAGOS }), "2026-10-24").find((x) => x.codigo === "fator-r");
    assert.equal(f(24999), undefined);
    assert.equal(f(25000)?.prioridade, "media");
    assert.equal(f(28000)?.prioridade, "baixa");
    assert.equal(f(31000)?.prioridade, "baixa");
    assert.equal(f(31001), undefined);
    assert.equal(f(0), undefined);
    assert.equal(f(27999)?.titulo, "Fator R em 27,9%, perto dos 28%");
    assert.equal(formatarPercentual(0.28), "28,0%");
  });

  it("notas: um mês no singular, vários no plural; ano anterior e mês corrente ficam de fora", () => {
    const n = (receitas: Record<string, number>) =>
      pendencias(emp({ dasPagos: PAGOS, receitas, notasRegistradas: { "2026-08": 3 } }), "2026-10-24").find((x) => x.codigo === "notas-faltando")?.detalhe;
    assert.equal(n({ "2026-08": 100, "2026-09": 100 }), "Mês com receita e nenhuma nota no Wavern: 09/2026.");
    assert.match(n({ "2026-07": 100, "2026-09": 100 }) ?? "", /^2 meses com receita/);
    assert.equal(n({ "2025-11": 100 }), undefined);
    assert.equal(n({ "2026-10": 100 }), undefined);
  });

  it("ordenar: alta com prazo, alta sem prazo, média com prazo, média sem prazo", () => {
    const x = (codigo: string, prioridade: Pendencia["prioridade"], prazo?: string): Pendencia => ({ codigo, titulo: "", detalhe: "", acao: "", prioridade, prazo });
    assert.deepEqual(ordenar([x("a", "media"), x("b", "media", "2026-11-01"), x("c", "alta"), x("d", "alta", "2020-01-01")]).map((y) => y.codigo), ["d", "c", "b", "a"]);
  });

  it("carteira vazia: fila com zero e mensagem própria", () => {
    const fila = filaDoContador(verificarCarteira({ empresas: [] }, "2026-10-24", p), "2026-10-24");
    assert.match(fila, /0 empresas · 0 pendências · 0 em dia/);
    assert.match(fila, /Nenhuma pendência na carteira\./);
  });
});

describe("validação da entrada", () => {
  for (const hoje of ["", "2026-13-01", "2026-02-30", "2026-10-24T10:00", "abc"]) {
    it(`data de hoje inválida ${JSON.stringify(hoje)} é recusada`, () => {
      assert.throws(() => pendencias(emp({ dasPagos: semSetembro }), hoje), /AAAA-MM-DD/);
    });
  }

  it("competência fora do formato em dasPagos é recusada, nunca vira DAS atrasado", () => {
    assert.throws(() => pendencias(emp({ dasPagos: [...semSetembro, "2026-9"] }), "2026-10-24"), /dasPagos/);
  });

  it("regime em minúsculas é normalizado (MEI com 90 mil recebe alerta de teto)", () => {
    const r = pendencias(emp({ regime: "mei" as EmpresaEmDia["regime"], dasPagos: PAGOS, receitas: { "2026-09": 90000 } }), "2026-10-24");
    assert.ok(r.some((x) => x.codigo === "teto-mei"));
  });

  it("carteira: empresa inválida é descartada com aviso (cnpj e campo) e as demais seguem", () => {
    const entrada = {
      empresas: [
        emp({ cnpj: "boa" }),
        { ...emp({ cnpj: "sem-contato" }), contato: undefined },
        { ...emp({ cnpj: "receita-nan" }), receitas: { "2026-09": Number.NaN } },
        { ...emp({ cnpj: "data-br" }), dataAbertura: "03/05/2022" },
      ],
      contador: { nome: "C", email: "nao-e-email" },
    };
    const { carteira, avisos } = validarCarteira(entrada);
    assert.deepEqual(carteira.empresas.map((e) => e.cnpj), ["boa"]);
    assert.ok(avisos.some((a) => a.includes("sem-contato") && a.includes("contato.email")));
    assert.ok(avisos.some((a) => a.includes("receita-nan") && a.includes("receitas.2026-09")));
    assert.ok(avisos.some((a) => a.includes("data-br") && a.includes("dataAbertura")));
    assert.equal(carteira.contador, undefined);
    assert.throws(() => validarCarteira({}), /empresas/);
  });
});

describe("e-mail e remetente", () => {
  it("escapa HTML de razão social, contato e corpo da IA", async () => {
    const e = emp({ razaoSocial: `Bar & "Cia" <script>alert(1)</script>`, contato: { nome: "<b>Zé</b>", email: "z@x.com" }, dasPagos: semSetembro });
    const pend = pendencias(e, "2026-10-24");
    const html = montarEmail(e, rascunhoPadrao(e, pend), carregarRemetente({})).html;
    assert.ok(!html.includes("<script>") && !html.includes("<b>Zé"));
    const ia = await redigirComIa(e, pend, iaResponde(texto(JSON.stringify({ assunto: "Oi", corpo: `<script>x</script> & "a"` }))), "m");
    assert.match(montarEmail(e, ia, carregarRemetente({})).html, /&lt;script&gt;x&lt;\/script&gt; &amp; &quot;a&quot;/);
  });

  it("IA: max_tokens, refusal, vazio, null, tipo errado, link no corpo ou corpo enorme caem no texto padrão", async () => {
    const e = emp({ dasPagos: semSetembro });
    const pend = pendencias(e, "2026-10-24");
    const casos = [
      texto('{"assunto":"A","corpo":"B', "max_tokens"),
      { stop_reason: "refusal", content: [] },
      texto('{"assunto":"","corpo":""}'),
      texto("null"),
      texto('{"assunto":5,"corpo":"x"}'),
      texto(JSON.stringify({ assunto: "DAS", corpo: "Pague em http://boleto-falso.example" })),
      texto(JSON.stringify({ assunto: "DAS", corpo: "x".repeat(5000) })),
    ];
    for (const resposta of casos) assert.equal((await redigirComIa(e, pend, iaResponde(resposta), "m")).origem, "modelo");
  });

  it("assunto da IA sai em uma linha e com no máximo 120 caracteres", async () => {
    const e = emp({ dasPagos: semSetembro });
    const pend = pendencias(e, "2026-10-24");
    const r = await redigirComIa(e, pend, iaResponde(texto(JSON.stringify({ assunto: `DAS\r\nBcc: x@y.com ${"a".repeat(300)}`, corpo: "ok" }))), "m");
    const { assunto } = montarEmail(e, r, carregarRemetente({}));
    assert.doesNotMatch(assunto, /[\r\n]/);
    assert.ok(assunto.length <= 120);
  });

  it("nome de contato vazio vira 'Olá!'", () => {
    const e = emp({ contato: { nome: "  ", email: "a@example.com" }, dasPagos: semSetembro });
    assert.match(rascunhoPadrao(e, pendencias(e, "2026-10-24")).corpo, /^Olá!/);
  });

  it("console não sobrescreve e-mails para o mesmo destinatário no mesmo milissegundo", async () => {
    const pasta = pastaTemporaria();
    const c = provedorConsole(carregarRemetente({}), pasta);
    await Promise.all([1, 2, 3].map((i) => c.enviar({ para: "dono@x.com", assunto: `S${i}`, texto: `T${i}`, html: "" })));
    assert.equal(readdirSync(pasta).length, 3);
  });

  it("remetente: descadastro exige https; e-mail gratuito recusado em maiúsculas e com ponto final", () => {
    for (const link of ["javascript:alert(1)", "http://x.com/s", "sair"]) {
      assert.ok(validarRemetente(carregarRemetente({ ...REMETENTE_OK, EM_DIA_LINK_DESCADASTRO: link })).length > 0, link);
    }
    for (const email of ["avisos@GMAIL.COM", "avisos@hotmail.com.br", "avisos@terra.com.br", "a@b..com"]) {
      assert.equal(validarRemetente(carregarRemetente({ ...REMETENTE_OK, EM_DIA_REMETENTE_EMAIL: email })).length, 1, email);
    }
    assert.deepEqual(validarRemetente(carregarRemetente(REMETENTE_OK)), []);
  });

  it("remetente: provedor em maiúsculas é aceito; desconhecido é erro", () => {
    assert.equal(carregarRemetente({ EM_DIA_EMAIL_PROVEDOR: "Resend" }).provedor, "resend");
    assert.throws(() => carregarRemetente({ EM_DIA_EMAIL_PROVEDOR: "sendgrid" }), /desconhecido/);
  });

  it("From com o nome entre aspas; nome com < > é recusado", () => {
    assert.equal(cabecalhoDe(carregarRemetente({ EM_DIA_REMETENTE_NOME: "Silva, Contábil", EM_DIA_REMETENTE_EMAIL: "a@b.com" })), '"Silva, Contábil" <a@b.com>');
    assert.equal(validarRemetente(carregarRemetente({ ...REMETENTE_OK, EM_DIA_REMETENTE_NOME: "X <y@z.com>" })).length, 1);
  });

  it("Resend: timeout, chave de idempotência e corpo não JSON tolerado", async () => {
    let init: RequestInit | undefined;
    const provedor = provedorResend(carregarRemetente(REMETENTE_OK), (async (_u: string, i: RequestInit) => {
      init = i;
      return new Response("ok", { status: 200 });
    }) as typeof fetch);
    assert.deepEqual(await provedor.enviar({ para: "a@b.com", assunto: "s", texto: "t", html: "h", chaveIdempotencia: "k1" }), { id: "sem-id" });
    assert.ok(init?.signal);
    assert.equal((init?.headers as Record<string, string>)["Idempotency-Key"], "k1");
  });

  it("Resend: repete em 429 e 5xx, desiste em 4xx", async () => {
    const respostas = (status: number[]) => {
      let n = 0;
      const chaves: string[] = [];
      const fetchFalso = (async (_u: string, i: RequestInit) => {
        chaves.push((i.headers as Record<string, string>)["Idempotency-Key"]);
        const codigo = status[n++] ?? 200;
        return new Response(codigo === 200 ? '{"id":"ok"}' : "erro", { status: codigo });
      }) as typeof fetch;
      return { fetchFalso, chaves, chamadas: () => n };
    };
    const semEspera = async () => {};

    const r1 = respostas([429, 500]);
    const ok = await provedorResend(carregarRemetente(REMETENTE_OK), r1.fetchFalso, { esperar: semEspera }).enviar({ para: "a@b.com", assunto: "s", texto: "t", html: "h" });
    assert.deepEqual(ok, { id: "ok" });
    assert.equal(r1.chamadas(), 3);
    assert.equal(new Set(r1.chaves).size, 1, "a mesma chave em todas as tentativas");

    const r2 = respostas([422]);
    await assert.rejects(provedorResend(carregarRemetente(REMETENTE_OK), r2.fetchFalso, { esperar: semEspera }).enviar({ para: "a@b.com", assunto: "s", texto: "t", html: "h" }), /422/);
    assert.equal(r2.chamadas(), 1);
  });

  it("fila do contador escapa '|', quebra de linha e HTML", () => {
    const fila = filaDoContador(verificarCarteira({ empresas: [emp({ razaoSocial: "A | B\nC <b>", dasPagos: semSetembro })] }, "2026-10-24", p), "2026-10-24");
    const linhas = fila.split("\n").filter((l) => l.startsWith("| 🔴"));
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0].replace(/\\\|/g, "").split("|").length, 7);
    assert.ok(!linhas[0].includes("<b>"));
  });
});

describe("CLI", () => {
  const fetchFalso = (falharNo: number) => {
    const caminho = join(pastaTemporaria(), "fetch-falso.mjs");
    writeFileSync(
      caminho,
      `let n=0;globalThis.fetch=async(u,i)=>{if(!String(u).startsWith("https://api.resend.com/"))throw new Error("rede bloqueada no teste");n++;process.stderr.write("ENVIO "+JSON.parse(i.body).to[0]+"\\n");return n===${falharNo}?new Response("erro",{status:422}):new Response(JSON.stringify({id:"f"+n}),{status:200});};`,
    );
    return caminho;
  };

  it("simulação com o exemplo: 3 e-mails, fila e registro de envios, código 0", () => {
    const r = rodar(CLI, [CARTEIRA, "--sem-ia", "--hoje", "2026-10-24"]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readdirSync(join(r.cwd, "saida")).sort(), ["emails", "envios-2026-10-24.json", "fila-2026-10-24.md"]);
    assert.equal(readdirSync(join(r.cwd, "saida", "emails")).length, 4); // 3 empresas + contador
    assert.match(r.stdout, /3 pendências → ana@example\.com/);
  });

  it("--enviar com remetente incompleto recusa antes de gravar ou enviar qualquer coisa", () => {
    const r = rodar(CLI, [CARTEIRA, "--sem-ia", "--enviar", "--hoje", "2026-10-24"], { EM_DIA_EMAIL_PROVEDOR: "resend" });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Remetente mal configurado/);
    assert.deepEqual(readdirSync(r.cwd), []);
  });

  it("--enviar com provedor console é erro, não simulação silenciosa", () => {
    const r = rodar(CLI, [CARTEIRA, "--sem-ia", "--enviar", "--hoje", "2026-10-24"]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /EM_DIA_EMAIL_PROVEDOR=resend/);
  });

  it("--enviar exige parâmetros verificados, salvo com a flag explícita", () => {
    const r = rodar(CLI, [CARTEIRA, "--sem-ia", "--enviar", "--hoje", "2026-10-24"], REMETENTE_OK, fetchFalso(0));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /verificado_em/);
    assert.doesNotMatch(r.stderr, /ENVIO/);
  });

  it("erro do Resend numa empresa não aborta as demais, grava fila e registro e sai com 1", () => {
    const r = rodar(CLI, [CARTEIRA, "--sem-ia", "--enviar", "--aceitar-parametros-nao-verificados", "--hoje", "2026-10-24"], REMETENTE_OK, fetchFalso(2));
    assert.equal(r.stderr.split("\n").filter((l) => l.startsWith("ENVIO ")).length, 4, r.stderr);
    assert.equal(r.status, 1);
    const registro = JSON.parse(readFileSync(join(r.cwd, "saida", "envios-2026-10-24.json"), "utf8")) as Array<{ situacao: string }>;
    assert.deepEqual(registro.map((x) => x.situacao).sort(), ["em-dia", "enviado", "enviado", "enviado", "falhou"]);
    assert.ok(readdirSync(join(r.cwd, "saida")).includes("fila-2026-10-24.md"));
  });

  it("--hoje inválido, arquivo inexistente e JSON inválido: mensagem clara e código 2", () => {
    for (const hoje of ["", "2026-13-01", "abc"]) {
      const r = rodar(CLI, [CARTEIRA, "--sem-ia", "--hoje", hoje]);
      assert.equal(r.status, 2, hoje);
      assert.match(r.stderr, /AAAA-MM-DD/);
    }
    const inexistente = rodar(CLI, ["/nao/existe.json", "--sem-ia"]);
    assert.equal(inexistente.status, 2);
    assert.match(inexistente.stderr, /arquivo não encontrado/);
    const pasta = pastaTemporaria();
    writeFileSync(join(pasta, "ruim.json"), "{ruim");
    const invalido = rodar(CLI, [join(pasta, "ruim.json"), "--sem-ia"]);
    assert.equal(invalido.status, 2);
    assert.match(invalido.stderr, /JSON inválido/);
  });

  it("sem chave da API: um aviso só e texto padrão, sem stack trace", () => {
    const r = rodar(CLI, [CARTEIRA, "--hoje", "2026-10-24"]);
    assert.equal(r.status, 0);
    assert.equal(r.stderr.split("\n").filter((l) => /ANTHROPIC_API_KEY/.test(l)).length, 1);
    assert.doesNotMatch(r.stderr, /at .*\.ts:\d+/);
  });

  it("testar-remetente: console diz que nada foi enviado, valida o destino e escapa a assinatura", () => {
    const env = { EM_DIA_LINK_DESCADASTRO: "https://x.com/sair", EM_DIA_ASSINATURA: "Equipe <b>X</b> & Cia" };
    const ok = rodar(TESTAR_REMETENTE, ["eu@empresa.com.br"], env);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /Nada foi enviado/);
    const arquivo = readdirSync(join(ok.cwd, "saida", "emails"))[0];
    assert.ok(arquivo);
    const ruim = rodar(TESTAR_REMETENTE, ["nao-e-email"], env);
    assert.equal(ruim.status, 1);
    assert.match(ruim.stderr, /Destino inválido/);
  });
});

describe("data padrão", () => {
  it("usa o fuso de Brasília: 20/10 às 22h30 ainda é dia 20", () => {
    assert.equal(hojeEmBrasilia(new Date("2026-10-21T01:30:00Z")), "2026-10-20");
  });
});

describe("aviso de parâmetros não verificados", () => {
  it("a fila do contador avisa quando os parâmetros não foram verificados", () => {
    const resultados = verificarCarteira({ empresas: [] }, "2026-10-24", p);
    assert.match(filaDoContador(resultados, "2026-10-24", false), /não verificados/);
    assert.doesNotMatch(filaDoContador(resultados, "2026-10-24", true), /não verificados/);
  });
});
