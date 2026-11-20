# Lenta-Mente

Trabalho acadêmico de Programação III da UMFG. A aplicação permite cadastrar, consultar, editar, excluir e filtrar lembretes. A exportação da página atual depende do endpoint de PDF da API original.

O front-end usa HTML5, CSS3, JavaScript puro e Fetch API. A Minimal API usa C#, ASP.NET Core e Entity Framework Core no .NET 8, MySQL 8 para persistência e QuestPDF para o relatório.

## Projetos-base

- API original, revisão `9b31440`. [umfg-programacao-iii-minimal-api-2026](https://github.com/leicam/umfg-programacao-iii-minimal-api-2026)
- Front-end original, revisão `152f108`. [umfg-programacao-iii-front-end-2026](https://github.com/leicam/umfg-programacao-iii-front-end-2026)

A API mantém as rotas, as regras do CRUD, as migrações e a configuração CORS dos projetos-base. O layout do relatório e os textos exibidos no PDF foram atualizados. As strings de conexão de exemplo foram removidas dos três arquivos de configuração por ambiente. Forneça a conexão local pela variável `ConnectionString`.

```text
lenta-mente/
├── api/                # Solução .NET, projeto original e migrações
├── frontend/           # Listagem, pré-visualização, scripts, estilos e assets
├── tests/browser.mjs   # Teste de interface no Chrome com respostas controladas
├── .config/            # Manifesto local do dotnet-ef
├── .gitignore
└── README.md
```

## Pré-requisitos no Linux Mint

Use Git, SDK .NET 8 (`8.0.x`), MySQL 8, Python 3 e um navegador moderno. Para o teste automatizado, use Node.js 20 ou superior e Google Chrome.

No Linux Mint 22.x, instale o SDK e os componentes ausentes com o gerenciador de pacotes, se necessário. Verifique primeiro o ambiente existente.

```bash
git --version
dotnet --list-sdks
mysql --version
python3 --version
ss -ltnp
# Se faltarem componentes, instale apenas os pacotes necessários.
sudo apt update
sudo apt install dotnet-sdk-8.0 mysql-server python3
```

### Banco de dados

Se o serviço estiver parado, inicie-o com `sudo systemctl start mysql`. Abra o cliente com `sudo mysql` quando a conta administrativa usa autenticação local por socket, ou `mysql -u root -p` quando usa senha. Crie um banco exclusivo e um usuário local. Substitua o marcador da senha antes de executar o SQL.

```sql
CREATE DATABASE lenta_mente_local CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'lenta_mente_app'@'localhost' IDENTIFIED BY '<defina-uma-senha-local>';
GRANT ALL PRIVILEGES ON lenta_mente_local.* TO 'lenta_mente_app'@'localhost';
```

Os nomes acima são exemplos para uma instalação nova. Para reutilizar um banco e um usuário já configurados para esta aplicação, use os nomes existentes na variável `ConnectionString`.

A API aplica as migrações ao instanciar o contexto pela primeira vez. A conta precisa de permissões de criação e alteração de tabelas nesse banco. Use um banco já existente somente se for destinado a esta aplicação.

### Iniciar a API

Na raiz do projeto, informe a senha definida acima. Use `read -r` para aceitar barras invertidas. A expansão do Bash duplica eventuais aspas duplas da senha para o formato da string de conexão.

```bash
read -rsp 'Senha MySQL: ' LENTA_MENTE_DB_PASSWORD
printf '\n'
export ConnectionString="Server=127.0.0.1;Port=3306;Database=lenta_mente_local;Uid=lenta_mente_app;Pwd=\"${LENTA_MENTE_DB_PASSWORD//\"/\"\"}\";"
unset LENTA_MENTE_DB_PASSWORD
dotnet restore api/umfg.programacaoiii.minimalapi.2026.sln
dotnet run --project api/umfg.programacaoiii.minimalapi.2026 --launch-profile http
```

O perfil `http` escuta em `http://localhost:5207` e permite executar localmente sem certificado. Com o perfil `https`, use um certificado de desenvolvimento confiável no navegador e altere `API_URL` em `frontend/js/api.js` para `https://localhost:7063`. Use a URL HTTPS diretamente nesse perfil para evitar redirecionamento no preflight. A política original permite qualquer origem, método e cabeçalho. Use os serviços somente em loopback durante o teste local.

### Iniciar o front-end

Em outro terminal, na raiz do projeto:

```bash
python3 -m http.server 8000 --bind 127.0.0.1 --directory frontend
```

Abra `http://127.0.0.1:8000/`.

## Funcionalidades e contrato

- Listagem de ativos, consulta por ID antes da edição, cadastro, atualização e exclusão com confirmação. A API exclui logicamente, marcando o registro como inativo.
- Descrição obrigatória, limite de 500 caracteres e exibição como texto. Requisições de escrita enviam JSON no formato `{"descricao":"…"}`.
- Pesquisa por descrição, quatro datas opcionais e validação dos dois intervalos. Aplicar ou limpar filtros volta à primeira página.
- Paginação na listagem com 5, 10 ou 20 registros por página, contagem total e ajuste após exclusão. O navegador reúne os resultados filtrados da API em lotes de 20 registros.
- Ordenação global na listagem por descrição, cadastro ou atualização em ambas as direções. Empates são resolvidos pelo ID. Consulte o limite de coleta e o comportamento do PDF abaixo.
- Exportação via `GET /lembretes/imprimir` com os mesmos parâmetros da página atual e validação do tipo e assinatura do arquivo. A ação abre `relatorio.html` com os parâmetros aplicados. O botão **Baixar PDF** reutiliza o arquivo exibido.

Os endpoints de filtro e de relatório compartilham o DTO. Sem parâmetros, o fim do cadastro é `DateTime.MinValue` e o início da atualização é `DateTime.MaxValue`. O front-end envia datas ISO. Usar `1000-01-01` como início e `9999-12-30` como fim cobre o intervalo operacional do catálogo e permite que o servidor aplique `Date.AddDays(1)` sem estouro. A data final selecionada inclui o dia inteiro. Com esses limites, registros excepcionais datados de `9999-12-31` ficam fora da consulta.

## Testes

```bash
node --check frontend/js/api.js
node --check frontend/js/app.js
node --check frontend/js/relatorio.js
node --check tests/browser.mjs
node tests/ordenacao.mjs
node tests/browser.mjs
```

O teste inicia o Chrome em modo headless. Usa dois servidores HTTP locais em portas efêmeras e dados em memória. Exercita CRUD, corpo JSON, filtros, paginação, recuperação de página após exclusão, parâmetros de ordenação e PDF, feedback e larguras de 320, 360, 768 e 1280 px. A suíte cobre abertura da pré-visualização, tentativa após erro HTTP, download, retorno com os filtros preservados e liberação da URL temporária. Por padrão, o teste usa uma resposta PDF simulada. Para testar com um arquivo produzido pelo QuestPDF, informe o caminho em `PDF_TESTE`. O teste de interface independe do SDK e do MySQL.

Com a API em execução, `node tests/browser.mjs --integracao` repete a suíte do navegador e verifica a API original sem gravar registros. Os comandos abaixo verificam a listagem, os parâmetros, o preflight e o PDF real. Use um arquivo temporário para o relatório.

```bash
base=http://localhost:5207/lembretes
origem=http://127.0.0.1:8000
datas='DataCadastroInicial=1000-01-01&DataCadastroFinal=9999-12-30&DataAtualizacaoInicial=1000-01-01&DataAtualizacaoFinal=9999-12-30'
consulta="NumeroPagina=1&TamanhoPagina=5&Ordem=Descricao&${datas}"

curl -fsSi -H "Origin: $origem" "$base"
curl -fsSi -X OPTIONS "$base" -H "Origin: $origem" \
  -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type'
curl -fsS "$base/filtro?${consulta}&Direcao=ASC"
curl -fsS "$base/filtro?${consulta}&Direcao=DESC"
pdf=$(mktemp --suffix=.pdf)
curl -fsS -D - -o "$pdf" "$base/imprimir?${consulta}&Direcao=DESC"
head -c 5 "$pdf"
rm -- "$pdf"
```

Compare as descrições devolvidas em ASC e DESC com pelo menos três registros distintos fora de ordem de inserção. Use um banco de teste e cadastre os registros pela interface ou por `curl -fsSi -H 'Content-Type: application/json' -d '{"descricao":"LENTA-MENTE-TESTE — Zulu"}' "$base"`. Repita com Alpha e Lima. Use o ID devolvido para conferir `GET "$base/$id"`, `PUT "$base/$id"` com o mesmo formato JSON e `DELETE "$base/$id"` ao final. O GET por ID deve retornar 404 após a exclusão lógica. Para verificar paginação e datas no DevTools, use mais de cinco registros e confira `total`, `numeroPagina` e o conteúdo de `lembretes` em cada requisição.

## Limitações conhecidas

- **Ordenação global na listagem.** A API usa a chave constante `x => dto.Ordem`. O navegador coleta os resultados filtrados em até 50 lotes, com limite de 1.000 registros e 30 segundos para a coleta. Se a API repetir registros ou a coleta ficar incompleta, a interface pede que os filtros sejam reaplicados ou refinados. Bases alteradas externamente durante a coleta podem afetar a consistência das páginas.
- **Ordenação do PDF.** O relatório continua sendo gerado pela API e recebe os mesmos filtros, página, tamanho, coluna e direção da listagem. Como a API preserva sua ordenação original, a página exportada pode conter outra sequência ou outro conjunto de registros.

### Se a exportação ainda mostrar o layout anterior

Confira quem atende a porta 5207 com `ss -ltnp 'sport = :5207'`. Com o PID identificado, use `ps -p PID -o args=` e `readlink /proc/PID/cwd` para conferir o comando e o diretório. Se for uma instância antiga, encerre-a com Ctrl+C no terminal em que foi iniciada e suba a API pelo perfil `http` a partir deste repositório. Na listagem, abra uma nova pré-visualização. Arquivos já baixados continuam com o layout da versão que os gerou.

## Entrega em um único repositório público

Use um único repositório na raiz do projeto. Se ainda não houver um repositório Git local, inicialize-o. Revise o índice completo antes do commit e confirme a autorização para publicar o código-base da disciplina em um repositório público.

```bash
git init -b main
git add .gitignore README.md .config/dotnet-tools.json api frontend tests
git diff --cached --stat
git diff --cached
git status --short
git commit -m 'Entrega do projeto acadêmico Lenta-Mente'
git remote add origin https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git
git push -u origin main
```
