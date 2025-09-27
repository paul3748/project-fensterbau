// terminanfrage.js - FIXED VERSION mit vollständigen Kalenderwochen

// ✅ FIXED: Dynamische Base URL statt hardcodierte localhost
const getBaseUrl = () => {
  return window.location.origin;
};

const BASE_URL = getBaseUrl();

console.log('🌐 Terminanfrage Script geladen für:', BASE_URL);

// Global state
let aktuelleWoche = 0;
let ausgewählteTermine = [];
let alleSlots = [];
let alleEvents = []; // ✅ NEU: Belegte Events separat speichern
let csrfToken = null;
let istTelefonanfrage = false;

// CSRF Token Management
async function getCsrfToken() {
  try {
    console.log('🔑 Hole CSRF Token vom Server...');
    
    const response = await fetch(`${BASE_URL}/csrf-token`, {
      method: 'GET',
      credentials: 'same-origin',
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
    
    const errorMsg = error.message.includes('Failed to fetch') ? 
      'Verbindung zum Server fehlgeschlagen. Bitte Internetverbindung prüfen.' :
      `Fehler beim Laden der Sicherheitsdaten: ${error.message}`;
      
    throw new Error(errorMsg);
  }
}

async function fetchWithCSRF(url, options = {}) {
  try {
    if (!csrfToken) {
      await getCsrfToken();
    }

    const fetchOptions = {
      credentials: 'same-origin',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        ...options.headers
      },
      ...options
    };

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
        csrfToken = null;
        
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

// ✅ NEUE FUNKTION: Vollständige Kalenderwochen-Slots generieren
function generateVollständigeWochenSlots() {
  const slots = [];
  const heute = new Date();

  const zeitbloecke = [
    { startStunde: 7, startMinute: 30, endStunde: 10, endMinute: 30 },
    { startStunde: 10, startMinute: 30, endStunde: 13, endMinute: 0 },
    { startStunde: 13, startMinute: 0, endStunde: 15, endMinute: 0 },
  ];

  // ✅ FIXED: Für 4 komplette Wochen ab nächstem Montag
  for (let woche = 0; woche < 4; woche++) {
    // Berechne den Montag der gewünschten Woche
    const montag = getMontagDerWoche(woche);
    
    // Generiere Slots für Montag bis Freitag dieser Woche
    for (let tag = 0; tag < 5; tag++) { // 0=Montag, 4=Freitag
      const datum = new Date(montag);
      datum.setDate(montag.getDate() + tag);
      
      // ✅ Slots nur für zukünftige Tage generieren
      if (datum <= heute) continue;

      for (const block of zeitbloecke) {
        const start = new Date(datum);
        start.setHours(block.startStunde, block.startMinute, 0, 0);
        const end = new Date(datum);
        end.setHours(block.endStunde, block.endMinute, 0, 0);
        
        slots.push({ 
          start: start.toISOString(), 
          end: end.toISOString(),
          woche: woche,
          tag: tag // 0=Montag, 1=Dienstag, etc.
        });
      }
    }
  }
  
  console.log(`📅 Generiert: ${slots.length} Slots für 4 vollständige Kalenderwochen`);
  return slots;
}

// ✅ NEUE FUNKTION: Montag der gewünschten Woche berechnen
function getMontagDerWoche(wocheOffset = 0) {
  const heute = new Date();
  const heutigerWochentag = heute.getDay(); // 0=Sonntag, 1=Montag, ..., 6=Samstag
  
  // Berechne wie viele Tage bis zum nächsten Montag
  let tageZumNächstenMontag;
  if (heutigerWochentag === 0) { // Sonntag
    tageZumNächstenMontag = 1;
  } else if (heutigerWochentag === 1) { // Montag
    tageZumNächstenMontag = 7; // Nächster Montag (nicht heute)
  } else { // Dienstag bis Samstag
    tageZumNächstenMontag = 8 - heutigerWochentag;
  }
  
  const nächsterMontag = new Date(heute);
  nächsterMontag.setDate(heute.getDate() + tageZumNächstenMontag);
  nächsterMontag.setHours(0, 0, 0, 0);
  
  // Füge Wochen-Offset hinzu
  const zielMontag = new Date(nächsterMontag);
  zielMontag.setDate(nächsterMontag.getDate() + (wocheOffset * 7));
  
  return zielMontag;
}

// ✅ IMPROVED: Slot-Status bestimmen (frei/belegt/gesperrt)
function getSlotStatus(slot) {
  // Bei Telefonanfrage sind alle Slots gesperrt
  if (istTelefonanfrage) {
    return 'gesperrt';
  }
  
  // Prüfe ob Slot bereits ausgewählt
  const slotKey = `${slot.start}_${slot.end}`;
  const istAusgewählt = ausgewählteTermine.some(t => `${t.start}_${t.end}` === slotKey);
  if (istAusgewählt) {
    return 'ausgewählt';
  }
  
  // Prüfe ob Slot durch Events belegt ist
  const slotStart = new Date(slot.start).getTime();
  const slotEnd = new Date(slot.end).getTime();
  
  let überschneidungen = 0;
  for (const event of alleEvents) {
    const eventStart = new Date(event.start).getTime();
    const eventEnd = new Date(event.end).getTime();
    
    // Überschneidung prüfen
    if (eventEnd > slotStart && eventStart < slotEnd) {
      überschneidungen++;
    }
  }
  
  // Slot ist belegt wenn 2 oder mehr Termine überschneiden
  return überschneidungen >= 2 ? 'belegt' : 'frei';
}

// ✅ IMPROVED: Slots laden mit separater Event-Speicherung
async function ladeFreieSlots() {
  const ladeIndikator = document.querySelector('.tage-grid');
  
  try {
    console.log('📅 Lade Slots und Events...');
    
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
    
    if (!data.freieSlots || !data.alleEvents) {
      throw new Error('Keine Termindaten vom Server erhalten');
    }

    // ✅ FIXED: Verwende lokale Slot-Generierung für vollständige Wochen
    alleSlots = generateVollständigeWochenSlots();
    alleEvents = data.alleEvents; // Belegte Events separat speichern

    console.log(`✅ ${alleSlots.length} Slots generiert, ${alleEvents.length} Events empfangen`);

    // UI aktualisieren
    aktualisiereWochenAnzeige();
    zeigeSlots();

  } catch (error) {
    console.error('Fehler beim Abrufen der Slots:', error);
    
    if (ladeIndikator) {
      ladeIndikator.innerHTML = `
        <div class="error-message">
          <p>❌ Termine konnten nicht geladen werden</p>
          <p style="font-size: 0.9em; color: #666;">${error.message}</p>
          <button onclick="ladeFreieSlots()" class="retry-btn">🔄 Erneut versuchen</button>
        </div>
      `;
    }
    
    zeigeFehlermeldung('Termine konnten nicht geladen werden. Bitte versuchen Sie es später erneut.');
  }
}

// ✅ IMPROVED: Wochenanzeige mit korrekten Datumsbereichen
function aktualisiereWochenAnzeige() {
  const montag = getMontagDerWoche(aktuelleWoche);
  const freitag = new Date(montag);
  freitag.setDate(montag.getDate() + 4); // +4 für Freitag

  const wochenDiv = document.getElementById('currentWeek');
  if (wochenDiv) {
    const formatter = new Intl.DateTimeFormat('de-DE', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric' 
    });
    
    wochenDiv.textContent = `${formatter.format(montag)} - ${formatter.format(freitag)}`;
  }

  // Navigation buttons
  const prevBtn = document.getElementById('prevWeek');
  const nextBtn = document.getElementById('nextWeek');
  
  if (prevBtn) prevBtn.disabled = aktuelleWoche <= 0;
  if (nextBtn) nextBtn.disabled = aktuelleWoche >= 3;
}

// ✅ COMPLETELY REWRITTEN: Slots anzeigen mit vollständiger Wochenstruktur
function zeigeSlots() {
  const container = document.querySelector('.tage-grid');
  if (!container || !alleSlots.length) return;

  // Slots für aktuelle Woche filtern
  const wochenSlots = alleSlots.filter(slot => slot.woche === aktuelleWoche);
  
  console.log(`📊 Zeige Woche ${aktuelleWoche}: ${wochenSlots.length} Slots`);

  if (wochenSlots.length === 0) {
    container.innerHTML = '<div class="no-slots">Keine Termine in dieser Woche verfügbar</div>';
    return;
  }

  // ✅ FIXED: Slots nach Tagen strukturiert gruppieren
  const tageStruktur = {
    0: { name: 'Montag', slots: [] },
    1: { name: 'Dienstag', slots: [] },
    2: { name: 'Mittwoch', slots: [] },
    3: { name: 'Donnerstag', slots: [] },
    4: { name: 'Freitag', slots: [] }
  };

  // Slots in Tage-Struktur einsortieren
  wochenSlots.forEach(slot => {
    if (tageStruktur[slot.tag]) {
      tageStruktur[slot.tag].slots.push(slot);
    }
  });

  // HTML generieren
  container.innerHTML = '';
  
  // ✅ Für jeden Wochentag eine Spalte erstellen
  Object.entries(tageStruktur).forEach(([tagIndex, tagData]) => {
    const tagDiv = document.createElement('div');
    tagDiv.className = 'day-column';
    
    // Tag-Header mit Datum
    const montag = getMontagDerWoche(aktuelleWoche);
    const tagDatum = new Date(montag);
    tagDatum.setDate(montag.getDate() + parseInt(tagIndex));
    
    const tagHeader = document.createElement('h4');
    tagHeader.className = 'day-header';
    tagHeader.textContent = `${tagData.name}\n${tagDatum.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit'
    })}`;
    tagDiv.appendChild(tagHeader);
    
    // ✅ Slots für diesen Tag anzeigen (auch belegte!)
    if (tagData.slots.length === 0) {
      const noSlotsDiv = document.createElement('div');
      noSlotsDiv.className = 'no-slots-day';
      noSlotsDiv.textContent = 'Keine Termine';
      tagDiv.appendChild(noSlotsDiv);
    } else {
      tagData.slots.forEach(slot => {
        const slotBtn = document.createElement('button');
        slotBtn.type = 'button';
        slotBtn.className = 'slot';
        
        const startTime = new Date(slot.start).toLocaleTimeString('de-DE', {
          hour: '2-digit',
          minute: '2-digit'
        });
        const endTime = new Date(slot.end).toLocaleTimeString('de-DE', {
          hour: '2-digit',
          minute: '2-digit'
        });
        
        slotBtn.textContent = `${startTime} - ${endTime}`;
        
        // ✅ Status des Slots bestimmen und CSS-Klassen setzen
        const status = getSlotStatus(slot);
        
        switch (status) {
          case 'frei':
            slotBtn.classList.add('frei');
            slotBtn.disabled = false;
            slotBtn.setAttribute('aria-pressed', 'false');
            break;
            
          case 'ausgewählt':
            slotBtn.classList.add('frei', 'selected');
            slotBtn.disabled = false;
            slotBtn.setAttribute('aria-pressed', 'true');
            break;
            
          case 'belegt':
            slotBtn.classList.add('belegt');
            slotBtn.disabled = true;
            slotBtn.title = 'Dieser Termin ist bereits belegt';
            break;
            
          case 'gesperrt':
            slotBtn.classList.add('gesperrt');
            slotBtn.disabled = true;
            slotBtn.title = 'Für Telefonanfragen nicht verfügbar';
            break;
        }
        
        // Click-Handler nur für freie/ausgewählte Slots
        if (status === 'frei' || status === 'ausgewählt') {
          slotBtn.addEventListener('click', () => toggleTerminauswahl(slot));
        }
        
        tagDiv.appendChild(slotBtn);
      });
    }
    
    container.appendChild(tagDiv);
  });

  console.log(`✅ Woche ${aktuelleWoche} angezeigt mit vollständiger Tagesstruktur`);
}

// Formularfunktionen (unverändert)
function sammelFormulardaten() {
  const formData = {
    problem: {
      Fenster: parseInt(document.getElementById('Fenster').value) || 0,
      Tueren: parseInt(document.getElementById('Tueren').value) || 0,
      Rolladen: parseInt(document.getElementById('Rolladen').value) || 0
    },
    
    beschreibung: document.getElementById('beschreibung').value.trim(),
    
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
    
    istTelefonanfrage: istTelefonanfrage,
    termine: istTelefonanfrage ? [] : ausgewählteTermine,
    
    datenschutz: document.getElementById('datenschutz').checked
  };

  return formData;
}

function validiereFormular(formData) {
  const fehler = [];

  const problemSumme = Object.values(formData.problem).reduce((sum, val) => sum + val, 0);
  if (problemSumme === 0) {
    fehler.push('Bitte wählen Sie mindestens ein Problem aus (Fenster, Türen oder Rollläden).');
  }

  if (!formData.beschreibung || formData.beschreibung.length < 10) {
    fehler.push('Bitte beschreiben Sie Ihr Anliegen (mindestens 10 Zeichen).');
  }

  if (!formData.kontakt.nachname) fehler.push('Nachname ist erforderlich.');
  if (!formData.kontakt.vorname) fehler.push('Vorname ist erforderlich.');
  if (!formData.kontakt.adresse) fehler.push('Adresse ist erforderlich.');
  if (!formData.kontakt.plz) fehler.push('PLZ ist erforderlich.');
  if (!formData.kontakt.ort) fehler.push('Ort ist erforderlich.');
  if (!formData.kontakt.email) fehler.push('E-Mail ist erforderlich.');
  if (!formData.kontakt.telefon) fehler.push('Telefon ist erforderlich.');

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (formData.kontakt.email && !emailRegex.test(formData.kontakt.email)) {
    fehler.push('Bitte geben Sie eine gültige E-Mail-Adresse ein.');
  }

  const plzRegex = /^\d{5}$/;
  if (formData.kontakt.plz && !plzRegex.test(formData.kontakt.plz)) {
    fehler.push('PLZ muss aus 5 Ziffern bestehen.');
  }

  if (!formData.istTelefonanfrage && formData.termine.length !== 3) {
    fehler.push('Bitte wählen Sie genau 3 Terminvorschläge aus.');
  }

  if (!formData.datenschutz) {
    fehler.push('Bitte akzeptieren Sie die Datenschutzerklärung.');
  }

  return fehler;
}

async function sendeFormular(event) {
  event.preventDefault();
  
  const submitButton = document.querySelector('button[type="submit"]');
  const formOverlay = document.querySelector('.form-overlay');
  const statusDiv = document.getElementById('formStatus');

  try {
    console.log('📤 Formular wird gesendet...');

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Wird gesendet...';
    }
    
    if (formOverlay) {
      formOverlay.style.display = 'flex';
      formOverlay.setAttribute('aria-hidden', 'false');
    }

    const formData = sammelFormulardaten();
    const validationErrors = validiereFormular(formData);

    if (validationErrors.length > 0) {
      throw new Error(validationErrors.join('\n'));
    }

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

    console.log('✅ Formular erfolgreich gesendet');
    
    if (statusDiv) {
      statusDiv.className = 'alert success';
      statusDiv.textContent = result.message || 'Ihre Anfrage wurde erfolgreich gesendet!';
      statusDiv.classList.remove('hidden');
      statusDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    document.getElementById('terminFormular').reset();
    ausgewählteTermine = [];
    aktualisiereTerminauswahl();

    if (typeof gtag === 'function') {
      gtag('event', 'form_submit', {
        'event_category': 'engagement',
        'event_label': istTelefonanfrage ? 'telefonanfrage' : 'vor_ort_anfrage'
      });
    }

  } catch (error) {
    console.error('❌ Fehler beim Senden:', error);
    
    if (statusDiv) {
      statusDiv.className = 'alert error';
      statusDiv.textContent = error.message || 'Fehler beim Senden der Anfrage. Bitte versuchen Sie es erneut.';
      statusDiv.classList.remove('hidden');
      statusDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    
    zeigeFehlermeldung(error.message);

  } finally {
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

// Hilfsfunktionen
function zeigeFehlermeldung(message) {
  const meldungDiv = document.getElementById('meldung');
  if (meldungDiv) {
    meldungDiv.textContent = message;
    meldungDiv.className = 'form-error';
    meldungDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function toggleTerminauswahl(slot) {
  if (istTelefonanfrage) return;

  const slotKey = `${slot.start}_${slot.end}`;
  const existingIndex = ausgewählteTermine.findIndex(t => `${t.start}_${t.end}` === slotKey);

  if (existingIndex >= 0) {
    ausgewählteTermine.splice(existingIndex, 1);
  } else if (ausgewählteTermine.length < 3) {
    ausgewählteTermine.push(slot);
  } else {
    zeigeFehlermeldung('Sie können maximal 3 Termine auswählen. Entfernen Sie zuerst einen anderen Termin.');
    return;
  }

  aktualisiereTerminauswahl();
}

function aktualisiereTerminauswahl() {
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
      meldungDiv.textContent = '3 Termine ausgewählt';
      meldungDiv.className = 'form-success';
    }
  }

  zeigeSlots();
}

// Event Listeners und Initialisierung
document.addEventListener('DOMContentLoaded', async function() {
  console.log('🚀 Terminanfrage Script initialisiert');

  try {
    await getCsrfToken();
    console.log('✅ CSRF Token vorgeladen');
  } catch (error) {
    console.error('⚠ CSRF Token Vorladung fehlgeschlagen:', error.message);
  }

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

  const form = document.getElementById('terminFormular');
  if (form) {
    form.addEventListener('submit', sendeFormular);
  }

  await ladeFreieSlots();
  
  console.log('✅ Terminanfrage Script vollständig geladen');
});

// Error Recovery
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