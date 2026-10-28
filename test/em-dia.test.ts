import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { BetaMessage, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { filaDoContador, verificarCarteira } from "../src/carteira.ts";
import { vencimentoDas } from "../src/datas.ts";
import { criarProvedor, provedorConsole, provedorResend } from "../src/email/provedores.ts";
import { carregarRemetente, validarRemetente } from "../src/email/remetente.ts";
import { montarEmail, montarRequisicaoMensagem, rascunhoPadrao, redigirComIa } from "../src/mensagem.ts";
import { carregarParametros, verificarPendencias } from "../src/regras.ts";
import type { Carteira, EmpresaEmDia } from "../src/tipos.ts";

const parametros = carregarParametros();
const carteira = JSON.parse(readFileSync(new URL("../exemplos/carteira.json", import.meta.url), "utf8")) as Carteira;
const HOJE = "2026-10-24";

function empresa(parcial: Partial<EmpresaEmDia>): EmpresaEmDia {
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

const todosPagos = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];

describe("regras", () => {
  it("vencimento do DAS é dia 20 do mês seguinte", () => {
    assert.equal(vencimentoDas("2026-12", 20), "2027-01-20");
  });

  it("DAS não pago e vencido é prioridade alta", () => {
    const pendencias = verificarPendencias(empresa({ dasPagos: todosPagos.slice(0, -1) }), HOJE, parametros);
    assert.equal(pendencias[0].codigo, "das-atrasado");
    assert.equal(pendencias[0].prioridade, "alta");
  });

  it("avisa o DAS que vence nos próximos dias", () => {
    const pendencias = verificarPendencias(empresa({ dasPagos: todosPagos.slice(0, -1) }), "2026-10-15", parametros);
    assert.deepEqual(pendencias.map((p) => p.codigo), ["das-a-vencer"]);
  });

  it("empresa em dia não gera pendência", () => {
    assert.deepEqual(verificarPendencias(empresa({ dasPagos: todosPagos }), HOJE, parametros), []);
  });

  it("MEI aberto no ano usa o limite proporcional", () => {
    const aberta = empresa({ dataAbertura: "2026-07-01", dasPagos: ["2026-07", "2026-08", "2026-09"], receitas: { "2026-07": 12000, "2026-08": 12000, "2026-09": 12000 } });
    // Julho a dezembro: 6 × 6.750 = 40.500; 36.000 = 89%
    const teto = verificarPendencias(aberta, HOJE, parametros).find((p) => p.codigo === "teto-mei");
    assert.equal(teto?.titulo, "Perto do limite do MEI");
  });

  it("MEI acima de 120% do limite é alerta de retroatividade", () => {
    const receitas = Object.fromEntries(todosPagos.filter((c) => c.startsWith("2026")).map((c) => [c, 11000]));
    const teto = verificarPendencias(empresa({ dasPagos: todosPagos, receitas }), HOJE, parametros).find((p) => p.codigo === "teto-mei");
    assert.match(teto?.titulo ?? "", /mais de 20%/);
  });

  it("DASN-SIMEI pendente antes do prazo e atrasada depois", () => {
    const pendente = verificarPendencias(empresa({ dasPagos: todosPagos, ultimaDeclaracaoEntregue: 2024 }), "2026-05-20", parametros);
    assert.ok(pendente.some((p) => p.codigo === "declaracao-anual" && p.prioridade === "alta"));
    const atrasada = verificarPendencias(empresa({ dasPagos: todosPagos, ultimaDeclaracaoEntregue: 2024 }), HOJE, parametros);
    assert.ok(atrasada.some((p) => p.codigo === "declaracao-atrasada"));
  });

  it("Fator R perto dos 28% calcula quanto falta de folha", () => {
    const servico = empresa({ regime: "SIMPLES", atividade: "servico_fator_r", rbt12: 100000, folha12: 26000, dasPagos: todosPagos });
    const fator = verificarPendencias(servico, HOJE, parametros).find((p) => p.codigo === "fator-r");
    assert.match(fator?.detalhe ?? "", /R\$\s2\.000,00/);
  });
});

describe("carteira do contador", () => {
  it("ordena a fila pelas prioridades e conta quem está em dia", () => {
    const resultados = verificarCarteira(carteira, HOJE, parametros);
    const fila = filaDoContador(resultados, HOJE);
    assert.match(fila, /4 empresas · 7 pendências · 1 em dia/);
    const linhas = fila.split("\n").filter((linha) => linha.startsWith("| 🔴") || linha.startsWith("| 🟡") || linha.startsWith("| ⚪"));
    assert.ok(linhas[0].startsWith("| 🔴"));
    assert.ok(linhas.at(-1)!.startsWith("| ⚪"));
  });
});

describe("remetente", () => {
  const completo = {
    EM_DIA_EMAIL_PROVEDOR: "resend",
    EM_DIA_REMETENTE_EMAIL: "avisos@wavern.com.br",
    EM_DIA_LINK_DESCADASTRO: "https://wavern.com.br/descadastro",
    RESEND_API_KEY: "re_teste",
  };

  it("console não exige configuração", () => {
    assert.deepEqual(validarRemetente(carregarRemetente({})), []);
  });

  it("envio real exige domínio próprio, descadastro e chave", () => {
    assert.deepEqual(validarRemetente(carregarRemetente(completo)), []);
    const erros = validarRemetente(carregarRemetente({ EM_DIA_EMAIL_PROVEDOR: "resend", EM_DIA_REMETENTE_EMAIL: "fulano@gmail.com" }));
    assert.equal(erros.length, 3);
    assert.throws(() => criarProvedor(carregarRemetente({ EM_DIA_EMAIL_PROVEDOR: "resend" })), /configurar-remetente/);
  });

  it("Resend recebe remetente, resposta e cabeçalho de descadastro", async () => {
    const chamadas: Array<{ url: string; corpo: Record<string, unknown> }> = [];
    const fetchFalso = (async (url: string, init: RequestInit) => {
      chamadas.push({ url, corpo: JSON.parse(init.body as string) });
      return new Response(JSON.stringify({ id: "abc" }), { status: 200 });
    }) as typeof fetch;
    const config = carregarRemetente({ ...completo, EM_DIA_RESPONDER_PARA: "contato@wavern.com.br" });
    const { id } = await provedorResend(config, fetchFalso).enviar({ para: "a@example.com", assunto: "S", texto: "T", html: "<p>T</p>" });
    assert.equal(id, "abc");
    assert.equal(chamadas[0].corpo.from, '"Wavern" <avisos@wavern.com.br>');
    assert.equal(chamadas[0].corpo.reply_to, "contato@wavern.com.br");
    assert.deepEqual(chamadas[0].corpo.headers, {
      "List-Unsubscribe": "<https://wavern.com.br/descadastro>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("console grava o e-mail em arquivo", async () => {
    const pasta = mkdtempSync(join(tmpdir(), "em-dia-"));
    await provedorConsole(carregarRemetente({}), pasta).enviar({ para: "a@example.com", assunto: "S", texto: "T", html: "" });
    assert.equal(readdirSync(pasta).length, 1);
  });
});

describe("mensagem", () => {
  const comPendencia = empresa({ dasPagos: todosPagos.slice(0, -1) });
  const pendencias = verificarPendencias(comPendencia, HOJE, parametros);

  it("texto padrão cumprimenta pelo primeiro nome e lista as pendências", () => {
    const rascunho = rascunhoPadrao(comPendencia, pendencias);
    assert.match(rascunho.corpo, /^Olá, Maria!/);
    assert.match(rascunho.corpo, /- DAS de 09\/2026 em atraso/);
  });

  it("e-mail final leva assinatura e descadastro e escapa o HTML", () => {
    const remetente = carregarRemetente({ EM_DIA_LINK_DESCADASTRO: "https://x/sair", EM_DIA_ASSINATURA: "Escritório <Teste>" });
    const email = montarEmail(comPendencia, { assunto: "A", corpo: "Oi", origem: "modelo" }, remetente);
    assert.match(email.texto, /Escritório <Teste>\n\nNão quer mais receber/);
    assert.match(email.html, /Escritório &lt;Teste&gt;/);
  });

  it("usa a redação da IA e cai no texto padrão se a resposta vier quebrada", async () => {
    const responde = (texto: string) => ({
      beta: {
        messages: {
          async create(_params: MessageCreateParamsNonStreaming) {
            return { model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: texto }] } as unknown as BetaMessage;
          },
        },
      },
    });
    const ia = await redigirComIa(comPendencia, pendencias, responde('{"assunto":"Seu DAS venceu","corpo":"Olá, Maria."}'), "claude-opus-5-5");
    assert.equal(ia.origem, "ia");
    const quebrada = await redigirComIa(comPendencia, pendencias, responde("não é json"), "claude-opus-5-5");
    assert.equal(quebrada.origem, "modelo");
  });

  it("pede JSON estruturado e liga o fallback só onde existe", () => {
    const requisicao = montarRequisicaoMensagem(comPendencia, pendencias, "claude-opus-5-5");
    assert.equal(requisicao.output_config?.format?.type, "json_schema");
    assert.equal(requisicao.fallbacks, "default");
    assert.equal(montarRequisicaoMensagem(comPendencia, pendencias, "claude-haiku-5-5").fallbacks, undefined);
  });
});
