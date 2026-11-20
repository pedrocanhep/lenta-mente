import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const codigo = await readFile(new URL("../frontend/js/app.js", import.meta.url), "utf8");
const elementos = new Map();
const porId = id => {
    if (!elementos.has(id)) elementos.set(id, {
        value: "5", textContent: "", open: false,
        addEventListener(evento, fn) { this[evento] = fn; },
        replaceChildren() {}, close() { this.open = false; },
        setCustomValidity() {}, focus() {}, querySelector() {}
    });
    return elementos.get(id);
};
const contexto = vm.createContext({
    URLSearchParams, AbortSignal, CSS: { escape: String }, API_URL: "http://localhost:5207",
    document: { getElementById: porId, querySelectorAll: () => [], querySelector: porId },
    FormData: class { *[Symbol.iterator]() {} },
    history: { replaceState() {} },
    location: { assign: url => contexto.destino = url }
});
vm.runInContext(codigo.slice(0, codigo.lastIndexOf("\natualizarIndicadorOrdem();")), contexto);
const rodar = expressao => vm.runInContext(expressao, contexto);

const registros = Array.from({ length: 45 }, (_, i) => ({
    id: String(i).padStart(2, "0"),
    descricao: ["Zebra", "Árvore", "Arvore", "Ação", "Órgão"][i % 5],
    dataCadastro: `2026-01-${String(1 + i % 9).padStart(2, "0")}T10:00:00Z`,
    dataAtualizacao: `2026-02-${String(1 + (i * 3) % 11).padStart(2, "0")}T10:00:00Z`
})).reverse();
const chamadas = [];
let modo = "normal";
const escritas = [];
contexto.fetch = async (url, opcoes) => {
    if (opcoes.method) {
        const id = url.split("/").at(-1);
        const item = registros.find(r => r.id === id);
        escritas.push(opcoes.method);
        if (opcoes.method === "POST") registros.push({ ...registros[0], id: "novo", ...JSON.parse(opcoes.body) });
        if (opcoes.method === "PUT") Object.assign(item, JSON.parse(opcoes.body));
        if (opcoes.method === "DELETE") registros.splice(registros.indexOf(item), 1);
        return { ok: true };
    }
    const p = Object.fromEntries(new URL(url, "http://localhost").searchParams);
    chamadas.push(p);
    assert.match(url, /\/lembretes\/filtro\?/);
    const encontrados = registros.filter(r => r.descricao.includes(p.Descricao) &&
        r.dataCadastro.slice(0, 10) >= p.DataCadastroInicial &&
        r.dataAtualizacao.slice(0, 10) <= p.DataAtualizacaoFinal);
    const numeroPagina = +p.NumeroPagina;
    const tamanhoPagina = +p.TamanhoPagina;
    const inicio = (numeroPagina - 1) * tamanhoPagina;
    const lembretes = encontrados.slice(inicio, inicio + tamanhoPagina);
    if (modo === "duplicado" && numeroPagina === 2) lembretes[0] = encontrados[0];
    return { ok: true, json: async () => ({
        total: modo === "limite" ? 1001 : encontrados.length, numeroPagina, tamanhoPagina, lembretes
    }) };
};

rodar("renderizarLembretes = itens => globalThis.ids = itens.map(item => item.id).join(',')");
const campo = { DataCadastro: "dataCadastro", DataAtualizacao: "dataAtualizacao" };
for (const ordem of ["Descricao", "DataCadastro", "DataAtualizacao"]) {
    for (const direcao of ["ASC", "DESC"]) {
        const esperado = [...registros].sort((a, b) => {
            const comparacao = campo[ordem] ? Date.parse(a[campo[ordem]]) - Date.parse(b[campo[ordem]])
                : a.descricao.localeCompare(b.descricao, "pt-BR");
            return comparacao * (direcao === "ASC" ? 1 : -1) || a.id.localeCompare(b.id);
        });
        for (const pagina of [1, 2, 3, 9]) {
            await rodar(`ordem = '${ordem}'; direcao = '${direcao}'; paginaAtual = ${pagina}; filtrarLembretes()`);
            assert.equal(contexto.ids, esperado.slice((pagina - 1) * 5, pagina * 5).map(r => r.id).join(","));
        }
    }
}
assert.deepEqual(chamadas.map(p => p.NumeroPagina), ["1", "2", "3"]);
assert.ok(chamadas.every(p => p.TamanhoPagina === "20" && p.Ordem === "Descricao" && p.Direcao === "ASC"));
await rodar("tamanhoAtual = 10; paginaAtual = 2; filtrarLembretes()");
assert.equal(contexto.ids.split(",").length, 10);
assert.equal(chamadas.length, 3);
const totalFiltrado = registros.filter(r => r.descricao === "Árvore" &&
    r.dataCadastro.slice(0, 10) >= "2026-01-03" && r.dataAtualizacao.slice(0, 10) <= "2026-02-08").length;
await rodar(`filtros = { ...limitesDatas, Descricao: "Árvore", DataCadastroInicial: "2026-01-03",
    DataAtualizacaoFinal: "2026-02-08" }; filtrarLembretes()`);
assert.equal(+porId("totalRegistros").textContent.split(" ")[0], totalFiltrado);
assert.equal(chamadas.at(-1).Descricao, "Árvore");
assert.equal(chamadas.at(-1).DataCadastroInicial, "2026-01-03");
assert.equal(chamadas.at(-1).DataAtualizacaoFinal, "2026-02-08");
assert.equal(rodar("montarParametros().get('TamanhoPagina')"), "10");
assert.equal(rodar("montarParametros().get('Ordem')"), "DataAtualizacao");
assert.equal(rodar("montarParametros().get('Direcao')"), "DESC");

rodar("abrirRelatorio()");
const consultaPDF = new URL(contexto.destino, "http://localhost");
assert.equal(consultaPDF.pathname, "/relatorio.html");
assert.deepEqual([...consultaPDF.searchParams], [...rodar("montarParametros()")]);

await rodar("filtros = { Descricao: '', ...limitesDatas }; filtrarLembretes()");
rodar("executar = (_atividade, _mensagem, fn) => fn()");
const evento = { preventDefault() {} };
for (const [metodo, id] of [["POST", ""], ["PUT", "novo"], ["DELETE", "novo"]]) {
    const antes = chamadas.length;
    if (metodo === "DELETE") {
        rodar("idParaExcluir = 'novo'");
        porId("confirmacaoExclusao").open = true;
        await porId("formExclusao").submit(evento);
    } else {
        porId("formulario").open = true;
        porId("lembreteId").value = id;
        porId("descricao").value = "Descrição gravada";
        await porId("formLembrete").submit(evento);
    }
    assert.equal(escritas.at(-1), metodo);
    assert.deepEqual(chamadas.slice(antes).map(p => p.NumeroPagina), ["1", "2", "3"]);
    assert.equal(+porId("totalRegistros").textContent.split(" ")[0], metodo === "DELETE" ? 45 : 46);
}
rodar("colecaoFiltrada = undefined");
modo = "duplicado";
await rodar("filtros = { Descricao: '', ...limitesDatas }; filtrarLembretes()");
assert.match(porId("erro").textContent, /repetiu registros/);
assert.equal(rodar("carregado"), false);
modo = "limite";
const antes = chamadas.length;
await rodar("filtrarLembretes()");
assert.equal(chamadas.length, antes + 1);
assert.match(porId("erro").textContent, /mais de 1000 lembretes/);
assert.equal(rodar("carregado"), false);
console.log("Ordenação global: três lotes da API, seis ordens, acentos, datas, empates, filtros, cache, paginação e limites aprovados.");
