# Modelo de produto

Crie uma pasta em `www/data/products/`, preferencialmente com o `arquivo_id` da API.

```text
1050/
├── product.json
├── mosaic.png
├── footprint.geojson
├── patches.geojson
├── presentation.json
├── detections-cfar.geojson       # opcional
├── detections-yolo.geojson       # opcional
├── detections-combined.geojson   # opcional
└── previews/
    ├── P005.png
    └── ...
```

Copie `product.json.example` como `product.json`, substitua os dados e execute `Rscript validate_products.R` na raiz. O Shiny detecta a nova pasta em até 5 segundos, sem editar catálogo ou código.

`presentation.json` contém a lista deduplicada usada na apresentação. Cada alvo deve informar o recorte (`id`), a posição, o método exclusivo (`cfar`, `yolo` ou `combined`) e o nome do preview. Os GeoJSONs científicos continuam preservados separadamente.
