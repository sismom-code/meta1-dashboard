packages <- c("shiny", "jsonlite")

# No Windows, usa a biblioteca pessoal para evitar tentativa de gravar em
# C:/Program Files/R, que normalmente exige permissao de administrador.
if (.Platform$OS.type == "windows") {
  minor_version <- strsplit(R.version$minor, ".", fixed = TRUE)[[1]][1]
  r_short_version <- paste(R.version$major, minor_version, sep = ".")
  local_app_data <- Sys.getenv("LOCALAPPDATA", unset = "")

  if (nzchar(local_app_data)) {
    user_library <- file.path(local_app_data, "R", "win-library", r_short_version)
    dir.create(user_library, recursive = TRUE, showWarnings = FALSE)
    .libPaths(unique(c(user_library, .libPaths())))
  }
}

missing <- packages[!vapply(packages, requireNamespace, logical(1), quietly = TRUE)]

if (length(missing) == 0) {
  message("Todos os pacotes necessarios ja estao instalados.")
} else {
  message("Instalando: ", paste(missing, collapse = ", "))
  install.packages(
    missing,
    repos = "https://cloud.r-project.org",
    lib = .libPaths()[1],
    dependencies = TRUE
  )
}

still_missing <- packages[!vapply(packages, requireNamespace, logical(1), quietly = TRUE)]
if (length(still_missing) > 0) {
  stop("Nao foi possivel instalar: ", paste(still_missing, collapse = ", "))
}

message("Preparacao concluida.")
