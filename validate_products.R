if (!requireNamespace("jsonlite", quietly = TRUE)) {
  stop("Pacote jsonlite ausente. Execute: Rscript install_packages.R", call. = FALSE)
}
source("product_catalog.R", local = TRUE)
root <- "www/data/products"
product_dirs <- list.dirs(root, recursive = FALSE, full.names = TRUE)
root_normalized <- normalizePath(root, winslash = "/", mustWork = FALSE)
product_dirs <- product_dirs[normalizePath(product_dirs, winslash = "/", mustWork = FALSE) != root_normalized]
product_dirs <- product_dirs[!startsWith(basename(product_dirs), "_")]
if (length(product_dirs) == 0L) stop("Nenhuma pasta de produto encontrada.", call. = FALSE)

has_error <- FALSE
for (product_dir in product_dirs) {
  label <- basename(product_dir)
  manifest_path <- file.path(product_dir, "product.json")
  if (!file.exists(manifest_path)) {
    message(sprintf("[ERRO] %s: product.json ausente", label)); has_error <- TRUE; next
  }
  manifest <- read_product_manifest(manifest_path)
  if (is.null(manifest)) {
    message(sprintf("[ERRO] %s: JSON inválido", label)); has_error <- TRUE; next
  }
  validation <- validate_product_manifest(manifest, product_dir)
  if (!validation$valid) {
    message(sprintf("[ERRO] %s: %s", label, paste(validation$errors, collapse = "; ")))
    has_error <- TRUE
  } else {
    total <- if (is.null(manifest$total_patches)) "não informado" else manifest$total_patches
    unique_targets <- if (is.null(manifest$presentation_counts$total)) "não informado" else manifest$presentation_counts$total
    combined <- if (is.null(manifest$presentation_counts$combined)) "não informado" else manifest$presentation_counts$combined
    message(sprintf("[OK] %s: produto %s, data %s, %s recortes, %s alvos únicos, %s CFAR+YOLO", label, manifest$id, manifest$date, total, unique_targets, combined))
  }
}
if (has_error) quit(status = 1L)
message("Todos os produtos foram validados com sucesso.")
