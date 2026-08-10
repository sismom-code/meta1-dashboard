(function () {
  "use strict";

  const CONFIG = window.SISMOM_CONFIG || {};
  const autoIntervalMs = Number(CONFIG.auto_interval_ms || 10000);
  const transparentPixel = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  const KIND_LABELS = { all: "Todas", cfar: "CFAR", yolo: "YOLO", combined: "CFAR+YOLO" };
  const KIND_COLORS = { cfar: "#45ec8b", yolo: "#b65cff", combined: "#ffd84a" };

  const state = {
    catalog: [], catalogFingerprint: "", defaultProductId: String(CONFIG.default_product_id || "186F"),
    currentDate: null, dailyProducts: [], activeProductCode: null,
    allItems: [], filteredItems: [], currentIndex: 0, filter: "combined", opacity: 0.85,
    timer: null, loadToken: 0, calendarMonth: null,
    map: null, zeeLayer: null, mapView: "product",
  };

  const el = (id) => document.getElementById(id);
  const numberOrNull = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const fmt = (value, digits = 0) => {
    const parsed = numberOrNull(value);
    if (parsed === null) return "—";
    return parsed.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const statusLabel = (value, fallback = "SEM DADOS") => value ? String(value).replaceAll("_", " ").toUpperCase() : fallback;
  const pluralTargets = (count) => `${count} ${count === 1 ? "alvo" : "alvos"}`;
  const absoluteUrl = (path, base = document.baseURI) => new URL(path, base).toString();

  function updateClock() {
    const now = new Date();
    el("currentDate").textContent = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" }).format(now);
    el("currentTime").textContent = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now);
  }

  function showAlert(message, kind = "error") {
    const alert = el("viewerAlert");
    alert.textContent = message; alert.dataset.kind = kind; alert.hidden = false;
  }
  function hideAlert() { el("viewerAlert").hidden = true; }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Falha ao carregar ${url} (HTTP ${response.status})`);
    return response.json();
  }

  function walkCoordinates(value, accumulator) {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
      accumulator.push([Number(value[0]), Number(value[1])]); return;
    }
    value.forEach((child) => walkCoordinates(child, accumulator));
  }
  function geometryBounds(feature) {
    const coordinates = [];
    walkCoordinates(feature?.geometry?.coordinates, coordinates);
    if (!coordinates.length) return null;
    const xs = coordinates.map((point) => point[0]);
    const ys = coordinates.map((point) => point[1]);
    return { west: Math.min(...xs), south: Math.min(...ys), east: Math.max(...xs), north: Math.max(...ys) };
  }
  function normalizeBounds(raw) {
    if (!raw || typeof raw !== "object") return null;
    const west = numberOrNull(raw.w ?? raw.west), south = numberOrNull(raw.s ?? raw.south);
    const east = numberOrNull(raw.e ?? raw.east), north = numberOrNull(raw.n ?? raw.north);
    if ([west, south, east, north].some((value) => value === null) || west >= east || south >= north) return null;
    return { west, south, east, north };
  }
  function patchKey(properties) {
    if (properties?.patch_label) return String(properties.patch_label);
    const number = numberOrNull(properties?.patch_number);
    return number === null ? "" : `P${String(number).padStart(3, "0")}`;
  }

  const catalogFingerprint = (products) => JSON.stringify(products.map((item) => [item.id, item.date, item.manifest, item.version || ""]));
  function normalizeCatalog(payload) {
    const products = Array.isArray(payload) ? payload : (Array.isArray(payload?.products) ? payload.products : []);
    if (payload?.default_product_id !== undefined && payload?.default_product_id !== null) state.defaultProductId = String(payload.default_product_id);
    const seen = new Set();
    return products.filter((entry) => entry && entry.id !== undefined && entry.date && entry.manifest)
      .map((entry) => ({ ...entry, id: String(entry.id) }))
      .filter((entry) => { const key = `${entry.id}|${entry.manifest}`; if (seen.has(key)) return false; seen.add(key); return true; })
      .sort((a, b) => String(b.start_utc || b.date).localeCompare(String(a.start_utc || a.date)));
  }

  function dateFromIso(isoDate) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ""));
    return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
  }
  const monthStart = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const addMonths = (date, amount) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1));
  const monthValue = (date) => date.getUTCFullYear() * 12 + date.getUTCMonth();
  function formatDate(isoDate) {
    const date = dateFromIso(isoDate); if (!date) return "—";
    return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
  }
  function formatTime(isoDateTime, timeZone = "UTC") {
    const date = new Date(isoDateTime); if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("pt-BR", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date);
  }
  function formatMonth(date) {
    const label = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "long", year: "numeric" }).format(date);
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  const productsForDate = (isoDate) => state.catalog.filter((entry) => entry.date === isoDate)
    .sort((a, b) => String(a.start_utc || "").localeCompare(String(b.start_utc || "")));

  function renderCalendar() {
    const days = el("calendarDays"); days.replaceChildren();
    if (!state.catalog.length) {
      el("calendarMonthLabel").textContent = "Sem produtos";
      el("calendarPreviousMonth").disabled = true; el("calendarNextMonth").disabled = true; return;
    }
    if (!state.calendarMonth) {
      const selected = dateFromIso(state.currentDate || state.catalog[0].date);
      state.calendarMonth = monthStart(selected || new Date());
    }
    el("calendarMonthLabel").textContent = formatMonth(state.calendarMonth);
    const year = state.calendarMonth.getUTCFullYear(), month = state.calendarMonth.getUTCMonth();
    const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    for (let blank = 0; blank < firstWeekday; blank += 1) days.appendChild(document.createElement("span"));
    for (let day = 1; day <= daysInMonth; day += 1) {
      const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const available = productsForDate(iso);
      const button = document.createElement("button"); button.type = "button"; button.textContent = String(day); button.disabled = !available.length;
      button.setAttribute("aria-label", available.length ? `${day} de ${formatMonth(state.calendarMonth)}, ${available.length} produto(s) disponível(is)` : `${day} de ${formatMonth(state.calendarMonth)}, sem produto`);
      if (state.currentDate === iso) button.classList.add("selected");
      button.addEventListener("click", () => { closeCalendar(); loadDate(iso, available[0]?.id); });
      days.appendChild(button);
    }
    const dates = state.catalog.map((entry) => dateFromIso(entry.date)).filter(Boolean);
    const minMonth = Math.min(...dates.map((date) => monthValue(monthStart(date))));
    const maxMonth = Math.max(...dates.map((date) => monthValue(monthStart(date))));
    el("calendarPreviousMonth").disabled = monthValue(addMonths(state.calendarMonth, -1)) < minMonth;
    el("calendarNextMonth").disabled = monthValue(addMonths(state.calendarMonth, 1)) > maxMonth;
  }
  function closeCalendar() { el("acquisitionCalendar").hidden = true; el("acquisitionDateButton").setAttribute("aria-expanded", "false"); }

  function dailyCounts() {
    const counts = { cfar: 0, yolo: 0, combined: 0, total: 0, patches: 0 };
    state.dailyProducts.forEach((product) => {
      const source = product.manifest.presentation_counts || {};
      counts.cfar += Number(source.cfar || product.items.filter((item) => item.kind === "cfar").length);
      counts.yolo += Number(source.yolo || product.items.filter((item) => item.kind === "yolo").length);
      counts.combined += Number(source.combined || product.items.filter((item) => item.kind === "combined").length);
      counts.total += Number(source.total || product.items.length);
      counts.patches += Number(product.manifest.total_patches || 0);
    });
    return counts;
  }

  function activeProduct() { return state.dailyProducts.find((product) => product.code === state.activeProductCode) || state.dailyProducts[0] || null; }

  function updateHeader() {
    const product = activeProduct();
    if (!product) return;
    const manifest = product.manifest, counts = dailyCounts();
    const productId = product.code;
    el("productSatelliteLabel").textContent = `PRODUTO SAR — ${String(manifest.satellite || "SATÉLITE").toUpperCase()}`;
    el("productHeading").textContent = state.dailyProducts.length > 1 ? `${state.dailyProducts.length} produtos processados no dia` : `Produto processado • arquivo ${productId}`;
    el("productFullName").textContent = manifest.name || "—";
    el("productStatus").innerHTML = `<i></i> ${escapeHtml(statusLabel(manifest.status, "PROCESSADO"))}`;
    el("acquisitionDateValue").textContent = formatDate(state.currentDate);
    el("productTimeUtc").textContent = `${formatTime(manifest.start_utc)}–${formatTime(manifest.end_utc || manifest.start_utc)}`;
    el("productTimeBrt").textContent = `Brasília: ${formatTime(manifest.start_utc, "America/Sao_Paulo")}–${formatTime(manifest.end_utc || manifest.start_utc, "America/Sao_Paulo")} BRT`;
    el("productMode").textContent = manifest.mode || "—";
    el("productPolarization").textContent = manifest.polarization || "—";
    el("productPatchCount").textContent = fmt(counts.patches, 0);
    el("productDetectionCount").textContent = fmt(counts.combined, 0);
    el("productUniqueCount").textContent = `Geral: ${counts.total} alvos únicos`;
    el("productButton").textContent = state.dailyProducts.length > 1 ? "Produtos do dia" : `Produto ${productId}`;
    el("colorbarQuantity").textContent = `σ⁰ ${manifest.visualization?.polarization || manifest.polarization || ""}`.trim();
    el("overlayYoloText").textContent = `YOLO: ${counts.yolo + counts.combined} alvos`;
    el("overlayAisText").textContent = "AIS: sem AIS";
    el("footerSource").textContent = `SisMOM • META 1 • Produto selecionado ${productId}`;
    el("footerCounts").innerHTML = `<i></i> CFAR: ${counts.cfar} • CFAR+YOLO: ${counts.combined} • YOLO: ${counts.yolo} • Geral: ${counts.total}`;
    el("footerAcquisition").textContent = `Aquisição ${formatDate(state.currentDate)} • UTC`;
    updateFilterButtons(counts);
  }

  function updateFilterButtons(counts = dailyCounts()) {
    const values = { all: counts.total, cfar: counts.cfar, yolo: counts.yolo, combined: counts.combined };
    document.querySelectorAll("[data-detection-filter]").forEach((button) => {
      const kind = button.dataset.detectionFilter;
      button.classList.toggle("active", kind === state.filter);
      button.innerHTML = `${KIND_LABELS[kind]} <b>${values[kind]}</b>`;
      button.setAttribute("aria-pressed", String(kind === state.filter));
    });
  }

  function setLoadingState(entries) {
    el("productHeading").textContent = `Carregando ${entries.length} produto(s)…`;
    el("productFullName").textContent = entries.map((entry) => entry.id).join(" + ");
    el("productStatus").innerHTML = "<i></i> CARREGANDO";
  }

  function productPreviewUrl(manifest, baseUrl, item) {
    const directory = String(manifest.previews?.directory || "previews").replace(/\/+$/, "");
    const pattern = String(manifest.previews?.pattern || "{patch_label}.png").replaceAll("{patch_label}", item.id);
    return absoluteUrl(`${directory === "." ? "" : `${directory}/`}${pattern}`, baseUrl);
  }

  async function loadProductData(entry, token) {
    const manifestUrl = absoluteUrl(entry.manifest), baseUrl = new URL(".", manifestUrl).toString();
    const manifest = await fetchJson(`${manifestUrl}?v=${encodeURIComponent(entry.version || Date.now())}`);
    if (!manifest.mosaic?.path || !manifest.footprint || !manifest.patches || !manifest.presentation) throw new Error(`Manifesto incompleto do produto ${entry.id}.`);
    const [footprint, patches, presentation] = await Promise.all([
      fetchJson(absoluteUrl(manifest.footprint, baseUrl)),
      fetchJson(absoluteUrl(manifest.patches, baseUrl)),
      fetchJson(absoluteUrl(manifest.presentation, baseUrl)),
    ]);
    if (token !== state.loadToken) return null;
    const patchFeatures = Array.isArray(patches?.features) ? patches.features : [];
    const patchByLabel = new Map(patchFeatures.map((feature) => [patchKey(feature.properties || {}), feature]));
    const code = String(manifest.id ?? entry.id);
    const items = (presentation.patches || []).map((source, index) => {
      const detection = source.detection || {};
      const kind = detection.kind || (detection.yoloCount ? "combined" : "cfar");
      const patchFeature = patchByLabel.get(source.id) || null;
      const bounds = normalizeBounds(source.bounds) || geometryBounds(patchFeature);
      return {
        ...source, code, entry, manifest, baseUrl, detection, kind, patchFeature, bounds,
        uid: `${code}:${source.targetLabel || source.id}:${detection.id ?? index}`,
        previewUrl: productPreviewUrl(manifest, baseUrl, source),
      };
    });
    return { code, entry, manifest, baseUrl, footprint, patches, patchFeatures, items, rasterLayer: null, footprintLayer: null, recorteLayer: null };
  }

  function removeProductLayers() {
    state.dailyProducts.forEach((product) => {
      [product.recorteLayer, product.footprintLayer, product.rasterLayer].forEach((layer) => { if (layer && state.map.hasLayer(layer)) state.map.removeLayer(layer); });
    });
  }

  function footprintStyle(product) {
    const active = product.code === state.activeProductCode;
    return { color: active ? "#ffa451" : "#31d9ef", weight: active ? 2.8 : 1.7, dashArray: active ? null : "7 5", opacity: active ? 1 : 0.9, fillOpacity: 0 };
  }

  function addProductLayers() {
    state.dailyProducts.forEach((product) => {
      const bounds = normalizeBounds(product.manifest.mosaic?.bounds);
      if (bounds) {
        product.rasterLayer = L.imageOverlay(
          absoluteUrl(product.manifest.mosaic.path, product.baseUrl),
          [[bounds.south, bounds.west], [bounds.north, bounds.east]],
          { pane: "sar-raster-pane", opacity: state.opacity, interactive: false, className: `sar-product sar-product-${product.code.toLowerCase()}` },
        ).addTo(state.map);
      }
      product.footprintLayer = L.geoJSON(product.footprint, {
        pane: "sar-outline-pane", style: () => footprintStyle(product),
        onEachFeature: (_feature, layer) => layer.bindTooltip(`Produto ${product.code}${product.code === state.activeProductCode ? " • Selecionado" : ""}`, { sticky: true, className: "map-tooltip" }),
      }).addTo(state.map);
    });
    bringActiveProductToFront();
    rebuildDetectionLayers();
  }

  function renderDailyProductSelector() {
    const container = el("dailyProductSelector"); container.replaceChildren();
    container.hidden = state.dailyProducts.length < 2;
    if (container.hidden) return;
    const title = document.createElement("span"); title.textContent = "Produtos do dia"; container.appendChild(title);
    state.dailyProducts.forEach((product) => {
      const button = document.createElement("button"); button.type = "button"; button.dataset.productCode = product.code;
      button.innerHTML = `Produto ${escapeHtml(product.code)}${product.code === state.activeProductCode ? " <b>Selecionado</b>" : ""}`;
      button.classList.toggle("active", product.code === state.activeProductCode);
      button.addEventListener("click", () => selectProduct(product.code, true));
      container.appendChild(button);
    });
  }

  function bringActiveProductToFront() {
    const product = activeProduct();
    if (product?.rasterLayer?.bringToFront) product.rasterLayer.bringToFront();
    state.dailyProducts.forEach((item) => item.footprintLayer?.setStyle(() => footprintStyle(item)));
    if (product?.footprintLayer?.bringToFront) product.footprintLayer.bringToFront();
    renderDailyProductSelector();
  }

  function unionProductBounds() {
    const valid = state.dailyProducts.map((product) => normalizeBounds(product.manifest.mosaic?.bounds)).filter(Boolean);
    if (!valid.length) return null;
    return {
      west: Math.min(...valid.map((item) => item.west)), south: Math.min(...valid.map((item) => item.south)),
      east: Math.max(...valid.map((item) => item.east)), north: Math.max(...valid.map((item) => item.north)),
    };
  }

  function setMapView(mode) {
    state.mapView = mode;
    el("zeeButton").classList.toggle("active", mode === "zee");
    el("productButton").classList.toggle("active", mode === "product");
    if (mode === "zee" && state.zeeLayer?.getBounds().isValid()) state.map.fitBounds(state.zeeLayer.getBounds(), { padding: [10, 10], animate: true });
    if (mode === "product") {
      const bounds = unionProductBounds();
      if (bounds) state.map.fitBounds([[bounds.south, bounds.west], [bounds.north, bounds.east]], { padding: [18, 18], animate: true });
    }
  }

  function dominantKind(items) {
    if (items.some((item) => item.kind === "combined")) return "combined";
    if (items.some((item) => item.kind === "yolo")) return "yolo";
    return "cfar";
  }

  function rebuildDetectionLayers() {
    state.dailyProducts.forEach((product) => {
      if (product.recorteLayer && state.map.hasLayer(product.recorteLayer)) state.map.removeLayer(product.recorteLayer);
      const items = state.filteredItems.filter((item) => item.code === product.code);
      const byPatch = new Map();
      items.forEach((item) => { const list = byPatch.get(item.id) || []; list.push(item); byPatch.set(item.id, list); });
      const features = product.patchFeatures.filter((feature) => byPatch.has(patchKey(feature.properties || {})));
      product.recorteLayer = L.geoJSON({ type: "FeatureCollection", features }, {
        pane: "sar-box-pane",
        style: (feature) => {
          const label = patchKey(feature.properties || {}), patchItems = byPatch.get(label) || [];
          const selected = state.filteredItems[state.currentIndex];
          const current = selected?.code === product.code && selected?.id === label;
          const kind = dominantKind(patchItems);
          return { color: current ? "#ffa451" : KIND_COLORS[kind], weight: current ? 3.1 : 1.7, opacity: 1, fillColor: current ? "#ffa451" : KIND_COLORS[kind], fillOpacity: current ? 0.12 : 0.035 };
        },
        onEachFeature: (feature, layer) => {
          const label = patchKey(feature.properties || {}), patchItems = byPatch.get(label) || [];
          const summary = { cfar: 0, yolo: 0, combined: 0 };
          patchItems.forEach((item) => { summary[item.kind] += 1; });
          layer.bindTooltip(`<strong>Produto ${escapeHtml(product.code)} · ${escapeHtml(label)}</strong><br>${summary.cfar} CFAR · ${summary.combined} CFAR+YOLO · ${summary.yolo} YOLO`, { sticky: true, className: "map-tooltip" });
          layer.on("click", () => {
            const index = state.filteredItems.findIndex((item) => item.code === product.code && item.id === label);
            if (index >= 0) selectItem(index);
          });
        },
      }).addTo(state.map);
    });
    bringActiveProductToFront();
    state.dailyProducts.forEach((product) => product.recorteLayer?.bringToFront?.());
  }

  function applyFilter(kind) {
    state.filter = kind;
    state.filteredItems = kind === "all" ? [...state.allItems] : state.allItems.filter((item) => item.kind === kind);
    updateFilterButtons();
    const firstActive = state.filteredItems.findIndex((item) => item.code === state.activeProductCode);
    state.currentIndex = firstActive >= 0 ? firstActive : 0;
    rebuildDetectionLayers();
    if (state.filteredItems.length) selectItem(state.currentIndex); else { renderEmpty(); resetTimer(); }
  }

  function selectProduct(code, userInitiated = false) {
    if (!state.dailyProducts.some((product) => product.code === code)) return;
    state.activeProductCode = code;
    bringActiveProductToFront(); updateHeader();
    const next = state.filteredItems.findIndex((item) => item.code === code);
    if (next >= 0) selectItem(next); else { rebuildDetectionLayers(); renderEmpty(`O produto ${code} não possui alvos na camada ${KIND_LABELS[state.filter]}.`); }
    if (userInitiated && window.Shiny?.setInputValue) window.Shiny.setInputValue("selected_product", code, { priority: "event" });
  }

  function framePosition(item) {
    const detection = item.detection || {}, bounds = item.bounds;
    let left = numberOrNull(detection.frameX), top = numberOrNull(detection.frameY);
    if ((left === null || top === null) && bounds) {
      const lon = numberOrNull(detection.lon), lat = numberOrNull(detection.lat);
      if (lon !== null && lat !== null) {
        left = ((lon - bounds.west) / (bounds.east - bounds.west)) * 100;
        top = ((bounds.north - lat) / (bounds.north - bounds.south)) * 100;
      }
    }
    if (left === null || top === null) return null;
    return { left: Math.max(1.6, Math.min(98.4, left)), top: Math.max(1.6, Math.min(98.4, top)) };
  }

  function renderPreviewFrames(current) {
    const container = el("detectionFrames"); container.replaceChildren();
    const samePatch = state.filteredItems.filter((item) => item.code === current.code && item.id === current.id);
    samePatch.forEach((item) => {
      const position = framePosition(item); if (!position) return;
      const frame = document.createElement("span");
      frame.className = `detection-frame ${item.kind}${item.uid === current.uid ? " current" : ""}`;
      frame.style.left = `${position.left}%`; frame.style.top = `${position.top}%`;
      frame.title = `${item.targetLabel || item.id} • ${KIND_LABELS[item.kind]}`;
      container.appendChild(frame);
    });
  }

  function renderEmpty(message = "Nenhuma detecção disponível para este filtro.") {
    el("patchPill").textContent = "—"; el("patchCounter").textContent = `0 de ${state.filteredItems.length}`;
    const image = el("sarImage"); image.hidden = true; image.src = transparentPixel;
    el("detectionFrames").replaceChildren();
    const previewMessage = el("previewMessage"); previewMessage.hidden = false; previewMessage.textContent = message;
    ["latNorth", "latMid", "latSouth", "lonWest", "lonMid", "lonEast", "infoPatch", "infoFile", "infoCfarStatus", "infoSize", "infoArea", "infoCrs", "infoSnap", "detLat", "detLon", "detArea", "detPeak", "detThreshold", "detLength"].forEach((id) => { el(id).textContent = "—"; });
    el("detectionCountBadge").textContent = "0 alvos"; el("detYolo").textContent = "Sem dados"; el("detAis").textContent = "Sem AIS";
  }

  function renderItem() {
    const item = state.filteredItems[state.currentIndex]; if (!item) { renderEmpty(); return; }
    if (state.activeProductCode !== item.code) {
      state.activeProductCode = item.code; bringActiveProductToFront(); updateHeader();
    }
    const detection = item.detection || {}, manifest = item.manifest;
    el("patchPill").textContent = `${item.id}${item.targetLabel ? ` · ${item.targetLabel}` : ""}`;
    el("patchCounter").textContent = `${state.currentIndex + 1} de ${state.filteredItems.length}`;

    const image = el("sarImage"), message = el("previewMessage");
    image.hidden = false; message.hidden = true;
    image.onload = () => {
      if (image.naturalWidth && image.naturalHeight) el("sarImageWrap").style.aspectRatio = `${image.naturalWidth} / ${image.naturalHeight}`;
      image.hidden = false; message.hidden = true; renderPreviewFrames(item);
    };
    image.onerror = () => { image.hidden = true; el("detectionFrames").replaceChildren(); message.hidden = false; message.textContent = `Preview não encontrado para ${item.code} · ${item.id}.`; };
    image.src = `${item.previewUrl}?v=${encodeURIComponent(item.entry?.version || "1")}`;
    image.alt = `Recorte SAR ${item.code} · ${item.id} geograficamente orientado`;
    renderPreviewFrames(item);

    const bounds = item.bounds;
    if (bounds) {
      el("latNorth").textContent = `${fmt(bounds.north, 4)}°`; el("latMid").textContent = `${fmt((bounds.north + bounds.south) / 2, 4)}°`; el("latSouth").textContent = `${fmt(bounds.south, 4)}°`;
      el("lonWest").textContent = `${fmt(bounds.west, 4)}°`; el("lonMid").textContent = `${fmt((bounds.west + bounds.east) / 2, 4)}°`; el("lonEast").textContent = `${fmt(bounds.east, 4)}°`;
    }
    const width = numberOrNull(item.width), height = numberOrNull(item.height), spacing = numberOrNull(manifest.pixel_spacing_m) || 10;
    el("infoPatch").textContent = `${item.code} · ${item.id}`;
    el("infoFile").textContent = item.geotiff || "—";
    el("infoCfarStatus").textContent = KIND_LABELS[item.kind]; el("infoCfarStatus").className = `status-inline ${item.kind}`;
    el("infoSize").textContent = width !== null && height !== null ? `${width} × ${height} px` : "—";
    if (width !== null && height !== null) {
      const widthKm = width * spacing / 1000, heightKm = height * spacing / 1000;
      el("infoArea").textContent = `Área total: ${fmt(widthKm, 1)} × ${fmt(heightKm, 1)} = ${fmt(widthKm * heightKm, 2)} km²`;
    } else el("infoArea").textContent = "—";
    el("infoCrs").textContent = manifest.visualization?.crs || manifest.mosaic?.crs || "EPSG:4326";
    el("infoSnap").textContent = numberOrNull(item.snapTime) === null ? "—" : `${fmt(item.snapTime, 3)} s`;
    const samePatch = state.filteredItems.filter((other) => other.code === item.code && other.id === item.id);
    el("detectionCountBadge").textContent = pluralTargets(samePatch.length);
    el("detLat").textContent = fmt(detection.lat, 6); el("detLon").textContent = fmt(detection.lon, 6);
    el("detArea").textContent = numberOrNull(detection.area) === null ? "—" : `${fmt(detection.area, 0)} px`;
    el("detPeak").textContent = numberOrNull(detection.peak) === null ? "—" : `${fmt(detection.peak, 2)} dB`;
    el("detThreshold").textContent = numberOrNull(detection.threshold) === null ? "—" : `${fmt(detection.threshold, 2)} dB`;
    el("detLength").textContent = detection.length || "não estimado";
    el("detYolo").textContent = item.kind === "combined" ? `Correspondência${numberOrNull(detection.yoloConfidence) !== null ? ` • ${fmt(detection.yoloConfidence * 100, 1)}%` : ""}` : item.kind === "yolo" ? `YOLO${numberOrNull(detection.yoloConfidence) !== null ? ` • ${fmt(detection.yoloConfidence * 100, 1)}%` : ""}` : "Sem correspondência";
    el("detYolo").className = `badge ${item.kind === "cfar" ? "cfar" : "yolo"}`;
    el("detAis").textContent = "Sem AIS";
    rebuildDetectionLayers();
    if (window.Shiny?.setInputValue) window.Shiny.setInputValue("selected_patch", `${item.code}:${item.id}:${item.targetLabel || ""}`, { priority: "event" });
  }

  function resetTimer() {
    window.clearTimeout(state.timer);
    if (state.filteredItems.length > 1) state.timer = window.setTimeout(() => selectItem(state.currentIndex + 1), autoIntervalMs);
  }
  function selectItem(index) {
    if (!state.filteredItems.length) { renderEmpty(); resetTimer(); return; }
    state.currentIndex = (index + state.filteredItems.length) % state.filteredItems.length;
    renderItem(); resetTimer();
  }

  async function loadDate(isoDate, preferredCode = null) {
    const entries = productsForDate(isoDate); if (!entries.length) return;
    const token = ++state.loadToken; setLoadingState(entries); hideAlert(); window.clearTimeout(state.timer);
    try {
      const products = (await Promise.all(entries.map((entry) => loadProductData(entry, token)))).filter(Boolean);
      if (token !== state.loadToken) return;
      removeProductLayers();
      state.currentDate = isoDate; state.dailyProducts = products;
      state.activeProductCode = products.some((product) => product.code === preferredCode) ? preferredCode : products[0].code;
      state.allItems = products.flatMap((product) => product.items);
      state.calendarMonth = monthStart(dateFromIso(isoDate) || new Date());
      addProductLayers(); renderCalendar(); updateHeader();
      applyFilter(state.filter); setMapView("product"); hideAlert();
      if (window.Shiny?.setInputValue) window.Shiny.setInputValue("selected_product", state.activeProductCode, { priority: "event" });
    } catch (error) {
      if (token !== state.loadToken) return; console.error(error);
      showAlert(`Não foi possível carregar os produtos de ${formatDate(isoDate)}: ${error.message}`);
      el("productStatus").innerHTML = "<i></i> ERRO";
    }
  }

  function clearViewerForNoProducts() {
    removeProductLayers(); state.currentDate = null; state.dailyProducts = []; state.allItems = []; state.filteredItems = [];
    renderCalendar(); renderEmpty("Adicione uma pasta com product.json em www/data/products.");
    el("productHeading").textContent = "Nenhum produto válido encontrado";
    el("productFullName").textContent = "Adicione uma pasta com product.json em www/data/products.";
    el("productStatus").innerHTML = "<i></i> SEM PRODUTO";
    showAlert("Nenhum produto válido foi encontrado em www/data/products.", "warning");
  }

  function updateCatalog(payload) {
    const next = normalizeCatalog(payload), fingerprint = catalogFingerprint(next);
    if (fingerprint === state.catalogFingerprint) return;
    const previousDate = state.currentDate, previousCode = state.activeProductCode;
    state.catalog = next; state.catalogFingerprint = fingerprint; renderCalendar();
    if (!state.catalog.length) { clearViewerForNoProducts(); return; }
    if (previousDate && productsForDate(previousDate).length) { loadDate(previousDate, previousCode); return; }
    const preferred = state.catalog.find((entry) => entry.id === state.defaultProductId) || state.catalog[0];
    loadDate(preferred.date, preferred.id);
  }

  async function initializeMap() {
    state.map = L.map("zeeMap", { zoomControl: false, preferCanvas: true, minZoom: 2, maxZoom: 11, zoomSnap: 0.1, zoomDelta: 0.5, attributionControl: true });
    const zoomControl = L.control.zoom({ position: "topright" }).addTo(state.map);
    const zoomContainer = zoomControl.getContainer();
    zoomContainer?.classList.add("sismom-zoom-control");
    zoomContainer?.setAttribute("aria-label", "Controles de zoom do mapa");
    const mapBase = L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", { attribution: "&copy; OpenStreetMap &copy; CARTO", subdomains: "abcd", maxZoom: 20, className: "basemap-map" });
    const satellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { attribution: "Tiles &copy; Esri", maxZoom: 20, maxNativeZoom: 19, className: "basemap-satellite" }).addTo(state.map);
    const layerControl = L.control.layers({ "Satélite": satellite, "Mapa": mapBase }, null, { position: "bottomleft", collapsed: true }).addTo(state.map);
    const layerContainer = layerControl.getContainer();
    layerContainer?.classList.add("sismom-layer-control");
    layerContainer?.setAttribute("aria-label", "Selecionar camada de fundo do mapa");
    state.map.createPane("sar-raster-pane").style.zIndex = "330";
    state.map.createPane("sar-outline-pane").style.zIndex = "390";
    state.map.createPane("sar-box-pane").style.zIndex = "430";
    try {
      const zee = await fetchJson("data/zee-amazonia-azul.geojson");
      state.zeeLayer = L.geoJSON(zee, {
        style: (feature) => { const pce = feature.properties?.name === "PCE"; return { color: pce ? "#ffe071" : "#31d9ef", weight: pce ? 2.15 : 1.75, dashArray: pce ? "7 5" : null, opacity: 1, fillColor: pce ? "#e6aa28" : "#087f8c", fillOpacity: pce ? 0.13 : 0.12 }; },
        onEachFeature: (feature, layer) => layer.bindTooltip(feature.properties?.label || "Zona Econômica Exclusiva", { sticky: true, className: "map-tooltip" }),
      }).addTo(state.map);
      state.map.setView([-10, -40], 3);
    } catch (error) { console.error(error); showAlert(`A camada ZEE/PCE não foi carregada: ${error.message}`, "warning"); state.map.setView([-10, -40], 3); }
    window.setTimeout(() => state.map.invalidateSize(), 80);
  }

  function initializeEvents() {
    el("previousButton").addEventListener("click", () => selectItem(state.currentIndex - 1));
    el("nextButton").addEventListener("click", () => selectItem(state.currentIndex + 1));
    el("zeeButton").addEventListener("click", () => setMapView("zee"));
    el("productButton").addEventListener("click", () => setMapView("product"));
    document.querySelectorAll("[data-detection-filter]").forEach((button) => button.addEventListener("click", () => applyFilter(button.dataset.detectionFilter)));
    el("sarOpacity").addEventListener("input", (event) => {
      state.opacity = Number(event.target.value) / 100;
      el("sarOpacityValue").textContent = `${event.target.value}%`;
      state.dailyProducts.forEach((product) => product.rasterLayer?.setOpacity(state.opacity));
    });
    el("acquisitionDateButton").addEventListener("click", () => {
      const calendar = el("acquisitionCalendar"), willOpen = calendar.hidden;
      calendar.hidden = !willOpen; el("acquisitionDateButton").setAttribute("aria-expanded", String(willOpen)); if (willOpen) renderCalendar();
    });
    el("calendarPreviousMonth").addEventListener("click", () => { state.calendarMonth = addMonths(state.calendarMonth, -1); renderCalendar(); });
    el("calendarNextMonth").addEventListener("click", () => { state.calendarMonth = addMonths(state.calendarMonth, 1); renderCalendar(); });
    document.addEventListener("pointerdown", (event) => { if (!el("acquisitionKpi").contains(event.target)) closeCalendar(); });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") { closeCalendar(); el("acquisitionDateButton").focus(); } });
    el("fullscreenButton").addEventListener("click", async () => { if (!document.fullscreenElement) await el("dashboardFrame").requestFullscreen(); else await document.exitFullscreen(); });
  }

  function registerShinyHandler() {
    const register = () => {
      if (!window.Shiny || typeof window.Shiny.addCustomMessageHandler !== "function") return false;
      window.Shiny.addCustomMessageHandler("sismom_catalog", updateCatalog); return true;
    };
    if (!register()) document.addEventListener("shiny:connected", register, { once: true });
  }

  async function initialize() {
    initializeEvents(); registerShinyHandler(); updateClock(); window.setInterval(updateClock, 1000);
    await initializeMap(); updateCatalog({ products: CONFIG.catalog || [], default_product_id: CONFIG.default_product_id });
  }
  initialize().catch((error) => { console.error(error); showAlert(`Falha ao iniciar o visualizador: ${error.message}`); });
})();
