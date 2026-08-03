# SisMOM — Meta 1 — Visualizador R Shiny Multidatas

Esta versão é um visualizador padrão para múltiplos produtos SAR. O Produto **923**, de **29/07/2026**, já está incluído e permanece como produto inicial.

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
├── detections-cfar.csv
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

Com o visualizador aberto, a nova aquisição aparece em até 5 segundos no calendário e no seletor. O produto deve ter `id` único. Mais de um produto na mesma data é suportado pelo seletor do cabeçalho.

## Arquivos necessários

| Arquivo | Conteúdo |
|---|---|
| `product.json` | Identificação, data, horários, caminhos, bounds e parâmetros visuais |
| `mosaic.png` | Mosaico SAR completo norte-acima |
| `footprint.geojson` | Footprint completo do produto |
| `patches.geojson` | Polígonos de todos os recortes |
| `detections-cfar.geojson` | Detecções CFAR e atributos |
| `detections-cfar.csv` | Resultado tabular e rastreabilidade |
| `previews/*.png` | Preview dos recortes com detecção |

O mosaico e os previews devem usar σ⁰ VV em dB, normalização fixa de −25 a 0 dB, gama 0,95, orientação norte-acima e EPSG:4326.

## Catálogo automático

`product_catalog.R` valida as pastas e atualiza o navegador periodicamente. Ajustes gerais estão em `config.R`:

```r
catalog_refresh_ms = 5000L
default_product_id = "923"
```

Pastas iniciadas por `_`, como `_MODELO`, são ignoradas.

## Eventos enviados ao R

- `input$selected_product`: produto selecionado;
- `input$selected_patch`: recorte/detecção exibido.

## Internet

Os dados SAR são locais. A internet é usada apenas nos mapas-base de satélite e cartográfico.
## Windows: R instalado, mas Rscript não encontrado

O RStudio não é necessário. Use `ABRIR_VISUALIZADOR_SHINY_WINDOWS.bat`; esta versão procura automaticamente o R no PATH, no Registro do Windows e nas pastas padrão de instalação. Na primeira execução, os pacotes `shiny` e `jsonlite` são instalados automaticamente.

Se a detecção automática ainda falhar, confirme a existência deste arquivo, ajustando a versão quando necessário:

```text
C:\Program Files\R\R-4.6.1\bin\Rscript.exe
```

