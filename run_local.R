source("config.R", local = TRUE)

if (!requireNamespace("shiny", quietly = TRUE)) {
  stop("Pacote shiny ausente. Execute primeiro: Rscript install_packages.R")
}

open_local_browser <- function(url) {
  local_url <- sub("0.0.0.0", "127.0.0.1", url, fixed = TRUE)
  utils::browseURL(local_url)
}

shiny::runApp(
  appDir = ".",
  host = APP_CONFIG$host,
  port = APP_CONFIG$port,
  launch.browser = open_local_browser
)
