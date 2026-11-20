using Microsoft.EntityFrameworkCore;
using QuestPDF;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using umfg.programacaoiii.minimalapi._2026.Contexto;
using umfg.programacaoiii.minimalapi._2026.DTO;
using umfg.programacaoiii.minimalapi._2026.Entidades;

namespace umfg.programacaoiii.minimalapi._2026;

public class Program
{    
    //método de startup do projeto
    public static void Main(string[] args)
    {
        //variavel padrão do .net permite definir as caracteristicas que a api irá ter
        //ex: autenticação e autorização via JWT / qual banco de dados
        var builder = WebApplication.CreateBuilder(args);
        var connectionString = builder.Configuration["ConnectionString"] ?? string.Empty;

        //aqui configuramos a conexão da API com o banco de dados
        builder.Services
            .AddDbContext<MySqlContexto>(options => options.UseMySQL(connectionString));
            //.AddDbContext<MySqlContexto>(options => options.UseMySQL("Server=localhost;Port=3308;Database=umfg_lembrete_develop;Uid=root;Pwd=root;"));

        //implementacao do CORS para permitir que a aplicação frontend acesse a API (localhost)
        //no mundo real, restrinja o acesso apenas para o dominio do frontend conhecido. Ex.: .WithOrigins("https://app.empresa.com.br")
        builder.Services.AddCors(options =>
        {
            options.AddPolicy("Frontend", policy =>
            {
                policy
                    .AllowAnyOrigin()
                    .AllowAnyHeader()
                    .AllowAnyMethod();
            });
        });

        //aqui a aplicação é construída
        var app = builder.Build();

        app.MapPost("/lembretes", async (Lembrete lembrete, MySqlContexto contexto) =>
        {
            await contexto.Lembrete.AddAsync(lembrete);
            await contexto.SaveChangesAsync();

            return Results.Created($"/lembretes/{lembrete.Id}", lembrete);
        });

        app.MapGet("/lembretes/{id}", async (string id, MySqlContexto contexto) =>
        {
            if (string.IsNullOrWhiteSpace(id))
                return Results.BadRequest("id invalido!");

            return await contexto.Lembrete.FirstOrDefaultAsync(x => x.Id == Guid.Parse(id) && x.IsAtivo) 
            is Lembrete lembrete ? Results.Ok(lembrete) : Results.NotFound();
        });

        app.MapGet("/lembretes", async (MySqlContexto contexto) =>
        {
            return await contexto.Lembrete.Where(x => x.IsAtivo).ToListAsync();            
        });

        app.MapGet("/lembretes/filtro", async ([AsParameters] LembreteQueryDTO.LembreteQueryRequestDTO dto, MySqlContexto contexto) =>
        {
            if (dto.NumeroPagina <= 0 || dto.TamanhoPagina <= 0)
                return Results.BadRequest("Página e tamanho da página são obrigatórios.");

            var (lembretes, total) = await FiltrarLembretes(dto, contexto);

            var resultado = new LembreteQueryDTO.LembreteQueryResponseDTO()
            {
                Total = total,
                NumeroPagina = dto.NumeroPagina,
                TamanhoPagina = dto.TamanhoPagina,
                Lembretes = lembretes,
            };

            return Results.Ok(resultado);
        });

        //Biblioteca -> QuestPDF
        Settings.License = LicenseType.Community;

        app.MapGet("/lembretes/imprimir", async ([AsParameters] LembreteQueryDTO.LembreteQueryRequestDTO dto, MySqlContexto contexto) =>
        {
            if (dto.NumeroPagina <= 0 || dto.TamanhoPagina <= 0)
                return Results.BadRequest("Página e tamanho da página são obrigatórios.");

            if (dto.NumeroPagina <= 0 || dto.TamanhoPagina <= 0)
                return Results.BadRequest("Página e tamanho da página são obrigatórios.");

            var (lembretes, total) = await FiltrarLembretes(dto, contexto);

            const float larguraData = 110;
            var papel = Color.FromHex("#F5EEDC");
            var folha = Color.FromHex("#FDF8EB");
            var navy = Color.FromHex("#172B4D");
            var tinta = Color.FromHex("#282723");
            var divisoria = Color.FromHex("#C9C1AC");
            var cultura = System.Globalization.CultureInfo.GetCultureInfo("pt-BR");
            var geradoEm = FormatarData(DateTime.Now);
            var logo = QuestPDF.Infrastructure.Image.FromFile(
                Path.Combine(AppContext.BaseDirectory, "RelatorioAssets", "logo.png"));

            string FormatarData(DateTime data) => data.ToLocalTime().ToString("dd/MM/yyyy HH:mm", cultura);

            IContainer CabecalhoCelula(IContainer celula) => celula
                .Background(papel).BorderBottom(1).BorderColor(navy)
                .PaddingHorizontal(12).PaddingVertical(6)
                .DefaultTextStyle(x => x.FontFamily("Caveat", "Lato").FontSize(17).FontColor(navy).Bold());

            IContainer Celula(IContainer celula) => celula
                .PaddingHorizontal(12).PaddingVertical(8);

            var documento = Document.Create(container =>
            {
                container.Page(page =>
                {
                    page.Size(PageSizes.A4);
                    page.Margin(36);
                    page.PageColor(papel);
                    page.DefaultTextStyle(x => x.FontFamily("Lato").FontSize(10).FontColor(tinta));

                    page.Header().PaddingBottom(18)
                        .Border(1.5f).BorderColor(navy).Background(folha)
                        .CornerRadiusTopLeft(12).CornerRadiusTopRight(19)
                        .CornerRadiusBottomLeft(17).CornerRadiusBottomRight(11)
                        .PaddingHorizontal(14).PaddingVertical(9)
                        .Row(row =>
                        {
                            row.Spacing(10);
                            row.ConstantItem(66).Height(66).Image(logo).FitArea();
                            row.RelativeItem().AlignMiddle().Column(coluna =>
                            {
                                coluna.Item().Text("Lenta-Mente")
                                    .FontFamily("Caveat", "Lato").FontSize(18).FontColor(navy);
                                coluna.Item().Text("Meus lembretes")
                                    .FontFamily("Caveat", "Lato").FontSize(36).FontColor(navy).Bold();
                            });
                        });

                    page.Content()
                        .CornerRadius(10).Border(1.25f).BorderColor(navy).Background(folha)
                        .Table(tabela =>
                        {
                            tabela.ColumnsDefinition(colunas =>
                            {
                                colunas.RelativeColumn();
                                colunas.ConstantColumn(larguraData);
                                colunas.ConstantColumn(larguraData);
                            });

                            tabela.Header(cabecalho =>
                            {
                                cabecalho.Cell().Element(CabecalhoCelula).Text("DescriÃ§Ã£o");
                                cabecalho.Cell().Element(CabecalhoCelula).Text("Cadastro");
                                cabecalho.Cell().Element(CabecalhoCelula).Text("AtualizaÃ§Ã£o");
                            });

                            foreach (var lembrete in lembretes)
                            {
                                tabela.Cell().ColumnSpan(3).PreventPageBreak()
                                    .BorderBottom(0.5f).BorderColor(divisoria)
                                    .Row(linha =>
                                    {
                                        linha.RelativeItem().Element(Celula).Text(lembrete.Descricao);
                                        linha.ConstantItem(larguraData).Element(Celula)
                                            .Text(FormatarData(lembrete.DataCadastro));
                                        linha.ConstantItem(larguraData).Element(Celula)
                                            .Text(FormatarData(lembrete.DataAtualizacao));
                                    });
                            }
                        });

                    page.Footer().PaddingTop(12).BorderTop(0.75f).BorderColor(navy)
                        .PaddingTop(8)
                        .DefaultTextStyle(x => x.FontSize(9).FontColor(navy))
                        .Row(row =>
                        {
                            row.RelativeItem().Text($"Gerado em {geradoEm}");
                            row.AutoItem().Text(texto =>
                            {
                                texto.Span("PÃ¡gina ");
                                texto.CurrentPageNumber();
                                texto.Span(" de ");
                                texto.TotalPages();
                            });
                        });
                });
            });

            return Results.File(documento.GeneratePdf(), "application/pdf", "relatorio-lembretes.pdf");
        });


        app.MapDelete("/lembretes/{id}", async (string id, MySqlContexto contexto) =>
        {
            var lembrete = await contexto.Lembrete.FindAsync(Guid.Parse(id));

            //conceito de fail first
            if (lembrete is null)
                return Results.NotFound();

            lembrete.SetAtivo(false);
            lembrete.Update();

            contexto.Lembrete.Update(lembrete);
            await contexto.SaveChangesAsync();

            return Results.NoContent();
        });

        app.MapPut("/lembretes/{id}", async (string id, LembreteDTO dto, MySqlContexto contexto) =>
        {
            var lembreteExistente = await contexto.Lembrete.FindAsync(Guid.Parse(id));

            if (lembreteExistente is null)
                return Results.NotFound();

            lembreteExistente.SetDescricao(dto.Descricao);
            lembreteExistente.Update();

            contexto.Lembrete.Update(lembreteExistente);
            await contexto.SaveChangesAsync();

            return Results.Ok(lembreteExistente);
        });

        //aqui habilitamos as funcionalidades da api
        app.UseHttpsRedirection();

        //habilitar o uso da regra de CORS
        app.UseCors("Frontend");

        //a api é iniciada de fato
        app.Run();
        //tudo que for colocado após o run será executado somente quando a api for parada
    }

    private static async Task<(List<Lembrete>, long)>FiltrarLembretes(
        LembreteQueryDTO.LembreteQueryRequestDTO dto, MySqlContexto contexto)
    {
        var query = contexto.Lembrete
                .AsNoTracking()
                .Where(x => x.IsAtivo);

        //busca por descrição com tratamento de caracteres especiais para LIKE
        if (!string.IsNullOrWhiteSpace(dto.Descricao))
        {
            var termo = dto.Descricao.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");
            query = query.Where(x => EF.Functions.Like(x.Descricao, $"%{termo}%"));
        }

        // Filtros opcionais
        if (dto.DataCadastroInicial > DateTime.MinValue)
            query = query.Where(x => x.DataCadastro >= dto.DataCadastroInicial);

        if (dto.DataCadastroFinal < DateTime.MaxValue)
            query = query.Where(x => x.DataCadastro < dto.DataCadastroFinal.Date.AddDays(1)); // inclui o dia inteiro

        if (dto.DataAtualizacaoInicial > DateTime.MinValue)
            query = query.Where(x => x.DataAtualizacao >= dto.DataAtualizacaoInicial);

        if (dto.DataAtualizacaoFinal < DateTime.MaxValue)
            query = query.Where(x => x.DataAtualizacao < dto.DataAtualizacaoFinal.Date.AddDays(1)); // inclui o dia inteiro

        //ordenar sempre do mais recente para o mais antigo
        if (dto.Direcao.ToUpper() != "ASC" && dto.Direcao.ToUpper() != "DESC")
            dto.Direcao = "DESC";

        //ordenação
        query = dto.Direcao.ToUpper() == "DESC" ? query.OrderByDescending(x => dto.Ordem) : query.OrderBy(x => dto.Ordem);

        // paginação
        var pular = (dto.NumeroPagina - 1) * dto.TamanhoPagina;
        var lembretes = await query.Skip(pular).Take(dto.TamanhoPagina).ToListAsync();
        var total = await query.CountAsync();

        return (lembretes, total);
    }
}