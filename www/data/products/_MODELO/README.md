# Modelo de produto

Crie uma pasta em `www/data/products/`, preferencialmente com o `arquivo_id` da API.

```text
1050/
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

Copie `product.json.example` como `product.json`, substitua os dados e execute `Rscript validate_products.R` na raiz. O Shiny detecta a nova pasta em até 5 segundos, sem editar catálogo ou código.

Para produto sem detecções, mantenha `detections-cfar.geojson` como `FeatureCollection` com `features: []`.
