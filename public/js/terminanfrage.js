// /public/js/terminanfrage.js - FIXED CSRF Token Implementation

const API_BASE = "http://localhost:3000";

// --- Konfiguration ---
const OFFSET_TAGE = 1;
const MAX_TAGE = 28;
const heute = startOfDay(new Date());
const minBuchbar = addDays(heute, OFFSET_TAGE);
let belegteOutlookSlots = [];

const ZEITBLOCKE = [
  { label: "07:30 – 10:30", start: { h: 7, m: 30 }, end: { h: 10, m: 30 } },
  { label: "10:30 – 13:00", start: { h: 10, m: 30 }, end: { h: 13, m: 0 } },
  { label: "13:00 – 15:00", start: { h: 13, m: 0 }, end: { h: 15, m: 0 } },
];

let freieSlotIds = new Set();
let aktuelleWoche = montagDerWoche(minBuchbar);

// --------- CSRF Token Management ----------
let csrfToken = null;
let sessionId = null; // For debugging

// ✅ FIXED: Robuste CSRF Token-Behandlung
async function getCsrfToken(force = false) {
  if (csrfToken && !force) {
    console.log('🔄 Verwende existierenden CSRF Token:', csrfToken.substring(0, 8) + '...');
    return csrfToken;
  }

  try {
    console.log('🔑 Hole CSRF Token vom Server...');
    const response = await fetch(`${API_BASE}/csrf-token`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Cache-Control': 'no-cache'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: CSRF Token konnte nicht abgerufen werden`);
    }
    
    const data = await response.json();
    csrfToken = data.csrfToken;
    sessionId = data.sessionId; // Debug info
    
    console.log('✅ CSRF Token erhalten:', {
      token: csrfToken?.substring(0, 8) + '...',
      sessionId: sessionId,
      length: csrfToken?.length
    });
    
    return csrfToken;
  } catch (error) {
    console.error('❌ Fehler beim Abrufen des CSRF Tokens:', error);
    csrfToken = null;
    throw error;
  }
}

// ✅ FIXED: Generische Fetch-Funktion mit CSRF-Handling
async function fetchWithCSRF(url, options = {}) {
  // Stelle sicher, dass CSRF Token vorhanden ist
  if (!csrfToken) {
    await getCsrfToken();
  }
  
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };
  
  // CSRF Token nur bei nicht-GET Requests hinzufügen
  if (options.method && options.method !== 'GET' && csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }
  
  const fetchOptions = {
    credentials: 'include',
    ...options,
    headers
  };
  
  console.log('📡 Sende Request:', {
    url: url,
    method: options.method || 'GET',
    hasCSRF: !!headers['X-CSRF-Token'],
    csrfToken: headers['X-CSRF-Token']?.substring(0, 8) + '...'
  });
  
  let response = await fetch(url, fetchOptions);
  
  // Bei CSRF-Fehler neuen Token holen und retry
  if (response.status === 403) {
    const errorData = await response.json().catch(() => ({}));
    if (errorData.code === 'CSRF_INVALID') {
      console.log('🔄 CSRF Token ungültig, hole neuen...');
      await getCsrfToken(true); // Force refresh
      
      if (csrfToken && options.method !== 'GET') {
        headers['X-CSRF-Token'] = csrfToken;
        fetchOptions.headers = headers;
        console.log('🔄 Retry mit neuem CSRF Token:', csrfToken.substring(0, 8) + '...');
        response = await fetch(url, fetchOptions);
      }
    }
  }
  
  return response;
}

// --------- Helpers: Datum/Zeit ----------
function pad2(n) { return String(n).padStart(2, "0"); }
function toYMD(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function montagDerWoche(d) {
  const x = new Date(d);
  const day = x.getDay() || 7;
  if (day !== 1) x.setDate(x.getDate() - (day - 1));
  x.setHours(0,0,0,0);
  return x;
}
function istWochenende(d) {
  const w = d.getDay();
  return w === 0 || w === 6;
}
function inBuchbaremFenster(d) {
  const heute = startOfDay(new Date());
  const min = addDays(heute, OFFSET_TAGE); 
  const max = addDays(heute, MAX_TAGE);
  const tag = startOfDay(d);
  return tag >= min && tag <= max;
}
function formatHM(h, m) {
  return `${pad2(h)}:${pad2(m)}`;
}
function slotLabel(block) {
  return `${formatHM(block.start.h, block.start.m)} – ${formatHM(block.end.h, block.end.m)}`;
}
function slotIdFromDateAndBlock(datum, block) {
  return `${toYMD(datum)}_${slotLabel(block)}`;
}
function naiveLocalDateTimeString(datum, h, m) {
  return `${toYMD(datum)}T${formatHM(h, m)}:00`;
}

// --------- Anfrageart (Vor Ort / Telefonisch) ----------
function initAnfrageartToggle() {
  const radioVorOrt = document.getElementById("option-vor-ort");
  const radioTelefonisch = document.getElementById("option-telefonisch");
  const terminAbschnitt = document.getElementById("terminAbschnitt");

  function aktualisiereTerminAnzeige() {
    if (!terminAbschnitt) return;
    if (radioTelefonisch?.checked) terminAbschnitt.classList.add("ausgeblendet");
    else terminAbschnitt.classList.remove("ausgeblendet");
  }

  radioVorOrt?.addEventListener("change", aktualisiereTerminAnzeige);
  radioTelefonisch?.addEventListener("change", aktualisiereTerminAnzeige);
  aktualisiereTerminAnzeige();

  window._aktualisiereTerminAnzeige = aktualisiereTerminAnzeige;
}

// ✅ FIXED: Verwende fetchWithCSRF für freie Slots
async function ladeFreieSlots() {
  try {
    const response = await fetchWithCSRF(`${API_BASE}/outlook/freie-slots`, {
      method: 'GET'
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: Fehler beim Laden der freien Slots`);
    }

    const data = await response.json();
    console.log("API Response:", data);
    
    let freieSlots, alleEvents;
    if (data.freieSlots && data.alleEvents) {
      freieSlots = data.freieSlots;
      alleEvents = data.alleEvents;
    } else if (Array.isArray(data)) {
      freieSlots = data;
      alleEvents = [];
    } else {
      throw new Error("Unbekannte API-Response-Struktur");
    }
    
    freieSlotIds = new Set(
      freieSlots.map(s => {
        const start = new Date(s.start);
        const end   = new Date(s.end);
        const dateStr  = toYMD(start);  
        const startStr = start.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", hour12: false });
        const endStr = end.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", hour12: false });
        return `${dateStr}_${startStr} – ${endStr}`;
      })
    );

    console.log("Freie Slot IDs:", Array.from(freieSlotIds));
    belegteOutlookSlots = alleEvents;

  } catch (err) {
    console.error("Fehler beim Abrufen der freien Slots:", err);
    freieSlotIds = new Set();
    belegteOutlookSlots = [];
  } finally {
    ladeWoche(aktuelleWoche);
  }
}

// Rest der Funktionen bleiben gleich...
function countOverlaps(slotId) {
  const [dateStr, timeRange] = slotId.split("_");
  const [startStr, endStr] = timeRange.split(" – ");

  const slotStart = new Date(`${dateStr}T${startStr}:00`);
  const slotEnd   = new Date(`${dateStr}T${endStr}:00`);

  let overlaps = 0;
  for (const event of belegteOutlookSlots) {
    const eventStart = new Date(event.start);
    const eventEnd   = new Date(event.end);

    if (eventEnd > slotStart && eventStart < slotEnd) {
      overlaps++;
    }
  }
  
  if (overlaps >= 1) {
    console.log(`Slot ${slotId} hat ${overlaps} Überschneidung(en)`);
  }
  
  return overlaps;
}

// --------- Formular-Submit & Validierung ----------
async function handleSubmit(e) {
  console.log("📤 Formular absenden...");
  e.preventDefault();

  const form = document.getElementById("terminFormular");
  const statusBox = getStatusBox();
  clearStatus(statusBox);
  clearAllFieldErrors(form);

  const fehlermeldung = document.getElementById("meldung");
  if (fehlermeldung) fehlermeldung.textContent = "";

  const validation = validateForm();
  if (!validation.ok) {
    showStatus(statusBox, "error", validation.message || "Bitte Eingaben prüfen.");
    scrollIntoView(statusBox);
    return;
  }

  const daten = buildPayload(validation);
  startLoading(form);
  
  try {
    // ✅ FIXED: Verwende fetchWithCSRF
    const response = await fetchWithCSRF(`${API_BASE}/anfrage`, {
      method: "POST",
      body: JSON.stringify(daten),
    });

    if (!response.ok) {
      let msg = "Fehler beim Senden der Anfrage.";
      try {
        const errorData = await response.json();
        if (errorData?.message) msg = errorData.message;
      } catch (_) {}
      throw new Error(msg);
    }

    // Erfolg
    form.reset();
    ensureHiddenContainer().innerHTML = "";
    document.querySelectorAll(".slot.selected").forEach(s => s.classList.remove("selected"));
    setAuswahlHinweis("");
    window._aktualisiereTerminAnzeige?.();
    showStatus(statusBox, "success", "Formular erfolgreich abgesendet!");
    scrollIntoView(statusBox);
    
  } catch (err) {
    console.error("❌ Fehler beim Senden:", err);
    showStatus(statusBox, "error", err.message || "Fehler beim Senden der Anfrage.");
    scrollIntoView(statusBox);
  } finally {
    stopLoading(form);
  }
}

// Rest der Implementierung bleibt gleich...
function ladeWoche(wochenMontag) {
  const grid = document.querySelector(".tage-grid");
  if (!grid) return;
  grid.innerHTML = "";

  const endeDatum = addDays(wochenMontag, 4);
  const options = { year: "numeric", month: "2-digit", day: "2-digit" };
  const labelNode = document.getElementById("currentWeek");
  if (labelNode) {
    labelNode.textContent = `KW ${getISOWeek(wochenMontag)} – ${wochenMontag.toLocaleDateString("de-DE", options)} bis ${endeDatum.toLocaleDateString("de-DE", options)}`;
  }

  for (let i = 0; i < 5; i++) {
    const tagDatum = addDays(wochenMontag, i);

    const dayDiv = document.createElement("div");
    dayDiv.className = "tag";
    dayDiv.innerHTML = `
      <div class="datum">${tagDatum.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" })}</div>
      <div class="slots"></div>
    `;
    const slotsContainer = dayDiv.querySelector(".slots");

    ZEITBLOCKE.forEach(block => {
      const id = slotIdFromDateAndBlock(tagDatum, block);
      const imFenster = inBuchbaremFenster(tagDatum);
      const nachFruehestem = tagDatum >= minBuchbar;
      const darfWaehlen = tagDatum >= minBuchbar && !istWochenende(tagDatum);
      
      const istFrei = freieSlotIds.has(id);

      const classes = ["slot"];
      let klickbar = false;

      if (!imFenster || !nachFruehestem || istWochenende(tagDatum)) {
        classes.push("gesperrt");
      } else if (!istFrei) {
        classes.push("belegt");
      } else {
        classes.push("frei");
        klickbar = darfWaehlen;
      }

      const slotEl = document.createElement("div");
      slotEl.className = classes.join(" ");
      slotEl.setAttribute("data-slot-id", id);
      slotEl.setAttribute("data-date", toYMD(tagDatum));
      slotEl.setAttribute("data-label", block.label);
      slotEl.textContent = block.label;

      if (klickbar) {
        slotEl.setAttribute("role", "button");
        slotEl.setAttribute("tabindex", "0");
        slotEl.addEventListener("click", onSlotClick);
        slotEl.addEventListener("keydown", (e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            onSlotClick.call(slotEl);
          }
        });
      }

      slotsContainer.appendChild(slotEl);
    });

    grid.appendChild(dayDiv);
  }

  updateNavButtons();
  syncVisualSelectionFromHiddenInputs();
}

// --------- Auswahl (max. 3) + versteckte Checkboxen ----------
function ensureHiddenContainer() {
  let c = document.getElementById("hiddenZeitslots");
  if (!c) {
    c = document.createElement("div");
    c.id = "hiddenZeitslots";
    c.style.display = "none";
    document.getElementById("terminFormular")?.appendChild(c);
  }
  return c;
}

function getGlobalSelectedCount() {
  const container = ensureHiddenContainer();
  return container.querySelectorAll('input[name="zeitslot"]:checked').length;
}

function onSlotClick() {
  const slot = this;
  const globalSelected = getGlobalSelectedCount();

  if (slot.classList.contains("selected")) {
    slot.classList.remove("selected");
    removeHiddenCheckboxFor(slot);
    setAuswahlHinweis("");
    return;
  }

  if (globalSelected >= 3) {
    setAuswahlHinweis("Bitte wähle genau 3 Termine aus. Du hast bereits 3 Termine ausgewählt.");
    return;
  }

  slot.classList.add("selected");
  addHiddenCheckboxFor(slot);
  
  const newCount = getGlobalSelectedCount();
  if (newCount === 3) {
    setAuswahlHinweis("");
  } else {
    setAuswahlHinweis(`${newCount}/3 Termine ausgewählt`);
  }
}

function setAuswahlHinweis(msg) {
  const m = document.getElementById("auswahlMeldung");
  if (m) m.textContent = msg || "";
}

function addHiddenCheckboxFor(slotEl) {
  const container = ensureHiddenContainer();
  const id = slotEl.getAttribute("data-slot-id");
  if (container.querySelector(`input[type="checkbox"][data-slot-id="${CSS.escape(id)}"]`)) return;

  const dateStr = slotEl.getAttribute("data-date");
  const label = slotEl.getAttribute("data-label");
  const block = ZEITBLOCKE.find(b => b.label === label);
  const d = new Date(dateStr + "T00:00:00");

  const payload = {
    start: naiveLocalDateTimeString(d, block.start.h, block.start.m),
    end: naiveLocalDateTimeString(d, block.end.h, block.end.m)
  };

  const input = document.createElement("input");
  input.type = "checkbox";
  input.name = "zeitslot";
  input.checked = true;
  input.value = JSON.stringify(payload);
  input.setAttribute("data-slot-id", id);
  container.appendChild(input);
}

function removeHiddenCheckboxFor(slotEl) {
  const id = slotEl.getAttribute("data-slot-id");
  const container = ensureHiddenContainer();
  const el = container.querySelector(`input[type="checkbox"][data-slot-id="${CSS.escape(id)}"]`);
  if (el) el.remove();
}

function syncVisualSelectionFromHiddenInputs() {
  const container = ensureHiddenContainer();
  const ids = Array.from(container.querySelectorAll('input[name="zeitslot"]:checked'))
    .map(i => i.getAttribute("data-slot-id"));
  
  document.querySelectorAll(".slot").forEach(s => {
    if (ids.includes(s.getAttribute("data-slot-id"))) {
      s.classList.add("selected");
    } else {
      s.classList.remove("selected");
    }
  });
  
  const count = getGlobalSelectedCount();
  if (count === 3) {
    setAuswahlHinweis("");
  } else if (count > 0) {
    setAuswahlHinweis(`${count}/3 Termine ausgewählt`);
  } else {
    setAuswahlHinweis("");
  }
}

function getISOWeek(date) {
  const tempDate = new Date(date.valueOf());
  const dayNumber = (date.getDay() + 6) % 7;
  tempDate.setDate(tempDate.getDate() - dayNumber + 3);
  const firstThursday = tempDate.valueOf();
  tempDate.setMonth(0, 1);
  if (tempDate.getDay() !== 4) {
    tempDate.setMonth(0, 1 + ((4 - tempDate.getDay()) + 7) % 7);
  }
  return 1 + Math.ceil((firstThursday - tempDate) / 604800000);
}

function updateNavButtons() {
  const heute = startOfDay(new Date());
  const min = addDays(heute, OFFSET_TAGE);
  const max = addDays(heute, MAX_TAGE);

  const prevBtn = document.getElementById("prevWeek");
  const nextBtn = document.getElementById("nextWeek");
  if (!prevBtn || !nextBtn) return;

  const naechsteWoche = addDays(aktuelleWoche, 7);
  const naechsteFreitag = addDays(naechsteWoche, 4);
  nextBtn.disabled = startOfDay(naechsteWoche) > max;

  const vorigeWoche = addDays(aktuelleWoche, -7);
  const vorigeFreitag = addDays(vorigeWoche, 4);
  prevBtn.disabled = startOfDay(vorigeFreitag) < min;
}

document.getElementById("prevWeek")?.addEventListener("click", () => {
  aktuelleWoche = addDays(aktuelleWoche, -7);
  ladeWoche(aktuelleWoche);
});
document.getElementById("nextWeek")?.addEventListener("click", () => {
  aktuelleWoche = addDays(aktuelleWoche, +7);
  ladeWoche(aktuelleWoche);
});

function validateForm() {
  console.log("Validiere Formular...");
  const form = document.getElementById("terminFormular");
  const istTelefonanfrage = document.getElementById("option-telefonisch")?.checked || false;

  let ok = true;
  let message = "";

  const requiredFields = form.querySelectorAll("[required]");
  requiredFields.forEach((field) => {
    if (!field.value.trim() && field.type !== "checkbox") { 
      markFieldError(field, "Dieses Feld ist erforderlich.");
      if (!message) message = "Bitte füllen Sie alle Pflichtfelder aus.";
      ok = false;
    } else {
      clearFieldError(field);
    }
  });

  const datenschutzCheckbox = document.getElementById("datenschutz");
  if (datenschutzCheckbox && !datenschutzCheckbox.checked) {
    ok = false;
    message = "Bitte bestätigen Sie die Datenschutzerklärung.";
    markFieldError(datenschutzCheckbox, "Bitte bestätigen Sie die Datenschutzerklärung.");
  } else if (datenschutzCheckbox) {
    clearFieldError(datenschutzCheckbox);
  }

  const emailField = document.getElementById("e-mail");
  if (emailField && emailField.value && !/.+@.+\..+/.test(emailField.value)) {
    markFieldError(emailField, "Bitte geben Sie eine gültige E-Mail-Adresse ein.");
    if (!message) message = "Bitte geben Sie eine gültige E-Mail-Adresse ein.";
    ok = false;
  }

  const selectProblems = document.querySelectorAll(".problem-select");
  let problemSelected = false;
  selectProblems.forEach((select) => {
    if (select.value !== "0") problemSelected = true;
  });
  if (!problemSelected) {
    const fehlermeldung = document.getElementById("meldung");
    if (fehlermeldung) fehlermeldung.textContent = "Bitte wählen Sie mindestens ein Anliegen aus.";
    if (!message) message = "Bitte wählen Sie mindestens ein Anliegen aus.";
    ok = false;
  }

  if (!istTelefonanfrage) {
    const zeitslotCheckboxes = document.querySelectorAll('input[name="zeitslot"]:checked');
    if (zeitslotCheckboxes.length !== 3) {
      const meldung = document.getElementById("auswahlMeldung");
      if (meldung) meldung.textContent = "Bitte wähle genau 3 Termine aus.";
      if (!message) message = "Bitte wähle genau 3 Termine aus.";
      ok = false;
    } else {
      const meldung = document.getElementById("auswahlMeldung");
      if (meldung) meldung.textContent = "";
    }
  }

  const result = { ok, message, istTelefonanfrage };
  if (!ok) return result;

  const zeitslotCheckboxes = document.querySelectorAll('input[name="zeitslot"]:checked');
  result.termine = [...zeitslotCheckboxes].map((cb) => JSON.parse(cb.value));

  const problemSelects = document.querySelectorAll(".problem-select");
  const probleme = {};
  problemSelects.forEach((select) => {
    probleme[select.name] = parseInt(select.value, 10) || 0;
  });
  result.probleme = ProblemeCleanup(probleme);

  result.beschreibung = document.getElementById("beschreibung").value.trim();

  result.kontakt = {
    nachname: getVal("nachname"),
    vorname: getVal("vorname"),
    kundennummer: getVal("kundennummer"),
    firma: getVal("firma"),
    adresse: getVal("adresse"),
    ort: getVal("ort"),
    plz: getVal("plz"),
    email: getVal("e-mail"),
    telefon: getVal("telefon"),
  };

  return result;
}

function ProblemeCleanup(probleme) {
  const out = {};
  Object.entries(probleme).forEach(([k, v]) => {
    if (v > 0) out[k] = v;
  });
  return out;
}

function buildPayload(v) {
  return {
    problem: v.probleme,
    beschreibung: v.beschreibung,
    termine: v.istTelefonanfrage ? [] : v.termine,
    kontakt: v.kontakt,
    istTelefonanfrage: v.istTelefonanfrage,
  };
}

function getVal(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : "";
}

function getStatusBox() {
  return document.getElementById("formStatus");
}

function showStatus(node, type, msg) {
  if (!node) return;
  node.className = `alert alert--${type}`;
  node.textContent = msg;
  node.classList.remove("hidden");
}

function clearStatus(node) {
  if (!node) return;
  node.classList.add("hidden");
  node.textContent = "";
}

function markFieldError(field, msg) {
  field.setAttribute("aria-invalid", "true");
  let err = field.nextElementSibling;
  if (!err || !err.classList.contains("field-error")) {
    err = document.createElement("div");
    err.className = "field-error";
    field.insertAdjacentElement("afterend", err);
  }
  err.textContent = msg;
}

function clearFieldError(field) {
  field.removeAttribute("aria-invalid");
  const err = field.nextElementSibling;
  if (err && err.classList.contains("field-error")) err.remove();
}

function clearAllFieldErrors(form) {
  const errored = form.querySelectorAll("[aria-invalid='true']");
  errored.forEach(clearFieldError);
}

function startLoading(form) {
  form.classList.add("is-loading");
  const btn = form.querySelector('button[type="submit"]');
  if (btn) btn.disabled = true;
}
function stopLoading(form) {
  form.classList.remove("is-loading");
  const btn = form.querySelector('button[type="submit"]');
  if (btn) btn.disabled = false;
}

function scrollIntoView(el) {
  if (!el) return;
  const y = el.getBoundingClientRect().top + window.scrollY - 90;
  window.scrollTo({ top: y, behavior: "smooth" });
}

// --------- Init ---------
document.addEventListener("DOMContentLoaded", async () => {
  try {
    console.log("Seite geladen, hole CSRF Token...");
    await getCsrfToken();
  } catch (error) {
    console.error('Warnung: CSRF Token konnte nicht abgerufen werden:', error);
  }
  
  initAnfrageartToggle();
  const form = document.getElementById("terminFormular");
  if (form) {
    form.addEventListener("submit", handleSubmit);
  }
  
  aktuelleWoche = montagDerWoche(minBuchbar);
  await ladeFreieSlots();
});