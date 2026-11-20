const documento = document.getElementById("documento");
const estado = document.getElementById("estado-relatorio");
const baixar = document.getElementById("baixar");
const tentar = document.getElementById("tentar");
const voltar = document.getElementById("voltar");
const parametros = new URLSearchParams(location.search);
let urlPDF;
let requisicao;

async function carregarRelatorio() {
    const controle = new AbortController();
    requisicao = controle;
    estado.textContent = "Gerando relatório…";
    tentar.hidden = true;
    try {
        const resposta = await fetch(`${API_URL}/lembretes/imprimir?${parametros}`, {
            cache: "no-store",
            signal: AbortSignal.any([controle.signal, AbortSignal.timeout(15000)])
        });
        if (!resposta.ok) throw new Error(`A API retornou HTTP ${resposta.status}.`);
        const pdf = await resposta.blob();
        if (pdf.type !== "application/pdf" || await pdf.slice(0, 5).text() !== "%PDF-") {
            throw new Error("A API não retornou um PDF válido.");
        }
        if (controle.signal.aborted) return;
        urlPDF = URL.createObjectURL(pdf);
        baixar.disabled = false;
        if (navigator.pdfViewerEnabled) {
            documento.src = urlPDF;
            documento.hidden = false;
            estado.textContent = "Relatório pronto.";
        } else {
            estado.textContent = "A visualização incorporada está indisponível neste navegador. Use Baixar PDF para abrir o relatório.";
        }
    } catch (erro) {
        if (controle.signal.aborted) return;
        const detalhe = erro.name === "TimeoutError" ? "A API demorou para responder."
            : erro instanceof TypeError ? "Verifique se a API está em execução." : erro.message;
        estado.textContent = `Não foi possível carregar o relatório. ${detalhe}`;
        tentar.hidden = false;
    }
}

baixar.addEventListener("click", () => {
    if (!urlPDF) return;
    const link = document.createElement("a");
    link.href = urlPDF;
    link.download = "relatorio-lembretes.pdf";
    link.click();
});

voltar.addEventListener("click", event => {
    if (!document.referrer) return;
    const origem = new URL(document.referrer);
    const pasta = new URL("./", location.href);
    if (origem.origin === pasta.origin &&
        [pasta.pathname, `${pasta.pathname}index.html`].includes(origem.pathname)) {
        event.preventDefault();
        history.back();
    }
});

tentar.addEventListener("click", carregarRelatorio);
window.addEventListener("pagehide", () => {
    requisicao?.abort();
    documento.hidden = true;
    documento.removeAttribute("src");
    baixar.disabled = true;
    if (urlPDF) URL.revokeObjectURL(urlPDF);
    urlPDF = undefined;
});
window.addEventListener("pageshow", event => {
    if (event.persisted) carregarRelatorio();
});
carregarRelatorio();
