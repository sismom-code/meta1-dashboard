# SisMOM — Meta 1 — Visualizador R Shiny Multidatas

Esta versão mantém a arquitetura original em R Shiny e incorpora o catálogo de **12 produtos SAR**. A abertura padrão ocorre em **09/08/2026**, com os produtos **186F** e **9C2D** no mesmo enquadramento e a camada **CFAR+YOLO** selecionada.

O R Shiny descobre automaticamente todas as pastas válidas em:

```text
www/data/products/
```

Não é necessário editar `app.R`, `app.js`, `dashboard.html` nem um catálogo manual ao adicionar uma aquisição.

## Instalação e abertura

```bash
Rscript install_packages.R
Rscript run_local.R
```

Também permanecem disponíveis os atalhos para Windows, Linux e macOS. O endereço padrão é `http://127.0.0.1:3838`.

## Estrutura de cada produto

```text
www/data/products/1050/
├── product.json
├── mosaic.png
├── footprint.geojson
├── patches.geojson
├── detections-cfar.geojson
├── presentation.json
├── detections-combined.geojson
└── previews/
    ├── P005.png
    └── ...
```

Use como modelo:

```text
www/data/products/_MODELO/product.json.example
```

Depois valide:

```bash
Rscript validate_products.R
```

Com o visualizador aberto, a nova aquisição aparece em até 5 segundos no calendário. O produto deve ter `id` único. Quando houver mais de um produto na mesma data, todos os mosaicos aparecem no mesmo mapa; o produto selecionado é trazido para a camada superior e a rotação continua automaticamente no próximo produto.

## Arquivos necessários

| Arquivo | Conteúdo |
|---|---|
| `product.json` | Identificação, data, horários, caminhos, bounds e parâmetros visuais |
| `mosaic.png` | Mosaico SAR completo norte-acima |
| `footprint.geojson` | Footprint completo do produto |
| `patches.geojson` | Polígonos de todos os recortes |
| `presentation.json` | Alvos únicos deduplicados e associação correta aos previews |
| `detections-*.geojson` | Resultados científicos CFAR, YOLO e combinados, quando disponíveis |
| `previews/*.png` | Preview dos recortes com detecção |

O mosaico e os previews devem usar σ⁰ VV em dB, normalização fixa de −25 a 0 dB, gama 0,95, orientação norte-acima e EPSG:4326.

## Catálogo automático

`product_catalog.R` valida as pastas e atualiza o navegador periodicamente. Ajustes gerais estão em `config.R`:

```r
catalog_refresh_ms = 5000L
default_product_id = "186F"
```

Pastas iniciadas por `_`, como `_MODELO`, são ignoradas.

## Eventos enviados ao R

- `input$selected_product`: produto selecionado;
- `input$selected_patch`: recorte/detecção exibido.

## Internet

Os dados SAR são locais. A internet é usada apenas nos mapas-base de satélite e cartográfico.

## Recursos desta atualização

- filtros `Todas`, `CFAR`, `YOLO` e `CFAR+YOLO`;
- CFAR em verde, YOLO em roxo e CFAR+YOLO em amarelo;
- camada inicial CFAR+YOLO;
- total principal CFAR+YOLO e total geral de alvos únicos;
- controle de opacidade SAR de 0% a 100%, iniciado em 85%;
- todos os boxes do recorte visíveis, com destaque do alvo atual;
- produtos do mesmo dia simultâneos e alternância automática entre eles;
- produto selecionado acima na área de sobreposição;
- rótulos fixos `PXXX` removidos do mosaico;
- correção `9C2D · T0008`, apresentada no preview `P003`.
## Windows: R instalado, mas Rscript não encontrado

O RStudio não é necessário. Use `ABRIR_VISUALIZADOR_SHINY_WINDOWS.bat`; esta versão procura automaticamente o R no PATH, no Registro do Windows e nas pastas padrão de instalação. Na primeira execução, os pacotes `shiny` e `jsonlite` são instalados automaticamente.

Se a detecção automática ainda falhar, confirme a existência deste arquivo, ajustando a versão quando necessário:

```text
C:\Program Files\R\R-4.6.1\bin\Rscript.exe
```
