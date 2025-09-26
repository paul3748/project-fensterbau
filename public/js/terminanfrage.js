// terminanfrage.js - FIXED VERSION für Cloud-Server (CSP-konform)

// ✅ FIXED: Dynamische Base URL statt hardcodierte localhost
const getBaseUrl = () => {
  // Verwende die aktuelle Domain statt localhost
  return window.location.origin;
};

const BASE_URL = getBaseUrl();

console.log('🌐 Terminanfrage Script geladen für:', BASE_URL);

// Global state
let aktuelleWoche = 0;
let ausgewählteTermine = [];
let alleSlots = [];
let csrfToken = null;
let istTelefonanfrage = false;

// CSRF Token Management
async function getCsrfToken() {
  try {
    console.log('🔑 Hole CSRF Token vom Server...');
    
    const response = await fetch(`${BASE_URL}/csrf-token`, {
      method: 'GET',
      credentials: 'same-origin', // ✅ Wichtig für Session-Cookies
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (!data.success || !data.csrfToken) {
      throw new Error('Ungültige CSRF Token Antwort vom Server');
    }

    csrfToken = data.csrfToken;
    console.log('✅ CSRF Token erhalten:', csrfToken.substring(0, 8) + '...');
    
    return csrfToken;

  } catch (error) {
    console.error('❌ Fehler beim Abrufen des CSRF Tokens:', error);
    
    // User-freundliche Fehlermeldung
    const errorMsg = error.message.includes('Failed to fetch') ? 
      'Verbindung zum Server fehlgeschlagen. Bitte Internetverbindung prüfen.' :
      `Fehler beim Laden der Sicherheitsdaten: ${error.message}`;
      
    throw new Error(errorMsg);
  }
}

// ✅ IMPROVED: Fetch mit automatischem CSRF Token
async function fetchWithCSRF(url, options = {}) {
  try {
    // Token holen falls nicht vorhanden
    if (!csrfToken) {
      await getCsrfToken();
    }

    // Request-Optionen vorbereiten
    const fetchOptions = {
      credentials: 'same-origin', // ✅ Session-Cookies mitschicken
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken, // ✅ CSRF Token im Header
        ...options.headers
      },
      ...options
    };

    // Bei POST/PUT auch im Body (falls Forms verwendet werden)
    if (options.body && typeof options.body === 'string') {
      try {
        const bodyData = JSON.parse(options.body);
        bodyData._csrf = csrfToken;
        fetchOptions.body = JSON.stringify(bodyData);
      } catch {
        // Falls Body kein JSON ist, ignorieren
      }
    }

    console.log('🌐 Fetch Request:', {
      url: url,
      method: options.method || 'GET',
      hasCSRF: !!csrfToken,
      credentials: fetchOptions.credentials
    });

    const response = await fetch(url, fetchOptions);

    // CSRF-Fehler abfangen und Token neu holen
    if (response.status === 403) {
      const errorData = await response.json().catch(() => ({}));
      
      if (errorData.code === 'CSRF_INVALID' || errorData.code === 'CSRF_MISSING') {
        console.log('🔄 CSRF Token ungültig - hole neuen Token...');
        csrfToken = null; // Reset Token
        
        // Einen Versuch mit neuem Token
        await getCsrfToken();
        fetchOptions.headers['X-CSRF-Token'] = csrfToken;
        
        if (fetchOptions.body && typeof fetchOptions.body === 'string') {
          try {
            const bodyData = JSON.parse(fetchOptions.body);
            bodyData._csrf = csrfToken;
            fetchOptions.body = JSON.stringify(bodyData);
          } catch {
            // Ignore if body is not JSON
          }
        }
        
        console.log('🔄 Retry mit neuem CSRF Token...');
        return await fetch(url, fetchOptions);
      }
    }

    return response;

  } catch (error) {
    console.error('❌ Fetch Fehler:', error);
    throw error;
  }
}

// ✅ IMPROVED: Freie Slots laden mit besserer Fehlerbehandlung
async function ladeFreieSlots() {
  const ladeIndikator = document.querySelector('.tage-grid');
  
  try {
    console.log('📅 Lade freie Slots...');
    
    if (ladeIndikator) {
      ladeIndikator.innerHTML = '<div class="loading-spinner">⏳ Lade verfügbare Termine...</div>';
    }

    const response = await fetchWithCSRF(`${BASE_URL}/outlook/freie-slots`, {
      method: 'GET'
    });

    if (!response.ok) {
      throw new Error(`Server Fehler: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    if (!data.freieSlots) {
      throw new Error('Keine Termindaten vom Server erhalten');
    }

    alleSlots = data.freieSlots;
    console.log(`✅ ${alleSlots.length} freie Slots geladen`);

    // UI aktualisieren
    aktualisiereWochenAnzeige();
    zeigeSlots();

  } catch (error) {
    console.error('Fehler beim Abrufen der freien Slots:', error);
    
    if (ladeIndikator) {
      ladeIndikator.innerHTML = `
        <div class="error-message">
          <p>❌ Termine konnten nicht geladen werden</p>
          <p style="font-size: 0.9em; color: #666;">${error.message}</p>
          <button onclick="ladeFreieSlots()" class="retry-btn">🔄 Erneut versuchen</button>
        </div>
      `;
    }
    
    // User-freundliche Fehlermeldung
    zeigeFehlermeldung('Termine konnten nicht geladen werden. Bitte versuchen Sie es später erneut.');
  }
}

// ✅ Formulardaten sammeln und validieren
function sammelFormulardaten() {
  const formData = {
    // Anliegen/Problem
    problem: {
      Fenster: parseInt(document.getElementById('Fenster').value) || 0,
      Tueren: parseInt(document.getElementById('Tueren').value) || 0,
      Rolladen: parseInt(document.getElementById('Rolladen').value) || 0
    },
    
    // Beschreibung
    beschreibung: document.getElementById('beschreibung').value.trim(),
    
    // Kontaktdaten
    kontakt: {
      nachname: document.getElementById('nachname').value.trim(),
      vorname: document.getElementById('vorname').value.trim(),
      kundennummer: document.getElementById('kundennummer').value.trim(),
      firma: document.getElementById('firma').value.trim(),
      adresse: document.getElementById('adresse').value.trim(),
      plz: document.getElementById('plz').value.trim(),
      ort: document.getElementById('ort').value.trim(),
      email: document.getElementById('e-mail').value.trim(),
      telefon: document.getElementById('telefon').value.trim()
    },
    
    // Terminart und -details
    istTelefonanfrage: istTelefonanfrage,
    termine: istTelefonanfrage ? [] : ausgewählteTermine,
    
    // Datenschutz
    datenschutz: document.getElementById('datenschutz').checked
  };

  return formData;
}

// ✅ Formularvalidierung
function validiereFormular(formData) {
  const fehler = [];

  // Problem-Validierung
  const problemSumme = Object.values(formData.problem).reduce((sum, val) => sum + val, 0);
  if (problemSumme === 0) {
    fehler.push('Bitte wählen Sie mindestens ein Problem aus (Fenster, Türen oder Rollläden).');
  }

  // Beschreibung
  if (!formData.beschreibung || formData.beschreibung.length < 10) {
    fehler.push('Bitte beschreiben Sie Ihr Anliegen (mindestens 10 Zeichen).');
  }

  // Pflichtfelder Kontakt
  if (!formData.kontakt.nachname) fehler.push('Nachname ist erforderlich.');
  if (!formData.kontakt.vorname) fehler.push('Vorname ist erforderlich.');
  if (!formData.kontakt.adresse) fehler.push('Adresse ist erforderlich.');
  if (!formData.kontakt.plz) fehler.push('PLZ ist erforderlich.');
  if (!formData.kontakt.ort) fehler.push('Ort ist erforderlich.');
  if (!formData.kontakt.email) fehler.push('E-Mail ist erforderlich.');
  if (!formData.kontakt.telefon) fehler.push('Telefon ist erforderlich.');

  // E-Mail Format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (formData.kontakt.email && !emailRegex.test(formData.kontakt.email)) {
    fehler.push('Bitte geben Sie eine gültige E-Mail-Adresse ein.');
  }

  // PLZ Format (5 Ziffern)
  const plzRegex = /^\d{5}$/;
  if (formData.kontakt.plz && !plzRegex.test(formData.kontakt.plz)) {
    fehler.push('PLZ muss aus 5 Ziffern bestehen.');
  }

  // Termin-Validierung für Vor-Ort-Termine
  if (!formData.istTelefonanfrage && formData.termine.length !== 3) {
    fehler.push('Bitte wählen Sie genau 3 Terminvorschläge aus.');
  }

  // Datenschutz
  if (!formData.datenschutz) {
    fehler.push('Bitte akzeptieren Sie die Datenschutzerklärung.');
  }

  return fehler;
}

// ✅ IMPROVED: Formular absenden mit besserer Fehlerbehandlung
async function sendeFormular(event) {
  event.preventDefault();
  
  const submitButton = document.querySelector('button[type="submit"]');
  const formOverlay = document.querySelector('.form-overlay');
  const statusDiv = document.getElementById('formStatus');

  try {
    console.log('📤 Formular wird gesendet...');

    // Loading State
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Wird gesendet...';
    }
    
    if (formOverlay) {
      formOverlay.style.display = 'flex';
      formOverlay.setAttribute('aria-hidden', 'false');
    }

    // Daten sammeln und validieren
    const formData = sammelFormulardaten();
    const validationErrors = validiereFormular(formData);

    if (validationErrors.length > 0) {
      throw new Error(validationErrors.join('\n'));
    }

    // An Server senden
    const response = await fetchWithCSRF(`${BASE_URL}/anfrage`, {
      method: 'POST',
      body: JSON.stringify(formData)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Server Fehler: ${response.status}`);
    }

    const result = await response.json();
    
    if (!result.message) {
      throw new Error('Unerwartete Server-Antwort');
    }

    // Erfolg anzeigen
    console.log('✅ Formular erfolgreich gesendet');
    
    if (statusDiv) {
      statusDiv.className = 'alert success';
      statusDiv.textContent = result.message || 'Ihre Anfrage wurde erfolgreich gesendet!';
      statusDiv.classList.remove('hidden');
      statusDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Formular zurücksetzen
    document.getElementById('terminFormular').reset();
    ausgewählteTermine = [];
    aktualisiereTerminauswahl();

    // Success-Tracking (falls Analytics vorhanden)
    if (typeof gtag === 'function') {
      gtag('event', 'form_submit', {
        'event_category': 'engagement',
        'event_label': istTelefonanfrage ? 'telefonanfrage' : 'vor_ort_anfrage'
      });
    }

  } catch (error) {
    console.error('❌ Fehler beim Senden:', error);
    
    // Fehler anzeigen
    if (statusDiv) {
      statusDiv.className = 'alert error';
      statusDiv.textContent = error.message || 'Fehler beim Senden der Anfrage. Bitte versuchen Sie es erneut.';
      statusDiv.classList.remove('hidden');
      statusDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    
    zeigeFehlermeldung(error.message);

  } finally {
    // Loading State zurücksetzen
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = 'Absenden';
    }
    
    if (formOverlay) {
      formOverlay.style.display = 'none';
      formOverlay.setAttribute('aria-hidden', 'true');
    }
  }
}

// ✅ Hilfsfunktionen für UI-Updates
function zeigeFehlermeldung(message) {
  const meldungDiv = document.getElementById('meldung');
  if (meldungDiv) {
    meldungDiv.textContent = message;
    meldungDiv.className = 'form-error';
    meldungDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function zeigeLadezustand(isLoading, message = '') {
  const form = document.getElementById('terminFormular');
  const overlay = document.querySelector('.form-overlay');
  
  if (overlay) {
    overlay.style.display = isLoading ? 'flex' : 'none';
    overlay.setAttribute('aria-hidden', isLoading ? 'false' : 'true');
  }
  
  if (form) {
    const inputs = form.querySelectorAll('input, textarea, button, select');
    inputs.forEach(input => {
      input.disabled = isLoading;
    });
  }
  
  if (message && isLoading) {
    console.log('⏳', message);
  }
}

// ✅ Terminauswahl-Funktionen
function toggleTerminauswahl(slot) {
  if (istTelefonanfrage) return;

  const slotKey = `${slot.start}_${slot.end}`;
  const existingIndex = ausgewählteTermine.findIndex(t => `${t.start}_${t.end}` === slotKey);

  if (existingIndex >= 0) {
    // Termin entfernen
    ausgewählteTermine.splice(existingIndex, 1);
  } else if (ausgewählteTermine.length < 3) {
    // Termin hinzufügen (maximal 3)
    ausgewählteTermine.push(slot);
  } else {
    // Bereits 3 Termine ausgewählt
    zeigeFehlermeldung('Sie können maximal 3 Termine auswählen. Entfernen Sie zuerst einen anderen Termin.');
    return;
  }

  aktualisiereTerminauswahl();
}

function aktualisiereTerminauswahl() {
  // Auswahlmeldung aktualisieren
  const meldungDiv = document.getElementById('auswahlMeldung');
  if (meldungDiv) {
    const anzahl = ausgewählteTermine.length;
    if (istTelefonanfrage) {
      meldungDiv.textContent = 'Telefonanfrage - keine Terminauswahl erforderlich';
      meldungDiv.className = 'form-info';
    } else if (anzahl === 0) {
      meldungDiv.textContent = 'Bitte wählen Sie 3 passende Termine aus.';
      meldungDiv.className = 'form-error';
    } else if (anzahl < 3) {
      meldungDiv.textContent = `${anzahl}/3 Termine ausgewählt - wählen Sie noch ${3-anzahl} weitere.`;
      meldungDiv.className = 'form-warning';
    } else {
      meldungDiv.textContent = '✅ 3 Termine ausgewählt';
      meldungDiv.className = 'form-success';
    }
  }

  // Slots visuell aktualisieren
  zeigeSlots();
}

// ✅ Wochennavigation
function aktualisiereWochenAnzeige() {
  const heute = new Date();
  const startDatum = new Date(heute);
  startDatum.setDate(heute.getDate() + (aktuelleWoche * 7) + 1);
  
  const endDatum = new Date(startDatum);
  endDatum.setDate(startDatum.getDate() + 6);

  const wochenDiv = document.getElementById('currentWeek');
  if (wochenDiv) {
    const formatter = new Intl.DateTimeFormat('de-DE', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric' 
    });
    
    wochenDiv.textContent = `${formatter.format(startDatum)} - ${formatter.format(endDatum)}`;
  }

  // Navigation buttons
  const prevBtn = document.getElementById('prevWeek');
  const nextBtn = document.getElementById('nextWeek');
  
  if (prevBtn) prevBtn.disabled = aktuelleWoche <= 0;
  if (nextBtn) nextBtn.disabled = aktuelleWoche >= 3; // Max 4 Wochen im Voraus
}

// ✅ Slots anzeigen
function zeigeSlots() {
  const container = document.querySelector('.tage-grid');
  if (!container || !alleSlots.length) return;

  // Slots für aktuelle Woche filtern
  const heute = new Date();
  const wochenStart = new Date(heute);
  wochenStart.setDate(heute.getDate() + (aktuelleWoche * 7) + 1);
  wochenStart.setHours(0, 0, 0, 0);
  
  const wochenEnde = new Date(wochenStart);
  wochenEnde.setDate(wochenStart.getDate() + 6);
  wochenEnde.setHours(23, 59, 59, 999);

  const wochenSlots = alleSlots.filter(slot => {
    const slotDate = new Date(slot.start);
    return slotDate >= wochenStart && slotDate <= wochenEnde;
  });

  if (wochenSlots.length === 0) {
    container.innerHTML = '<div class="no-slots">Keine verfügbaren Termine in dieser Woche</div>';
    return;
  }

  // Slots nach Tagen gruppieren
  const tageMap = {};
  wochenSlots.forEach(slot => {
    const datum = new Date(slot.start).toDateString();
    if (!tageMap[datum]) tageMap[datum] = [];
    tageMap[datum].push(slot);
  });

  // HTML generieren
  container.innerHTML = '';
  
  Object.entries(tageMap).forEach(([datum, slots]) => {
    const date = new Date(datum);
    const tagDiv = document.createElement('div');
    tagDiv.className = 'day-column'; // ✅ Korrekte Klasse für Tag-Container
    
    const tagHeader = document.createElement('h4');
    tagHeader.className = 'day-header'; // ✅ Korrekte Klasse für Tag-Header
    tagHeader.textContent = date.toLocaleDateString('de-DE', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit'
    });
    tagDiv.appendChild(tagHeader);
    
    slots.forEach(slot => {
      const slotBtn = document.createElement('button');
      slotBtn.type = 'button';
      slotBtn.className = 'slot frei'; // ✅ FIXED: Verwende 'slot' statt 'slot-btn'
      
      const startTime = new Date(slot.start).toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit'
      });
      const endTime = new Date(slot.end).toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit'
      });
      
      slotBtn.textContent = `${startTime} - ${endTime}`;
      
      // Status prüfen
      const slotKey = `${slot.start}_${slot.end}`;
      const isSelected = ausgewählteTermine.some(t => `${t.start}_${t.end}` === slotKey);
      
      if (isSelected) {
        slotBtn.classList.add('selected');
        slotBtn.setAttribute('aria-pressed', 'true');
      }
      
      if (istTelefonanfrage) {
        slotBtn.classList.remove('frei');
        slotBtn.classList.add('gesperrt');
        slotBtn.disabled = true;
      }
      
      slotBtn.addEventListener('click', () => toggleTerminauswahl(slot));
      tagDiv.appendChild(slotBtn);
    });
    
    container.appendChild(tagDiv);
  });
}

// ✅ Event Listeners und Initialisierung
document.addEventListener('DOMContentLoaded', async function() {
  console.log('🚀 Terminanfrage Script initialisiert');

  // CSRF Token vorab laden
  try {
    await getCsrfToken();
    console.log('✅ CSRF Token vorgeladen');
  } catch (error) {
    console.error('⚠ CSRF Token Vorladung fehlgeschlagen:', error.message);
  }

  // Anfrageart Toggle
  const anfrageartRadios = document.querySelectorAll('input[name="anfrageart"]');
  anfrageartRadios.forEach(radio => {
    radio.addEventListener('change', function() {
      istTelefonanfrage = this.value === 'telefonisch';
      console.log('📞 Anfrageart geändert:', istTelefonanfrage ? 'Telefonisch' : 'Vor Ort');
      
      const terminAbschnitt = document.getElementById('terminAbschnitt');
      if (terminAbschnitt) {
        terminAbschnitt.style.display = istTelefonanfrage ? 'none' : 'block';
      }
      
      ausgewählteTermine = [];
      aktualisiereTerminauswahl();
    });
  });

  // Wochennavigation
  const prevBtn = document.getElementById('prevWeek');
  const nextBtn = document.getElementById('nextWeek');
  
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (aktuelleWoche > 0) {
        aktuelleWoche--;
        aktualisiereWochenAnzeige();
        zeigeSlots();
      }
    });
  }
  
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (aktuelleWoche < 3) {
        aktuelleWoche++;
        aktualisiereWochenAnzeige();
        zeigeSlots();
      }
    });
  }

  // Formular Event Listener
  const form = document.getElementById('terminFormular');
  if (form) {
    form.addEventListener('submit', sendeFormular);
  }

  // Slots laden
  await ladeFreieSlots();
  
  console.log('✅ Terminanfrage Script vollständig geladen');
});

// ✅ Error Recovery - Bei Netzwerkfehlern
window.addEventListener('online', () => {
  console.log('🌐 Verbindung wiederhergestellt');
  const errorMessages = document.querySelectorAll('.error-message');
  errorMessages.forEach(msg => {
    if (msg.textContent.includes('Verbindung')) {
      msg.innerHTML = `
        <p>🌐 Verbindung wiederhergestellt</p>
        <button onclick="ladeFreieSlots()" class="retry-btn">🔄 Termine neu laden</button>
      `;
    }
  });
});

window.addEventListener('offline', () => {
  console.log('📵 Verbindung verloren');
  zeigeFehlermeldung('Keine Internetverbindung. Bitte prüfen Sie Ihre Netzwerkverbindung.');
});