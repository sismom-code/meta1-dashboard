(function () {
  "use strict";

  const CONFIG = window.SISMOM_CONFIG || {};
  const autoIntervalMs = Number(CONFIG.auto_interval_ms || 10000);
  const transparentPixel = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

  const state = {
    catalog: [], catalogFingerprint: "", defaultProductId: String(CONFIG.default_product_id || ""),
    currentEntry: null, currentProduct: null, currentIndex: 0, items: [], patchFeatures: null,
    timer: null, loadToken: 0, calendarMonth: null,
    map: null, zeeLayer: null, productLayer: null, rasterLayer: null, recorteLayer: null, labelLayer: null
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
  const absoluteUrl = (path, base = document.baseURI) => new URL(path, base).toString();

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
    return { w: Math.min(...xs), s: Math.min(...ys), e: Math.max(...xs), n: Math.max(...ys) };
  }
  function normalizeBounds(raw) {
    if (!raw || typeof raw !== "object") return null;
    const w = numberOrNull(raw.w ?? raw.west), s = numberOrNull(raw.s ?? raw.south);
    const e = numberOrNull(raw.e ?? raw.east), n = numberOrNull(raw.n ?? raw.north);
    if ([w, s, e, n].some((value) => value === null) || w >= e || s >= n) return null;
    return { w, s, e, n };
  }
  function detectionCenter(feature) {
    const props = feature?.properties || {};
    let lon = numberOrNull(props.map_centroid_lon ?? props.visual_centroid_lon ?? props.longitude);
    let lat = numberOrNull(props.map_centroid_lat ?? props.visual_centroid_lat ?? props.latitude);
    if ((lon === null || lat === null) && Array.isArray(props.centroid) && props.centroid.length >= 2) {
      lon = numberOrNull(props.centroid[0]); lat = numberOrNull(props.centroid[1]);
    }
    if (lon === null || lat === null) {
      const bounds = geometryBounds(feature);
      if (bounds) { lon = (bounds.w + bounds.e) / 2; lat = (bounds.s + bounds.n) / 2; }
    }
    return lon === null || lat === null ? null : { lon, lat };
  }
  function patchKey(properties) {
    if (properties?.patch_label) return String(properties.patch_label);
    const number = numberOrNull(properties?.patch_number);
    return number === null ? "" : `P${String(number).padStart(3, "0")}`;
  }

  function buildItems(manifest, baseUrl, patchesGeoJson, detectionsGeoJson) {
    const patches = Array.isArray(patchesGeoJson?.features) ? patchesGeoJson.features : [];
    const detections = Array.isArray(detectionsGeoJson?.features) ? detectionsGeoJson.features : [];
    const patchByLabel = new Map(), patchByNumber = new Map(), counts = new Map();
    patches.forEach((feature) => {
      const props = feature?.properties || {}, label = patchKey(props), number = numberOrNull(props.patch_number);
      if (label) patchByLabel.set(label, feature); if (number !== null) patchByNumber.set(number, feature);
    });
    detections.forEach((feature) => {
      const label = patchKey(feature?.properties || {}); counts.set(label, (counts.get(label) || 0) + 1);
    });
    const previewDir = String(manifest.previews?.directory || "previews").replace(/\/+$/, "");
    const previewPattern = String(manifest.previews?.pattern || "{patch_label}.png");
    return detections.map((detection, detectionIndex) => {
      const props = detection?.properties || {};
      const patchNumber = numberOrNull(props.patch_number ?? props.patch_id);
      const label = patchKey(props) || (patchNumber === null ? `DET${detectionIndex + 1}` : `P${String(patchNumber).padStart(3, "0")}`);
      const patchFeature = patchByLabel.get(label) || patchByNumber.get(patchNumber) || null;
      const patchProps = patchFeature?.properties || {};
      const bounds = normalizeBounds(props.display_bounds_lonlat) || normalizeBounds(props.geolocation_grid_bounds_lonlat) || normalizeBounds(props.geotiff_bounds_lonlat) || geometryBounds(patchFeature);
      const previewFile = previewPattern.replaceAll("{patch_label}", label);
      return {
        id: label, patchNumber, patchFeature, patchProperties: patchProps, detection, properties: props,
        center: detectionCenter(detection), bounds,
        previewUrl: absoluteUrl(`${previewDir}/${previewFile}`, baseUrl),
        patchDetectionCount: counts.get(label) || 1, detectionIndex
      };
    }).sort((a, b) => (a.patchNumber ?? Number.MAX_SAFE_INTEGER) - (b.patchNumber ?? Number.MAX_SAFE_INTEGER) || a.detectionIndex - b.detectionIndex);
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
  const productsForDate = (isoDate) => state.catalog.filter((entry) => entry.date === isoDate);

  function renderProductSelector() {
    const select = el("productSelect"); select.replaceChildren();
    state.catalog.forEach((entry) => {
      const option = document.createElement("option");
      option.value = `${entry.id}|${entry.manifest}`;
      option.textContent = `${formatDate(entry.date)} • ${entry.id} • ${entry.name}`; option.title = entry.name;
      select.appendChild(option);
    });
    select.hidden = state.catalog.length <= 1;
    if (state.currentEntry) select.value = `${state.currentEntry.id}|${state.currentEntry.manifest}`;
  }

  function renderCalendar() {
    const days = el("calendarDays"); days.replaceChildren();
    if (!state.catalog.length) {
      el("calendarMonthLabel").textContent = "Sem produtos";
      el("calendarPreviousMonth").disabled = true; el("calendarNextMonth").disabled = true; return;
    }
    if (!state.calendarMonth) {
      const selected = dateFromIso(state.currentEntry?.date || state.catalog[0].date);
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
      if (state.currentEntry?.date === iso) button.classList.add("selected");
      button.addEventListener("click", () => { closeCalendar(); loadProduct(available.find((entry) => entry.id === state.currentEntry?.id) || available[0]); });
      days.appendChild(button);
    }
    const dates = state.catalog.map((entry) => dateFromIso(entry.date)).filter(Boolean);
    const minMonth = Math.min(...dates.map((date) => monthValue(monthStart(date))));
    const maxMonth = Math.max(...dates.map((date) => monthValue(monthStart(date))));
    el("calendarPreviousMonth").disabled = monthValue(addMonths(state.calendarMonth, -1)) < minMonth;
    el("calendarNextMonth").disabled = monthValue(addMonths(state.calendarMonth, 1)) > maxMonth;
  }
  function closeCalendar() { el("acquisitionCalendar").hidden = true; el("acquisitionDateButton").setAttribute("aria-expanded", "false"); }

  function setLoadingState(entry) {
    el("productHeading").textContent = `Carregando produto ${entry.id}…`;
    el("productFullName").textContent = entry.name || "—";
    el("productStatus").innerHTML = "<i></i> CARREGANDO";
  }

  function updateHeader(manifest, detectionCount) {
    const productId = String(manifest.id ?? manifest.arquivo_id ?? "—");
    const start = manifest.start_utc, end = manifest.end_utc || start;
    const yoloTotal = Number(manifest.yolo?.total_detections || 0), aisTotal = Number(manifest.ais?.total_correlations || 0);
    el("productSatelliteLabel").textContent = `PRODUTO SAR — ${String(manifest.satellite || "SATÉLITE").toUpperCase()}`;
    el("productHeading").textContent = `Produto processado • arquivo ${productId}`;
    el("productFullName").textContent = manifest.name || "—";
    el("productStatus").innerHTML = `<i></i> ${escapeHtml(statusLabel(manifest.status, "PROCESSADO"))}`;
    el("acquisitionDateValue").textContent = formatDate(manifest.date);
    el("productTimeUtc").textContent = `${formatTime(start)}–${formatTime(end)}`;
    el("productTimeBrt").textContent = `Brasília: ${formatTime(start, "America/Sao_Paulo")}–${formatTime(end, "America/Sao_Paulo")} BRT`;
    el("productMode").textContent = manifest.mode || "—"; el("productPolarization").textContent = manifest.polarization || "—";
    el("productPatchCount").textContent = fmt(manifest.total_patches, 0); el("productDetectionCount").textContent = fmt(detectionCount, 0);
    el("productButton").textContent = `Produto ${productId}`;
    el("colorbarQuantity").textContent = `σ⁰ ${manifest.visualization?.polarization || manifest.polarization || ""}`.trim();
    el("overlayYoloText").textContent = `YOLO: ${statusLabel(manifest.yolo?.status, "SEM DADOS").toLowerCase()}`;
    el("overlayAisText").textContent = `AIS: ${statusLabel(manifest.ais?.status, "SEM AIS").toLowerCase()}`;
    el("detYolo").textContent = yoloTotal ? `${yoloTotal} detecções` : "Sem dados";
    el("detAis").textContent = aisTotal ? `${aisTotal} correlações` : "Sem AIS";
    el("footerSource").textContent = `SisMOM • META 1 • Produto fonte ${productId}`;
    el("footerCounts").innerHTML = `<i></i> CFAR: ${detectionCount} • YOLO: ${yoloTotal} • AIS: ${aisTotal || "sem dados"}`;
    el("footerAcquisition").textContent = `${manifest.satellite || "—"} • ${manifest.mode || "—"} • ${manifest.polarization || "—"} • ${formatDate(manifest.date)} ${formatTime(start).slice(0, 5)} UTC`;
  }

  function clearProductLayers() {
    ["rasterLayer", "productLayer", "recorteLayer", "labelLayer"].forEach((key) => { if (state[key]) { state[key].remove(); state[key] = null; } });
  }
  function setProductLayers(manifest, baseUrl, footprint, patchesGeoJson) {
    if (!state.map) return;
    clearProductLayers();
    const bounds = normalizeBounds(manifest.mosaic?.bounds);
    if (!bounds) throw new Error("O produto não possui limites válidos para o mosaico.");
    state.rasterLayer = L.imageOverlay(absoluteUrl(manifest.mosaic.path, baseUrl), [[bounds.s, bounds.w], [bounds.n, bounds.e]], { opacity: 1, pane: "sar-raster-pane", className: "sar-product-raster", interactive: false }).addTo(state.map);
    const productId = String(manifest.id ?? manifest.arquivo_id ?? "—");
    state.productLayer = L.geoJSON(footprint, {
      style: { color: "#ffa451", weight: 3.8, opacity: 1, fillColor: "#ffa451", fillOpacity: 0.035, className: "sar-product-footprint" },
      onEachFeature: (_, layer) => layer.bindTooltip(`<strong>Footprint completo — Produto SAR ${escapeHtml(productId)}</strong><br>${escapeHtml(manifest.satellite || "")} · cobertura integral da aquisição`, { sticky: true, className: "map-tooltip" })
    }).addTo(state.map);
    state.patchFeatures = patchesGeoJson; rebuildDetectionLayer(); setMapView("product");
  }

  function rebuildDetectionLayer() {
    if (!state.map || !state.patchFeatures) return;
    if (state.recorteLayer) state.recorteLayer.remove(); if (state.labelLayer) state.labelLayer.remove();
    const selectedPatch = state.items[state.currentIndex]?.patchNumber;
    const counts = new Map();
    state.items.forEach((item) => { const key = item.patchNumber ?? item.id; counts.set(key, (counts.get(key) || 0) + 1); });
    state.recorteLayer = L.geoJSON(state.patchFeatures, {
      filter: (feature) => { const props = feature?.properties || {}; const key = numberOrNull(props.patch_number) ?? patchKey(props); return counts.has(key) || Boolean(props.has_cfar_detection); },
      style: (feature) => { const number = numberOrNull(feature?.properties?.patch_number), active = number !== null && number === selectedPatch; return { color: active ? "#ffa451" : "#45ec8b", weight: active ? 3 : 2.25, opacity: 1, fillColor: active ? "#ffa451" : "#45ec8b", fillOpacity: active ? 0.28 : 0.16 }; },
      onEachFeature: (feature, layer) => {
        const props = feature?.properties || {}, label = patchKey(props) || "Recorte", number = numberOrNull(props.patch_number), count = counts.get(number ?? label) || 0;
        layer.bindTooltip(`<strong>${escapeHtml(label)}</strong><br>${pluralTargets(count)} CFAR`, { sticky: true, className: "map-tooltip" });
        layer.on("click", () => { const index = state.items.findIndex((item) => item.patchNumber === number || item.id === label); if (index >= 0) selectItem(index); });
      }
    }).addTo(state.map);
    state.labelLayer = L.layerGroup().addTo(state.map);
    const labeled = new Set();
    state.items.forEach((item) => {
      if (!item.center || labeled.has(item.id)) return; labeled.add(item.id);
      L.marker([item.center.lat, item.center.lon], { icon: L.divIcon({ className: "map-patch-label", html: `<span>${escapeHtml(item.id)}</span>`, iconSize: [38, 18], iconAnchor: [19, 23] }), interactive: false }).addTo(state.labelLayer);
    });
  }

  function setMapView(mode) {
    if (!state.map) return;
    const productMode = mode === "product";
    el("productButton").classList.toggle("active", productMode); el("zeeButton").classList.toggle("active", !productMode);
    const layer = productMode ? state.productLayer : state.zeeLayer;
    if (!layer || typeof layer.getBounds !== "function") return;
    const bounds = layer.getBounds(); if (!bounds.isValid()) return;
    state.map.fitBounds(bounds, { padding: [10, 10], maxZoom: productMode ? 8 : 4, animate: false });
  }

function frameStyle(item) {
  if (!item.center || !item.bounds) return null;

  const left =
    ((item.center.lon - item.bounds.w) /
      (item.bounds.e - item.bounds.w)) * 100;

  const top =
    ((item.bounds.n - item.center.lat) /
      (item.bounds.n - item.bounds.s)) * 100;

  return {
    left: Math.min(100, Math.max(0, left)),
    top: Math.min(100, Math.max(0, top)),

    // Tamanho visual fixo do box verde
    width: 10,
    height: 10
  };
}

  function renderEmpty() {
    window.clearTimeout(state.timer);
    el("patchPill").textContent = "—"; el("patchCounter").textContent = "0 de 0";
    el("sarImage").hidden = true; el("sarImage").src = transparentPixel; el("detectionFrame").hidden = true;
    el("previewMessage").hidden = false; el("previewMessage").textContent = "Este produto não possui detecções CFAR publicadas.";
    ["latNorth", "latMid", "latSouth", "lonWest", "lonMid", "lonEast", "infoPatch", "infoFile", "infoSize", "infoArea", "infoCrs", "infoSnap", "detLat", "detLon", "detArea", "detPeak", "detThreshold", "detLength"].forEach((id) => { el(id).textContent = "—"; });
    el("infoCfarStatus").textContent = "● SEM DETECÇÕES"; el("detectionCountBadge").textContent = "0 alvos";
  }

  function renderItem() {
    if (!state.items.length) { renderEmpty(); return; }
    const item = state.items[state.currentIndex], props = item.properties, patchProps = item.patchProperties, manifest = state.currentProduct;
    const width = numberOrNull(props.raster_width ?? patchProps.raster_width), height = numberOrNull(props.raster_height ?? patchProps.raster_height);
    const spacing = numberOrNull(manifest.pixel_spacing_m) || 10;
    const snap = numberOrNull(manifest.patch_metadata?.[item.id]?.snap_seconds ?? props.snap_seconds);
    el("patchPill").textContent = item.id; el("patchCounter").textContent = `${state.currentIndex + 1} de ${state.items.length}`;

    const image = el("sarImage"), message = el("previewMessage"), frame = el("detectionFrame"), style = frameStyle(item);
    image.hidden = false; message.hidden = true;
    image.onload = () => { if (image.naturalWidth && image.naturalHeight) el("sarImageWrap").style.aspectRatio = `${image.naturalWidth} / ${image.naturalHeight}`; image.hidden = false; message.hidden = true; };
    image.onerror = () => { image.hidden = true; frame.hidden = true; message.hidden = false; message.textContent = `Preview não encontrado para ${item.id}.`; };
    image.src = `${item.previewUrl}?v=${encodeURIComponent(state.currentEntry?.version || "1")}`; image.alt = `Recorte SAR ${item.id} geograficamente orientado`;
    if (style) { frame.hidden = false; frame.style.left = `${style.left}%`; frame.style.top = `${style.top}%`; frame.style.width = `${style.width}%`; frame.style.height = `${style.height}%`; } else frame.hidden = true;

    const b = item.bounds;
    if (b) {
      el("latNorth").textContent = `${fmt(b.n, 4)}°`; el("latMid").textContent = `${fmt((b.n + b.s) / 2, 4)}°`; el("latSouth").textContent = `${fmt(b.s, 4)}°`;
      el("lonWest").textContent = `${fmt(b.w, 4)}°`; el("lonMid").textContent = `${fmt((b.w + b.e) / 2, 4)}°`; el("lonEast").textContent = `${fmt(b.e, 4)}°`;
    }
    el("infoPatch").textContent = item.id; el("infoFile").textContent = props.recorte_arquivo_id ?? props.arquivo_id ?? "—";
    el("infoCfarStatus").textContent = `● ${statusLabel(props.cfar_status || manifest.cfar?.status, "CONCLUÍDO")}`;
    el("infoSize").textContent = width !== null && height !== null ? `${width} × ${height} px` : "—";
    if (width !== null && height !== null) {
      const widthKm = width * spacing / 1000, heightKm = height * spacing / 1000;
      el("infoArea").textContent = `Área total: ${fmt(widthKm, 1)} × ${fmt(heightKm, 1)} = ${fmt(widthKm * heightKm, 2)} km²`;
    } else el("infoArea").textContent = "—";
    el("infoCrs").textContent = props.raster_crs || manifest.visualization?.crs || manifest.mosaic?.crs || "—";
    el("infoSnap").textContent = snap === null ? "—" : `${fmt(snap, 3)} s`;
    el("detectionCountBadge").textContent = pluralTargets(item.patchDetectionCount);
    el("detLat").textContent = item.center ? fmt(item.center.lat, 6) : "—"; el("detLon").textContent = item.center ? fmt(item.center.lon, 6) : "—";
    el("detArea").textContent = numberOrNull(props.area) === null ? "—" : `${fmt(props.area, 0)} ${props.area_unit || "px"}`;
    el("detPeak").textContent = numberOrNull(props.max_sigma0_dB ?? props.score) === null ? "—" : `${fmt(props.max_sigma0_dB ?? props.score, 2)} dB`;
    el("detThreshold").textContent = numberOrNull(props.threshold_cfar_dB) === null ? "—" : `${fmt(props.threshold_cfar_dB, 2)} dB`;
    const length = props.vessel_length_estimate_label || "—", confidence = props.vessel_length_estimate_confidence;
    el("detLength").textContent = confidence ? `${length} · ${confidence}` : length;
    rebuildDetectionLayer();
    if (window.Shiny && typeof window.Shiny.setInputValue === "function") window.Shiny.setInputValue("selected_patch", item.id, { priority: "event" });
  }

  function resetTimer() { window.clearTimeout(state.timer); if (state.items.length > 1) state.timer = window.setTimeout(() => selectItem(state.currentIndex + 1), autoIntervalMs); }
  function selectItem(index) { if (!state.items.length) { renderEmpty(); return; } state.currentIndex = (index + state.items.length) % state.items.length; renderItem(); resetTimer(); }

  async function loadProduct(entry) {
    if (!entry) return;
    const token = ++state.loadToken; setLoadingState(entry); hideAlert(); window.clearTimeout(state.timer);
    try {
      const manifestUrl = absoluteUrl(entry.manifest), baseUrl = new URL(".", manifestUrl).toString();
      const manifest = await fetchJson(`${manifestUrl}?v=${encodeURIComponent(entry.version || Date.now())}`);
      const cfarPath = manifest.detections?.cfar_geojson || manifest.cfar_geojson;
      if (!manifest.mosaic?.path || !manifest.footprint || !manifest.patches || !cfarPath) throw new Error("O product.json não contém todos os caminhos obrigatórios.");
      const [footprint, patches, detections] = await Promise.all([
        fetchJson(absoluteUrl(manifest.footprint, baseUrl)), fetchJson(absoluteUrl(manifest.patches, baseUrl)), fetchJson(absoluteUrl(cfarPath, baseUrl))
      ]);
      if (token !== state.loadToken) return;
      state.currentEntry = entry; state.currentProduct = manifest; state.currentIndex = 0;
      state.items = buildItems(manifest, baseUrl, patches, detections); state.patchFeatures = patches;
      state.calendarMonth = monthStart(dateFromIso(manifest.date) || new Date());
      updateHeader(manifest, detections.features?.length || 0); setProductLayers(manifest, baseUrl, footprint, patches);
      renderProductSelector(); renderCalendar(); selectItem(0); hideAlert();
      if (window.Shiny && typeof window.Shiny.setInputValue === "function") window.Shiny.setInputValue("selected_product", String(manifest.id ?? manifest.arquivo_id), { priority: "event" });
    } catch (error) {
      if (token !== state.loadToken) return; console.error(error);
      showAlert(`Não foi possível carregar o produto ${entry.id}: ${error.message}`); el("productStatus").innerHTML = "<i></i> ERRO";
    }
  }

  function clearViewerForNoProducts() {
    clearProductLayers(); state.currentEntry = null; state.currentProduct = null; state.items = [];
    renderProductSelector(); renderCalendar(); renderEmpty();
    el("productHeading").textContent = "Nenhum produto válido encontrado";
    el("productFullName").textContent = "Adicione uma pasta com product.json em www/data/products.";
    el("productStatus").innerHTML = "<i></i> SEM PRODUTO";
    showAlert("Nenhum produto válido foi encontrado em www/data/products.", "warning");
  }

  function updateCatalog(payload) {
    const next = normalizeCatalog(payload), fingerprint = catalogFingerprint(next);
    if (fingerprint === state.catalogFingerprint) return;
    const previous = state.currentEntry; state.catalog = next; state.catalogFingerprint = fingerprint;
    renderProductSelector(); renderCalendar();
    if (!state.catalog.length) { clearViewerForNoProducts(); return; }
    const same = previous ? state.catalog.find((entry) => entry.id === previous.id && entry.manifest === previous.manifest) : null;
    if (same) {
      const changed = String(same.version || "") !== String(previous.version || "");
      state.currentEntry = same; renderProductSelector(); if (changed) loadProduct(same); return;
    }
    loadProduct(state.catalog.find((entry) => entry.id === state.defaultProductId) || state.catalog[0]);
  }

  async function initializeMap() {
    state.map = L.map("zeeMap", { zoomControl: false, preferCanvas: true, minZoom: 2, maxZoom: 11, zoomSnap: 0.1, zoomDelta: 0.5, attributionControl: true });
    L.control.zoom({ position: "topright" }).addTo(state.map);
    const mapBase = L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", { attribution: "&copy; OpenStreetMap &copy; CARTO", subdomains: "abcd", maxZoom: 20, className: "basemap-map" });
    const satellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { attribution: "Tiles &copy; Esri", maxZoom: 20, maxNativeZoom: 19, className: "basemap-satellite" }).addTo(state.map);
    L.control.layers({ "Satélite": satellite, "Mapa": mapBase }, null, { position: "bottomleft", collapsed: true }).addTo(state.map);
    state.map.createPane("sar-raster-pane").style.zIndex = "330";
    try {
      const zee = await fetchJson("data/zee-amazonia-azul.geojson");
      state.zeeLayer = L.geoJSON(zee, {
        style: (feature) => { const pce = feature.properties?.name === "PCE"; return { color: pce ? "#ffe071" : "#31d9ef", weight: pce ? 2.15 : 1.75, dashArray: pce ? "7 5" : null, opacity: 1, fillColor: pce ? "#e6aa28" : "#087f8c", fillOpacity: pce ? 0.13 : 0.12 }; },
        onEachFeature: (feature, layer) => layer.bindTooltip(feature.properties?.label || "Zona Econômica Exclusiva", { sticky: true, className: "map-tooltip" })
      }).addTo(state.map); setMapView("zee");
    } catch (error) { console.error(error); showAlert(`A camada ZEE/PCE não foi carregada: ${error.message}`, "warning"); state.map.setView([-10, -40], 3); }
    window.setTimeout(() => state.map.invalidateSize(), 80);
  }

  function initializeEvents() {
    el("previousButton").addEventListener("click", () => selectItem(state.currentIndex - 1));
    el("nextButton").addEventListener("click", () => selectItem(state.currentIndex + 1));
    el("zeeButton").addEventListener("click", () => setMapView("zee")); el("productButton").addEventListener("click", () => setMapView("product"));
    el("productSelect").addEventListener("change", (event) => {
      const [id, manifest] = event.target.value.split("|");
      const entry = state.catalog.find((item) => item.id === id && item.manifest === manifest); if (entry) loadProduct(entry);
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
