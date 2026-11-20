// Exercita o front-end no Chrome com respostas controladas, sem usar o MySQL.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

const data = "2026-10-02T10:00:00";
const registros = Array.from({ length: 6 }, (_, i) => ({
    id: String(i), descricao: i === 0 ? "<b>Lembrete</b>" : `Tarefa ${i}`,
    dataCadastro: data, dataAtualizacao: data
}));
const chamadas = [];
let falha = false;
let dialogoNativo = false;
let falhaPDF = false;
const pdfTeste = process.env.PDF_TESTE
    ? await readFile(process.env.PDF_TESTE)
    : Buffer.from("%PDF-1.4\n%%EOF");
const app = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.writeHead(204).end();
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/lembretes")) {
        const arquivos = {
            "/": ["index.html", "text/html"],
            "/relatorio.html": ["relatorio.html", "text/html"],
            "/index.html": ["index.html", "text/html"],
            "/js/api.js": ["js/api.js", "text/javascript"],
            "/js/relatorio.js": ["js/relatorio.js", "text/javascript"],
            "/css/relatorio.css": ["css/relatorio.css", "text/css"],
            "/js/app.js": ["js/app.js", "text/javascript"],
            "/css/style.css": ["css/style.css", "text/css"],
            "/assets/logo.png": ["assets/logo.png", "image/png"],
            "/assets/caveat.ttf": ["assets/caveat.ttf", "font/ttf"]
        };
        const arquivo = arquivos[url.pathname];
        if (!arquivo) return res.writeHead(404).end();
        let corpo = await readFile(new URL(`../frontend/${arquivo[0]}`, import.meta.url));
        if (arquivo[0] === "js/api.js") {
            corpo = corpo.toString().replace("http://localhost:5207", `http://127.0.0.1:${api.address().port}`);
        }
        return res.writeHead(200, { "Content-Type": arquivo[1] }).end(corpo);
    }
    const params = Object.fromEntries(url.searchParams);
    chamadas.push({ metodo: req.method, caminho: url.pathname, params });
    const [, , id] = url.pathname.split("/");
    const json = (status, value) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(value));
    if (falha) return json(500, {});
    if (id === "imprimir") {
        if (falhaPDF) return json(503, {});
        return res.writeHead(200, { "Content-Type": "application/pdf" }).end(pdfTeste);
    }
    if (id === "filtro") {
        await new Promise(resolve => setTimeout(resolve, 100));
        const { Descricao, NumeroPagina, TamanhoPagina } = params;
        const itens = registros.filter(item => item.descricao.includes(Descricao));
        const inicio = (NumeroPagina - 1) * TamanhoPagina;
        return json(200, { total: itens.length, numeroPagina: +NumeroPagina, tamanhoPagina: +TamanhoPagina,
            lembretes: itens.slice(inicio, inicio + +TamanhoPagina) });
    }
    const indice = registros.findIndex(item => item.id === id);
    if (id && indice < 0) return json(404, {});
    if (req.method === "GET") return json(200, registros[indice]);
    if (req.method === "DELETE") {
        await new Promise(resolve => setTimeout(resolve, 250));
        registros.splice(indice, 1);
        return res.writeHead(204).end();
    }
    let corpo = "";
    for await (const chunk of req) corpo += chunk;
    const payload = JSON.parse(corpo);
    assert.deepEqual(Object.keys(payload), ["descricao"]);
    if (req.method === "POST") {
        const novo = { id: "novo", descricao: payload.descricao, dataCadastro: data, dataAtualizacao: data };
        registros.push(novo);
        return json(201, novo);
    }
    registros[indice].descricao = payload.descricao;
    return json(200, registros[indice]);
});

const api = createServer((req, res) => app.emit("request", req, res));
app.listen(0, "127.0.0.1");
api.listen(0, "127.0.0.1");
await Promise.all([once(app, "listening"), once(api, "listening")]);

const perfil = await mkdtemp(join(tmpdir(), "lenta-mente-browser-"));
const chrome = spawn(process.env.CHROME || "google-chrome", [
    "--headless", "--no-sandbox", "--disable-gpu", "--disable-background-networking", "--remote-debugging-pipe", `--user-data-dir=${perfil}`
], { stdio: ["ignore", "ignore", "inherit", "pipe", "pipe"] });
let contador = 0;
let buffer = "";
const pendentes = new Map();
const prazo = setTimeout(() => chrome.kill(), 25000);
chrome.stdio[4].setEncoding("utf8").on("data", chunk => {
    buffer += chunk;
    const partes = buffer.split("\0");
    buffer = partes.pop();
    for (const parte of partes) {
        const msg = JSON.parse(parte);
        if (msg.method === "Page.javascriptDialogOpening") {
            dialogoNativo = true;
            void cdp("Page.handleJavaScriptDialog", { accept: false }, msg.sessionId);
        }
        const pendente = pendentes.get(msg.id);
        if (!pendente) continue;
        pendentes.delete(msg.id);
        if (msg.error) pendente.reject(new Error(msg.error.message));
        else pendente.resolve(msg.result);
    }
});
chrome.stdio[3].on("error", () => {});
chrome.on("exit", code => {
    for (const item of pendentes.values()) item.reject(new Error(`Chrome encerrou (código ${code}).`));
});
function cdp(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
        const id = ++contador;
        pendentes.set(id, { resolve, reject });
        chrome.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + "\0");
    });
}

try {
    const { targetId } = await cdp("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp("Target.attachToTarget", { targetId, flatten: true });
    const pagina = (metodo, params) => cdp(metodo, params, sessionId);
    const avaliar = async expression => {
        const { result, exceptionDetails } = await pagina("Runtime.evaluate", { expression, returnByValue: true });
        assert.ok(!exceptionDetails, JSON.stringify(exceptionDetails));
        return result.value;
    };
    const aguardar = async expression => {
        for (let tentativa = 0; tentativa < 80; tentativa++) {
            if (await avaliar(expression)) return;
            await new Promise(resolve => setTimeout(resolve, 30));
        }
        assert.fail(expression);
    };
    const click = seletor => avaliar(`document.querySelector(${JSON.stringify(seletor)}).click()`);
    const valor = (seletor, texto) => avaliar(`document.querySelector(${JSON.stringify(seletor)}).value = ${JSON.stringify(texto)}`);
    const tecla = async (key, codigo, modifiers = 0, text) => {
        const campos = { key, code: key, windowsVirtualKeyCode: codigo, modifiers };
        await pagina("Input.dispatchKeyEvent", { type: "keyDown", ...campos, text });
        await pagina("Input.dispatchKeyEvent", { type: "keyUp", ...campos });
    };
    const foco = seletor => avaliar(`document.activeElement === document.querySelector(${JSON.stringify(seletor)})`);
    const pronto = () => aguardar("document.querySelector('#areaResultados')?.getAttribute('aria-busy') === 'false'");
    await pagina("Page.enable");
    await pagina("Page.navigate", { url: `http://127.0.0.1:${app.address().port}/` });
    await aguardar("document.querySelector('#carregamento')?.textContent.includes('Carregando')");
    await pronto();
    assert.equal(await avaliar("document.querySelectorAll('tbody tr').length"), 6);
    assert.equal(await avaliar("document.querySelector('td.descricao').textContent"), "<b>Lembrete</b>");
    assert.equal(await avaliar("Boolean(document.querySelector('td.descricao b'))"), false);

    await aguardar("document.querySelector('header img').naturalWidth === 1254 && document.fonts.status === 'loaded'");
    assert.equal(await avaliar("[...document.fonts].some(fonte => fonte.family === 'Caveat' && fonte.status === 'loaded')"), true);
    assert.equal(await avaliar("document.querySelector('link[rel=icon]').href.endsWith('/assets/logo.png')"), true);
    assert.equal(await avaliar("document.querySelector('#btnNovo').getAttribute('aria-label')"), "Novo lembrete");
    assert.equal(await avaliar("document.querySelector('.fab-rotulo').getBoundingClientRect().width"), 0);
    const posicaoFab = await avaliar("(() => { const r = document.querySelector('#btnNovo').getBoundingClientRect(); return { x: r.x + 25, y: r.y + 25 }; })()");
    await pagina("Input.dispatchMouseEvent", { type: "mouseMoved", ...posicaoFab });
    await aguardar("document.querySelector('.fab-rotulo').getBoundingClientRect().width > 70");
    await pagina("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
    await aguardar("document.querySelector('.fab-rotulo').getBoundingClientRect().width === 0");

    await click("#btnNovo");
    assert.equal(await foco("#descricao"), true);
    await tecla("Enter", 13, 2);
    assert.equal(chamadas.some(item => item.metodo === "POST"), false);
    await valor("#descricao", "   ");
    await tecla("Enter", 13, 2);
    assert.equal(chamadas.some(item => item.metodo === "POST"), false);
    await tecla("Escape", 27);
    await aguardar("!document.querySelector('#formulario').open");
    await aguardar("document.activeElement.id === 'btnNovo'");

    await click("#btnNovo");
    await pagina("Input.insertText", { text: "Lembrete novo" });
    await tecla("Enter", 13, 0, "\r");
    await pagina("Input.insertText", { text: "Segunda linha" });
    assert.equal(await avaliar("document.querySelector('#descricao').value"), "Lembrete novo\nSegunda linha");
    await tecla("Enter", 13, 2);
    await tecla("Enter", 13, 2);
    await pronto();
    assert.equal(chamadas.filter(item => item.metodo === "POST").length, 1);
    assert.equal(registros.at(-1).descricao, "Lembrete novo\nSegunda linha");
    assert.match(await avaliar("document.querySelector('#toast').textContent"), /cadastrado/);

    await click("tbody tr:last-child .editar");
    await pronto();
    assert.equal(await avaliar("document.querySelector('#descricao').value"), "Lembrete novo\nSegunda linha");
    assert.equal(chamadas.at(-1).caminho, "/lembretes/novo");
    await valor("#descricao", "Texto editado");
    await tecla("Enter", 13, 2);
    await pronto();
    assert.equal(registros.at(-1).descricao, "Texto editado");
    assert.equal(await foco("tbody tr:last-child .editar"), true);

    await valor("#filtroDescricao", "Tarefa");
    await valor("[name=DataCadastroInicial]", "2026-10-01");
    await valor("[name=DataAtualizacaoFinal]", "2026-10-03");
    await click("#btnFiltrar");
    await pronto();
    assert.deepEqual(chamadas.at(-1).params, {
        Descricao: "Tarefa", DataCadastroInicial: "2026-10-01", DataCadastroFinal: "9999-12-30",
        DataAtualizacaoInicial: "1000-01-01", DataAtualizacaoFinal: "2026-10-03",
        NumeroPagina: "1", TamanhoPagina: "20", Ordem: "DataCadastro", Direcao: "DESC"
    });
    await valor("[name=DataCadastroFinal]", "2026-09-30");
    await click("#btnFiltrar");
    assert.match(await avaliar("document.querySelector('#erro').textContent"), /data inicial de cadastro/);
    await click("#btnLimpar");
    await pronto();
    await avaliar("const tamanho = document.querySelector('#tamanhoPagina'); tamanho.value = '5'; tamanho.dispatchEvent(new Event('change'))");
    await pronto();
    const chamadasAntesDeOrdenar = chamadas.length;
    await click("#btnProximo");
    await pronto();
    assert.match(await avaliar("document.querySelector('#paginaAtual').textContent"), /2 de 2/);
    await click("[data-ordem=Descricao]");
    await pronto();
    await click("[data-ordem=Descricao]");
    await pronto();
    assert.equal(chamadas.length, chamadasAntesDeOrdenar);
    assert.equal(await avaliar("document.querySelector('[data-ordem=Descricao]').getAttribute('aria-pressed')"), "true");
    assert.equal(await avaliar("document.querySelector('[data-ordem=Descricao] span').textContent"), "↓");

    await pagina("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: perfil });
    const parametrosPDF = {
        ...chamadas.at(-1).params, NumeroPagina: "2", TamanhoPagina: "5", Ordem: "Descricao", Direcao: "DESC"
    };
    const filtroRascunho = "Rascunho não aplicado";
    await valor("#filtroDescricao", filtroRascunho);
    falhaPDF = true;
    await pagina("Page.addScriptToEvaluateOnNewDocument", { source: `
        if (location.pathname.endsWith("/relatorio.html")) {
            Object.defineProperty(navigator, "pdfViewerEnabled", { value: !sessionStorage.semVisualizador });
            for (const metodo of ["createObjectURL", "revokeObjectURL"]) {
                const original = URL[metodo];
                URL[metodo] = (...args) => {
                    sessionStorage[metodo] = Number(sessionStorage[metodo] || 0) + 1;
                    return original.apply(URL, args);
                };
            }
        }
    ` });
    await click("#btnImprimir");
    await aguardar("location.pathname.endsWith('/relatorio.html') && document.querySelector('#tentar')?.hidden === false");
    assert.deepEqual(chamadas.at(-1).params, parametrosPDF);
    assert.match(await avaliar("document.querySelector('#estado-relatorio').textContent"), /HTTP 503/);
    assert.equal(await avaliar("document.querySelector('#baixar').disabled && document.querySelector('#documento').hidden"), true);
    assert.equal(await avaliar("sessionStorage.getItem('createObjectURL')"), null);
    falhaPDF = false;
    await click("#tentar");
    await aguardar("document.querySelector('#documento')?.src.startsWith('blob:') && !document.querySelector('#documento').hidden");
    assert.deepEqual(chamadas.at(-1).params, parametrosPDF);
    const requisicoesPDF = () => chamadas.filter(item => item.caminho === "/lembretes/imprimir").length;
    assert.equal(requisicoesPDF(), 2);
    assert.equal(await avaliar("sessionStorage.createObjectURL"), "1");
    for (const width of [320, 1280]) {
        await pagina("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
        assert.equal(await avaliar("document.documentElement.scrollWidth <= innerWidth && document.querySelector('#documento').clientWidth > 0"), true);
    }
    await pagina("Emulation.clearDeviceMetricsOverride");
    await click("#baixar");
    const arquivoPDF = join(perfil, "relatorio-lembretes.pdf");
    let baixado;
    for (let i = 0; i < 80 && !baixado; i++) {
        baixado = await readFile(arquivoPDF).catch(erro => {
            if (erro.code !== "ENOENT") throw erro;
        });
        if (!baixado) await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.deepEqual(baixado, pdfTeste);
    assert.equal(requisicoesPDF(), 2);
    assert.equal(await avaliar("sessionStorage.createObjectURL"), "1");
    await click("#voltar");
    await pronto();
    assert.match(await avaliar("document.querySelector('#paginaAtual').textContent"), /2 de 2/);
    assert.equal(await avaliar("document.querySelector('#filtroDescricao').value"), filtroRascunho);
    assert.equal(await avaliar("sessionStorage.revokeObjectURL"), "1");

    await avaliar("sessionStorage.semVisualizador = '1'");
    await click("#btnImprimir");
    await aguardar("document.querySelector('#estado-relatorio')?.textContent.includes('visualização incorporada está indisponível')");
    assert.equal(await avaliar("document.querySelector('#documento').hidden && !document.querySelector('#baixar').disabled"), true);
    assert.deepEqual(chamadas.at(-1).params, parametrosPDF);
    await click("#voltar");
    await pronto();
    assert.equal(await avaliar("sessionStorage.revokeObjectURL"), "2");

    const excluirUltimo = "tbody tr:last-child .excluir";
    await click(excluirUltimo);
    assert.equal(await foco("#btnCancelarExclusao"), true);
    await tecla("Enter", 13, 2);
    assert.equal(chamadas.some(item => item.metodo === "DELETE"), false);
    await tecla("Escape", 27);
    await aguardar("!document.querySelector('#confirmacaoExclusao').open");
    await aguardar("document.activeElement === document.querySelector('tbody tr:last-child .excluir')");
    await click(excluirUltimo);
    await click("#btnCancelarExclusao");
    assert.equal(chamadas.some(item => item.metodo === "DELETE"), false);
    await click(excluirUltimo);
    await tecla("Tab", 9);
    assert.equal(await foco("#btnConfirmarExclusao"), true);
    await tecla("Enter", 13, 2);
    assert.equal(chamadas.some(item => item.metodo === "DELETE"), false);
    await tecla("Enter", 13, 0, "\r");
    await aguardar("document.querySelector('#btnConfirmarExclusao').disabled");
    await tecla("Escape", 27);
    assert.equal(await avaliar("document.querySelector('#confirmacaoExclusao').open"), true);
    await pronto();
    assert.equal(await foco(".tabela"), true);
    await click(excluirUltimo);
    await click("#btnConfirmarExclusao");
    await pronto();
    assert.equal(dialogoNativo, false);
    assert.equal(registros.length, 5);
    assert.match(await avaliar("document.querySelector('#paginaAtual').textContent"), /1 de 1/);
    await valor("#filtroDescricao", "sem correspondência");
    await click("#btnFiltrar");
    await pronto();
    assert.equal(await avaliar("document.querySelector('#mensagemVazia').hidden"), false);
    falha = true;
    await click("#btnImprimir");
    await aguardar("document.querySelector('#estado-relatorio')?.textContent.includes('HTTP 500')");
    await click("#voltar");
    await pronto();
    await valor("#filtroDescricao", "outro filtro");
    await click("#btnFiltrar");
    await pronto();
    assert.match(await avaliar("document.querySelector('#erro').textContent"), /HTTP 500/);

    falha = false;
    await click("#btnLimpar");
    await pronto();
    for (const width of [320, 360, 768, 1280]) {
        await pagina("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
        assert.equal(await avaliar("document.documentElement.scrollWidth <= innerWidth"), true);
        assert.equal(await avaliar("document.querySelector('.tabela').scrollWidth <= document.querySelector('.tabela').clientWidth"), true);
        assert.equal(await avaliar("(() => { const fab = document.querySelector('#btnNovo').getBoundingClientRect(); return fab.width >= 44 && fab.height >= 44 && fab.right < innerWidth && fab.bottom < innerHeight; })()"), true);
        await avaliar("window.scrollTo(0, document.documentElement.scrollHeight)");
        assert.equal(await avaliar("document.querySelector('.paginacao').getBoundingClientRect().bottom < document.querySelector('#btnNovo').getBoundingClientRect().top"), true);
        await click(excluirUltimo);
        assert.equal(await avaliar("confirmacaoExclusao.scrollWidth <= confirmacaoExclusao.clientWidth"), true);
        await tecla("Escape", 27);
        await aguardar("!document.querySelector('#confirmacaoExclusao').open");
        await click("#btnNovo");
        assert.equal(await avaliar("formulario.scrollWidth <= formulario.clientWidth"), true);
        await tecla("Escape", 27);
        await aguardar("!document.querySelector('#formulario').open");
    }
    await pagina("Emulation.setDeviceMetricsOverride", { width: 360, height: 800, deviceScaleFactor: 1, mobile: false });
    await pagina("Emulation.setTouchEmulationEnabled", { enabled: true });
    const toque = await avaliar("(() => { const r = document.querySelector('#btnNovo').getBoundingClientRect(); return { x: r.right - 22, y: r.bottom - 22 }; })()");
    await pagina("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [toque] });
    await pagina("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await aguardar("document.querySelector('#formulario').open");
    console.log("Chrome: CRUD, filtros, paginação, PDF de teste, modais, atalhos, foco, marca, fonte e botão flutuante em quatro larguras aprovados.");
} finally {
    clearTimeout(prazo);
    app.closeAllConnections();
    api.closeAllConnections();
    app.close();
    api.close();
    if (chrome.exitCode === null && chrome.signalCode === null) {
        const encerrado = once(chrome, "exit");
        chrome.kill();
        await encerrado;
    }
    await rm(perfil, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

// Verificação opcional contra a API original em execução, somente leitura.
if (process.argv.includes("--integracao")) {
    const base = "http://localhost:5207/lembretes";
    const origem = "http://127.0.0.1:8000";
    const cabecalhos = { Origin: origem };
    const geral = await fetch(base, { headers: cabecalhos });
    assert.equal(geral.status, 200);
    assert.equal(geral.headers.get("access-control-allow-origin"), "*");
    const lembretes = await geral.json();
    const consulta = new URLSearchParams({
        DataCadastroInicial: "1000-01-01", DataCadastroFinal: "9999-12-30",
        DataAtualizacaoInicial: "1000-01-01", DataAtualizacaoFinal: "9999-12-30",
        Descricao: "", NumeroPagina: "1", TamanhoPagina: "5", Ordem: "DataCadastro", Direcao: "DESC"
    });
    const consultaSemFiltros = new URLSearchParams(consulta);
    const lista = await fetch(`${base}/filtro?${consulta}`, { headers: cabecalhos });
    assert.equal(lista.status, 200);
    const paginaReal = await lista.json();
    assert.equal(paginaReal.numeroPagina, 1);
    assert.equal(paginaReal.tamanhoPagina, 5);
    assert.ok(paginaReal.lembretes.length <= 5);
    if (lembretes.length) {
        const registro = lembretes[0];
        const detalhe = await fetch(`${base}/${registro.id}`, { headers: cabecalhos });
        assert.equal(detalhe.status, 200);
        assert.equal((await detalhe.json()).id, registro.id);
        consulta.set("Descricao", registro.descricao);
        consulta.set("DataCadastroInicial", registro.dataCadastro.slice(0, 10));
        consulta.set("DataCadastroFinal", registro.dataCadastro.slice(0, 10));
        consulta.set("DataAtualizacaoInicial", registro.dataAtualizacao.slice(0, 10));
        consulta.set("DataAtualizacaoFinal", registro.dataAtualizacao.slice(0, 10));
        const filtrado = await fetch(`${base}/filtro?${consulta}`, { headers: cabecalhos });
        assert.equal(filtrado.status, 200);
        assert.ok((await filtrado.json()).total >= 1);
    }

    const preflight = await fetch(base, { method: "OPTIONS", headers: {
        Origin: origem, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"
    } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
    console.log(`API original: listagem, paginação e preflight aprovados. ${lembretes.length ? "Consulta por ID e filtros combinados aprovados." : "Banco vazio para consulta por ID e filtros combinados."}`);
    const consultaVazia = new URLSearchParams(consultaSemFiltros);
    consultaVazia.set("Descricao", crypto.randomUUID());
    const listaVazia = await fetch(`${base}/filtro?${consultaVazia}`, { headers: cabecalhos });
    assert.equal(listaVazia.status, 200);
    assert.equal((await listaVazia.json()).total, 0);

    const respostasPDF = await Promise.all([consulta, consultaSemFiltros, consultaVazia].map(async params => {
        const resposta = await fetch(`${base}/imprimir?${params}`, { headers: cabecalhos });
        if (!resposta.ok) {
            const corpo = await resposta.text();
            const diagnostico = corpo.split("\n")
                .filter(linha => /^(?:[A-Za-z][\w.]+Exception:|\s+at .*Program\.cs:line)/.test(linha))
                .slice(0, 5).join("\n");
            if (diagnostico) console.error(diagnostico);
            return `HTTP ${resposta.status}`;
        }
        assert.equal(resposta.headers.get("content-type"), "application/pdf");
        assert.equal(await (await resposta.blob()).slice(0, 5).text(), "%PDF-");
        return "PDF válido";
    }));
    console.log(`API original, PDF com filtros, sem filtros e com lista vazia: ${respostasPDF.join(" / ")}.`);
    assert.deepEqual(respostasPDF, ["PDF válido", "PDF válido", "PDF válido"]);

}
