# Descoberta e validação dos produtos publicados em www/data/products.

is_safe_relative_path <- function(value) {
  if (!is.character(value) || length(value) != 1L || !nzchar(value)) return(FALSE)
  normalized <- gsub("\\\\", "/", value)
  parts <- strsplit(normalized, "/", fixed = TRUE)[[1]]
  !grepl("^(/|[A-Za-z]:)", normalized) && !any(parts %in% c("..", ""))
}

manifest_file_exists <- function(product_dir, relative_path) {
  is_safe_relative_path(relative_path) && file.exists(file.path(product_dir, relative_path))
}

read_product_manifest <- function(path) {
  tryCatch(
    jsonlite::fromJSON(path, simplifyVector = FALSE),
    error = function(error) {
      warning(sprintf("Manifesto inválido em %s: %s", path, error$message), call. = FALSE)
      NULL
    }
  )
}

validate_product_manifest <- function(manifest, product_dir) {
  errors <- character()
  add_error <- function(message) errors <<- c(errors, message)

  for (field in c("id", "date", "name", "satellite", "mode", "polarization", "start_utc")) {
    value <- manifest[[field]]
    if (is.null(value) || !is.character(value) || length(value) != 1L || !nzchar(value)) {
      add_error(sprintf("campo obrigatório ausente ou inválido: %s", field))
    }
  }

  if (!is.null(manifest$date) &&
      (!is.character(manifest$date) || !grepl("^[0-9]{4}-[0-9]{2}-[0-9]{2}$", manifest$date))) {
    add_error("date deve usar o formato AAAA-MM-DD")
  }

  mosaic <- manifest$mosaic
  if (is.null(mosaic) || !is.list(mosaic)) {
    add_error("objeto mosaic ausente")
  } else {
    if (is.null(mosaic$path) || !manifest_file_exists(product_dir, mosaic$path)) {
      add_error("mosaic.path não aponta para um arquivo existente")
    }
    bounds <- mosaic$bounds
    required_bounds <- c("west", "south", "east", "north")
    if (is.null(bounds) || !is.list(bounds) ||
        !all(vapply(required_bounds, function(name) {
          value <- bounds[[name]]
          is.numeric(value) && length(value) == 1L && is.finite(value)
        }, logical(1)))) {
      add_error("mosaic.bounds deve conter west, south, east e north numéricos")
    } else if (bounds$west >= bounds$east || bounds$south >= bounds$north) {
      add_error("mosaic.bounds possui ordem geográfica inválida")
    }
  }

  required_files <- list(
    footprint = manifest$footprint,
    patches = manifest$patches,
    presentation = manifest$presentation
  )
  for (name in names(required_files)) {
    relative_path <- required_files[[name]]
    if (is.null(relative_path) || !manifest_file_exists(product_dir, relative_path)) {
      add_error(sprintf("arquivo obrigatório ausente: %s", name))
    }
  }

  detection_paths <- unlist(manifest$detections, recursive = TRUE, use.names = TRUE)
  detection_paths <- detection_paths[vapply(detection_paths, function(value) {
    is.character(value) && length(value) == 1L && nzchar(value)
  }, logical(1))]
  for (name in names(detection_paths)) {
    if (!manifest_file_exists(product_dir, detection_paths[[name]])) {
      add_error(sprintf("arquivo de detecção declarado e ausente: %s", name))
    }
  }

  previews <- manifest$previews
  if (is.null(previews) || !is.list(previews)) {
    add_error("objeto previews ausente")
  } else {
    directory <- previews$directory
    if (is.null(directory) || !is_safe_relative_path(directory) ||
        !dir.exists(file.path(product_dir, directory))) {
      add_error("previews.directory não aponta para uma pasta existente")
    }
    if (is.null(previews$pattern) || !is.character(previews$pattern) ||
        !grepl("\\{patch_label\\}", previews$pattern)) {
      add_error("previews.pattern deve conter {patch_label}")
    }
  }

  list(valid = length(errors) == 0L, errors = errors)
}

product_directory_signature <- function(product_dir) {
  if (!dir.exists(product_dir)) return("missing")
  files <- list.files(product_dir, recursive = TRUE, full.names = TRUE, all.files = TRUE, no.. = TRUE)
  files <- files[file.exists(files) & !dir.exists(files)]
  if (length(files) == 0L) return("empty")
  info <- file.info(files)
  paste(
    format(max(info$mtime, na.rm = TRUE), "%Y%m%d%H%M%OS6", tz = "UTC"),
    sum(info$size, na.rm = TRUE),
    length(files),
    sep = "-"
  )
}

scan_product_catalog <- function(root = "www/data/products") {
  if (!dir.exists(root)) dir.create(root, recursive = TRUE, showWarnings = FALSE)
  product_dirs <- list.dirs(root, recursive = FALSE, full.names = TRUE)
  root_normalized <- normalizePath(root, winslash = "/", mustWork = FALSE)
  product_dirs <- product_dirs[normalizePath(product_dirs, winslash = "/", mustWork = FALSE) != root_normalized]
  product_dirs <- product_dirs[!startsWith(basename(product_dirs), "_")]
  entries <- list()

  for (product_dir in product_dirs) {
    manifest_path <- file.path(product_dir, "product.json")
    if (!file.exists(manifest_path)) next
    manifest <- read_product_manifest(manifest_path)
    if (is.null(manifest)) next

    validation <- validate_product_manifest(manifest, product_dir)
    if (!validation$valid) {
      warning(sprintf(
        "Produto ignorado (%s): %s",
        basename(product_dir), paste(validation$errors, collapse = "; ")
      ), call. = FALSE)
      next
    }

    entries[[length(entries) + 1L]] <- list(
      id = as.character(manifest$id),
      arquivo_id = if (is.null(manifest$arquivo_id)) as.character(manifest$id) else manifest$arquivo_id,
      date = manifest$date,
      name = manifest$name,
      satellite = manifest$satellite,
      start_utc = manifest$start_utc,
      manifest = sprintf("data/products/%s/product.json", basename(product_dir)),
      version = product_directory_signature(product_dir)
    )
  }

  if (length(entries) == 0L) return(entries)
  order_index <- order(
    vapply(entries, function(item) item$date, character(1)),
    vapply(entries, function(item) item$start_utc, character(1)),
    vapply(entries, function(item) item$id, character(1)),
    decreasing = TRUE
  )
  entries[order_index]
}

product_catalog_signature <- function(root = "www/data/products") {
  if (!dir.exists(root)) return("missing")
  product_dirs <- list.dirs(root, recursive = FALSE, full.names = TRUE)
  root_normalized <- normalizePath(root, winslash = "/", mustWork = FALSE)
  product_dirs <- product_dirs[normalizePath(product_dirs, winslash = "/", mustWork = FALSE) != root_normalized]
  product_dirs <- product_dirs[!startsWith(basename(product_dirs), "_")]
  if (length(product_dirs) == 0L) return("empty")
  paste(vapply(
    product_dirs,
    function(product_dir) paste(basename(product_dir), product_directory_signature(product_dir), sep = "="),
    character(1)
  ), collapse = ";")
}
