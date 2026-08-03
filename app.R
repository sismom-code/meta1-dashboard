required_packages <- c("shiny", "jsonlite")
missing_packages <- required_packages[
  !vapply(required_packages, requireNamespace, logical(1), quietly = TRUE)
]
if (length(missing_packages) > 0) {
  stop(paste0(
    "Pacotes ausentes: ", paste(missing_packages, collapse = ", "),
    ". Execute primeiro: Rscript install_packages.R"
  ), call. = FALSE)
}

library(shiny)
source("config.R", local = TRUE)
source("product_catalog.R", local = TRUE)

render_dashboard_template <- function(path, values) {
  html <- paste(readLines(path, encoding = "UTF-8", warn = FALSE), collapse = "\n")
  for (name in names(values)) {
    html <- gsub(
      paste0("{{", name, "}}"),
      htmltools::htmlEscape(as.character(values[[name]])),
      html,
      fixed = TRUE
    )
  }
  HTML(html)
}

initial_catalog <- scan_product_catalog()
client_config_json <- jsonlite::toJSON(list(
  auto_interval_ms = APP_CONFIG$auto_interval_ms,
  catalog_refresh_ms = APP_CONFIG$catalog_refresh_ms,
  default_product_id = APP_CONFIG$default_product_id,
  catalog = initial_catalog
), auto_unbox = TRUE, null = "null", na = "null")

ui <- tags$html(
  lang = "pt-BR",
  tags$head(
    tags$meta(charset = "utf-8"),
    tags$meta(name = "viewport", content = "width=device-width,initial-scale=1,viewport-fit=cover"),
    tags$meta(name = "theme-color", content = "#031323"),
    tags$title(APP_CONFIG$app_title),
    tags$link(rel = "stylesheet", href = "assets/leaflet.css"),
    tags$link(rel = "stylesheet", href = "assets/styles.css"),
    tags$link(rel = "stylesheet", href = "config.css"),
    tags$script(HTML(sprintf("window.SISMOM_CONFIG = %s;", client_config_json)))
  ),
  tags$body(
    render_dashboard_template("www/dashboard.html", APP_CONFIG$text),
    tags$script(src = "assets/leaflet.js"),
    tags$script(src = "assets/app.js")
  )
)

server <- function(input, output, session) {
  catalog <- reactivePoll(
    intervalMillis = APP_CONFIG$catalog_refresh_ms,
    session = session,
    checkFunc = function() product_catalog_signature(),
    valueFunc = function() scan_product_catalog()
  )

  observe({
    session$sendCustomMessage("sismom_catalog", list(
      products = catalog(),
      default_product_id = APP_CONFIG$default_product_id
    ))
  })

  observeEvent(input$selected_product, {
    message(sprintf("[%s] Produto selecionado: %s",
      format(Sys.time(), "%Y-%m-%d %H:%M:%S"), input$selected_product))
  }, ignoreInit = TRUE)

  observeEvent(input$selected_patch, {
    message(sprintf("[%s] Recorte selecionado: %s",
      format(Sys.time(), "%Y-%m-%d %H:%M:%S"), input$selected_patch))
  }, ignoreInit = TRUE)
}

shinyApp(ui = ui, server = server)
