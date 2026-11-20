const porId = id => document.getElementById(id);
const formulario = porId("formulario");
const formLembrete = porId("formLembrete");
const confirmacaoExclusao = porId("confirmacaoExclusao");
const btnSalvar = porId("btnSalvar");
let idParaExcluir;
const formFiltros = porId("formFiltros");
const descricao = porId("descricao");
const listaLembretes = porId("listaLembretes");
const tamanhoPagina = porId("tamanhoPagina");
const btnAnterior = porId("btnAnterior");
const btnProximo = porId("btnProximo");
const btnImprimir = porId("btnImprimir");
const botoesOrdem = [...document.querySelectorAll("[data-ordem]")];
const formatoData = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

const limitesDatas = {
    DataCadastroInicial: "1000-01-01",
    DataCadastroFinal: "9999-12-30",
    DataAtualizacaoInicial: "1000-01-01",
    DataAtualizacaoFinal: "9999-12-30"
};
let filtros = { Descricao: "", ...limitesDatas };
let paginaAtual = 1;
let total = 0;
let tamanhoAtual = Number(tamanhoPagina.value);
let ordem = "DataCadastro";
let direcao = "DESC";
let carregado = false;
let ocupado = false;
let colecaoFiltrada;
const tamanhoLote = 20;
const limiteOrdenacao = 1000;
const compararDescricao = new Intl.Collator("pt-BR", { sensitivity: "variant" }).compare;

function ordenarLembretes(lembretes) {
    const fator = direcao === "DESC" ? -1 : 1;
    const camposData = { DataCadastro: "dataCadastro", DataAtualizacao: "dataAtualizacao" };
    const campoData = camposData[ordem];
    return lembretes.map(lembrete => ({
        lembrete,
        chave: campoData ? Date.parse(lembrete[campoData]) : lembrete.descricao
    })).sort((a, b) => {
        const comparacao = campoData ? a.chave - b.chave : compararDescricao(a.chave, b.chave);
        if (comparacao) return comparacao * fator;
        return a.lembrete.id < b.lembrete.id ? -1 : a.lembrete.id > b.lembrete.id ? 1 : 0;
    }).map(({ lembrete }) => lembrete);
}

function montarParametros(numero = paginaAtual, tamanho = tamanhoAtual) {
    return new URLSearchParams({
        ...filtros,
        NumeroPagina: numero,
        TamanhoPagina: tamanho,
        Ordem: ordem,
        Direcao: direcao
    });
}

async function requisitar(caminho, opcoes) {
    let resposta;
    try {
        resposta = await fetch(`${API_URL}/lembretes${caminho}`, {
            signal: AbortSignal.timeout(15000),
            ...opcoes
        });
    } catch (erro) {
        if (erro.name === "TimeoutError") throw new Error("O servidor demorou para responder.");
        throw new Error("Não foi possível conectar ao servidor. Verifique se a API está em execução.");
    }

    if (resposta.status === 404) throw new Error("Lembrete não encontrado.");
    if (!resposta.ok) throw new Error(`O servidor retornou um erro (HTTP ${resposta.status}).`);
    return resposta;
}

function ultimaPagina() {
    return Math.max(1, Math.ceil(total / tamanhoAtual));
}

function atualizarControles() {
    for (const controle of formFiltros.elements) controle.disabled = ocupado;
    for (const botao of document.querySelectorAll(".ordenar, .linha button, #btnNovo, #btnSalvar, #btnCancelar, #btnCancelarExclusao, #btnConfirmarExclusao")) {
        botao.disabled = ocupado;
    }
    btnAnterior.disabled = ocupado || !carregado || paginaAtual <= 1;
    btnProximo.disabled = ocupado || !carregado || paginaAtual >= ultimaPagina();
    btnImprimir.disabled = ocupado || !carregado;
    descricao.readOnly = ocupado;
}

function atualizarIndicadorOrdem() {
    for (const botao of botoesOrdem) {
        const selecionado = botao.dataset.ordem === ordem;
        botao.setAttribute("aria-pressed", selecionado);
        botao.querySelector("span").textContent = selecionado ? (direcao === "ASC" ? "↑" : "↓") : "↕";
        const nome = botao.firstChild.textContent.trim();
        botao.setAttribute("aria-label", selecionado
            ? `${nome}, ordem ${direcao === "ASC" ? "crescente" : "decrescente"}`
            : nome);
    }
}

async function executar(atividade, mensagem, operacao, destino = porId("erro")) {
    if (ocupado) return;
    ocupado = true;
    porId("erro").textContent = "";
    porId("erroFormulario").textContent = "";
    porId("toast").textContent = "";
    const status = formulario.open ? porId("atividadeFormulario")
        : confirmacaoExclusao.open ? porId("atividadeExclusao") : porId("carregamento");
    status.textContent = atividade;
    const area = porId("areaResultados");
    area.setAttribute("aria-busy", "true");
    atualizarControles();

    try {
        await operacao();
    } catch (erro) {
        destino.textContent = `${mensagem} ${erro.message}`;
    } finally {
        ocupado = false;
        area.setAttribute("aria-busy", "false");
        status.textContent = "";
        atualizarControles();
    }
}

// GET /lembretes/filtro
async function filtrarLembretes() {
    carregado = false;
    listaLembretes.replaceChildren();
    porId("mensagemVazia").hidden = true;
    porId("totalRegistros").textContent = "—";
    porId("paginaAtual").textContent = "Página —";

    try {
        const lembretes = ordenarLembretes(await obterConjuntoFiltrado());
        total = lembretes.length;
        paginaAtual = Math.min(paginaAtual, ultimaPagina());
        const inicio = (paginaAtual - 1) * tamanhoAtual;
        renderizarLembretes(lembretes.slice(inicio, inicio + tamanhoAtual));
        porId("totalRegistros").textContent = `${total} ${total === 1 ? "registro" : "registros"}`;
        porId("paginaAtual").textContent = `Página ${paginaAtual} de ${ultimaPagina()}`;
        carregado = true;
    } catch (erro) {
        porId("erro").textContent = `Não foi possível carregar os lembretes. ${erro.message}`;
    }
}

async function obterConjuntoFiltrado() {
    const chave = JSON.stringify(filtros);
    if (colecaoFiltrada?.chave === chave) return colecaoFiltrada.lembretes;

    const prazo = AbortSignal.timeout(30000);
    const primeira = await obterPagina(1, prazo);
    if (primeira.total > limiteOrdenacao) {
        throw new Error(`Há mais de ${limiteOrdenacao} lembretes. Aplique filtros mais específicos para ordenar a lista completa.`);
    }

    const porIdLembrete = new Map();
    const paginas = Math.ceil(primeira.total / tamanhoLote);
    for (let numero = 1; numero <= Math.max(1, paginas); numero++) {
        const pagina = numero === 1 ? primeira : await obterPagina(numero, prazo);
        const quantidade = Math.min(tamanhoLote, primeira.total - (numero - 1) * tamanhoLote);
        if (pagina.total !== primeira.total || pagina.lembretes.length !== quantidade) {
            throw new Error("Os resultados mudaram durante a coleta. Aplique os filtros novamente.");
        }
        for (const lembrete of pagina.lembretes) porIdLembrete.set(lembrete.id, lembrete);
    }
    if (porIdLembrete.size !== primeira.total) {
        throw new Error("A API repetiu registros entre páginas. Aplique os filtros novamente para tentar carregar a lista completa.");
    }

    const lembretes = [...porIdLembrete.values()];
    colecaoFiltrada = { chave, lembretes };
    return lembretes;
}

async function obterPagina(numero, prazo) {
    const resposta = await requisitar(`/filtro?${montarParametros(numero, tamanhoLote)}`, {
        signal: AbortSignal.any([prazo, AbortSignal.timeout(15000)])
    });
    const resultado = await resposta.json().catch(() => null);
    if (!resultado || !Array.isArray(resultado.lembretes) ||
        !Number.isSafeInteger(resultado.total) || resultado.total < 0 ||
        resultado.numeroPagina !== numero || resultado.tamanhoPagina !== tamanhoLote ||
        resultado.lembretes.some(item => typeof item?.id !== "string" ||
            typeof item.descricao !== "string" || !Number.isFinite(Date.parse(item.dataCadastro)) ||
            !Number.isFinite(Date.parse(item.dataAtualizacao)))) {
        throw new Error("A API enviou uma listagem inválida.");
    }
    return resultado;
}

function recarregar() {
    return executar("Carregando lembretes…", "Falha ao carregar a listagem.", filtrarLembretes);
}

function abrirRelatorio() {
    history.replaceState({
        ...history.state,
        listagem: {
            filtros, paginaAtual, tamanhoAtual, ordem, direcao,
            campos: Object.fromEntries(new FormData(formFiltros))
        }
    }, "");
    location.assign(`relatorio.html?${montarParametros()}`);
}

function abrirModal(dialogo, origem) {
    origem.focus();
    dialogo.showModal();
    dialogo.addEventListener("close", () => {
        if (!ocupado) origem.focus();
    }, { once: true });
}

function abrirFormulario(origem, lembrete = null) {
    porId("lembreteId").value = lembrete?.id ?? "";
    descricao.value = lembrete?.descricao ?? "";
    descricao.setCustomValidity("");
    porId("erroFormulario").textContent = "";
    porId("tituloFormulario").textContent = lembrete ? "Editar lembrete" : "Novo lembrete";
    abrirModal(formulario, origem);
}

// GET /lembretes/{id}
async function buscarLembrete(id, origem) {
    await executar("Consultando lembrete…", "Não foi possível abrir o lembrete.", async () => {
        const resposta = await requisitar(`/${encodeURIComponent(id)}`);
        const lembrete = await resposta.json().catch(() => null);
        if (!lembrete || lembrete.id !== id || typeof lembrete.descricao !== "string") {
            throw new Error("A API enviou um lembrete inválido.");
        }
        abrirFormulario(origem, lembrete);
    });
    if (!formulario.open) origem.focus();
}

// POST /lembretes e PUT /lembretes/{id}
formLembrete.addEventListener("submit", async event => {
    event.preventDefault();
    if (ocupado || !formulario.open || confirmacaoExclusao.open) return;
    const texto = descricao.value.trim();
    if (!texto || texto.length > 500) {
        descricao.setCustomValidity("Informe uma descrição com até 500 caracteres.");
        descricao.reportValidity();
        return;
    }

    const id = porId("lembreteId").value;
    await executar("Salvando lembrete…", "Não foi possível salvar.", async () => {
        await requisitar(id ? `/${encodeURIComponent(id)}` : "", {
            method: id ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ descricao: texto })
        });
        colecaoFiltrada = undefined;
        formulario.close();
        porId("toast").textContent = id ? "Lembrete atualizado." : "Lembrete cadastrado.";
        await filtrarLembretes();
    }, porId("erroFormulario"));
    if (formulario.open) {
        descricao.focus();
    } else {
        const editar = id && listaLembretes.querySelector(`[data-id="${CSS.escape(id)}"] .editar`);
        (editar || porId("btnNovo")).focus();
    }
});

formLembrete.addEventListener("keydown", event => {
    if (event.key !== "Enter" || !event.ctrlKey || event.isComposing ||
        !formulario.open || confirmacaoExclusao.open) return;
    event.preventDefault();
    if (!ocupado && !event.repeat) formLembrete.requestSubmit(btnSalvar);
});

function pedirExclusao(id, origem) {
    idParaExcluir = id;
    porId("erroExclusao").textContent = "";
    abrirModal(confirmacaoExclusao, origem);
}

// DELETE /lembretes/{id}
porId("formExclusao").addEventListener("submit", async event => {
    event.preventDefault();
    if (ocupado || !confirmacaoExclusao.open) return;

    const id = idParaExcluir;
    porId("erroExclusao").textContent = "";
    await executar("Excluindo lembrete…", "Não foi possível excluir o lembrete.", async () => {
        await requisitar(`/${encodeURIComponent(id)}`, { method: "DELETE" });
        colecaoFiltrada = undefined;
        confirmacaoExclusao.close();
        porId("toast").textContent = "Lembrete excluído.";
        await filtrarLembretes();
    }, porId("erroExclusao"));
    if (confirmacaoExclusao.open) {
        porId("btnCancelarExclusao").focus();
    } else {
        document.querySelector(".tabela").focus();
    }
});

function renderizarLembretes(lembretes) {
    const linhas = document.createDocumentFragment();
    for (const lembrete of lembretes) {
        const linha = porId("linhaLembrete").content.cloneNode(true);
        linha.querySelector("tr").dataset.id = lembrete.id;
        linha.querySelector(".descricao").textContent = lembrete.descricao;
        const [cadastro, atualizacao] = linha.querySelectorAll(".data");
        cadastro.textContent = formatarData(lembrete.dataCadastro);
        atualizacao.textContent = formatarData(lembrete.dataAtualizacao);
        linha.querySelector(".editar").addEventListener("click", event => buscarLembrete(lembrete.id, event.currentTarget));
        linha.querySelector(".excluir").addEventListener("click", event => pedirExclusao(lembrete.id, event.currentTarget));
        linhas.append(linha);
    }
    listaLembretes.replaceChildren(linhas);
    porId("mensagemVazia").hidden = lembretes.length > 0;
}

function formatarData(valor) {
    const data = new Date(valor ?? "");
    return Number.isNaN(data.getTime()) ? "—" : formatoData.format(data);
}

formFiltros.addEventListener("submit", event => {
    event.preventDefault();
    const campos = new FormData(formFiltros);
    for (const prefixo of ["DataCadastro", "DataAtualizacao"]) {
        const inicial = campos.get(prefixo + "Inicial");
        const final = campos.get(prefixo + "Final");
        if (inicial && final && inicial > final) {
            const rotulo = prefixo === "DataCadastro" ? "cadastro" : "atualização";
            porId("erro").textContent = `A data inicial de ${rotulo} deve ser anterior ou igual à final.`;
            formFiltros.elements.namedItem(prefixo + "Inicial").focus();
            return;
        }
    }

    filtros = { Descricao: campos.get("Descricao").trim(), ...limitesDatas };
    for (const chave of Object.keys(limitesDatas)) {
        filtros[chave] = campos.get(chave) || limitesDatas[chave];
    }
    paginaAtual = 1;
    recarregar();
});

porId("btnLimpar").addEventListener("click", () => {
    formFiltros.reset();
    tamanhoPagina.value = String(tamanhoAtual);
    filtros = { Descricao: "", ...limitesDatas };
    paginaAtual = 1;
    recarregar();
});

tamanhoPagina.addEventListener("change", () => {
    tamanhoAtual = Number(tamanhoPagina.value);
    paginaAtual = 1;
    recarregar();
});

btnAnterior.addEventListener("click", () => {
    if (carregado && paginaAtual > 1) {
        paginaAtual--;
        recarregar();
    }
});

btnProximo.addEventListener("click", () => {
    if (carregado && paginaAtual < ultimaPagina()) {
        paginaAtual++;
        recarregar();
    }
});

for (const botao of botoesOrdem) {
    botao.addEventListener("click", () => {
        direcao = ordem === botao.dataset.ordem && direcao === "ASC" ? "DESC" : "ASC";
        ordem = botao.dataset.ordem;
        atualizarIndicadorOrdem();
        recarregar();
    });
}

btnImprimir.addEventListener("click", abrirRelatorio);
porId("btnNovo").addEventListener("click", event => abrirFormulario(event.currentTarget));
porId("btnCancelar").addEventListener("click", () => formulario.close());
descricao.addEventListener("input", () => descricao.setCustomValidity(""));
confirmacaoExclusao.addEventListener("keydown", event => {
    if (event.ctrlKey && event.key === "Enter") event.preventDefault();
});
porId("btnCancelarExclusao").addEventListener("click", () => confirmacaoExclusao.close());
for (const dialogo of [formulario, confirmacaoExclusao]) {
    dialogo.addEventListener("cancel", event => {
        if (ocupado) event.preventDefault();
    });
}

const listagemAnterior = history.state?.listagem;
if (listagemAnterior) {
    ({ filtros, paginaAtual, tamanhoAtual, ordem, direcao } = listagemAnterior);
    for (const [nome, valor] of Object.entries(listagemAnterior.campos)) {
        formFiltros.elements.namedItem(nome).value = valor;
    }
    tamanhoPagina.value = String(tamanhoAtual);
}

atualizarIndicadorOrdem();
recarregar();
