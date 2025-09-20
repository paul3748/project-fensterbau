function escapeHTML(str) {
  if (str === null || str === undefined) {
    return '';
  }
  return String(str).replace(/[&<>"]|'|`/g, match => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;', '`': '&#096;'
  }[match]));
}

let belegteOutlookSlots = [];

async function ladeBelegteOutlookSlots() {
  try {
    const res = await fetch('/outlook/events');
    const data = await res.json();

    console.log('📅 Outlook API Response:', data);

    if (!data || !data.success || !Array.isArray(data.events)) {
      console.warn('⚠️ Keine gültigen Events vom Server:', data);
      belegteOutlookSlots = [];
      return;
    }

    belegteOutlookSlots = data.events.map(ev => {
      const startRaw = ev.start?.dateTime || ev.start;
      const endRaw = ev.end?.dateTime || ev.end;
      const zone = ev.start?.timeZone || 'UTC';

      const start = luxon.DateTime.fromISO(startRaw, { zone }).toUTC().toISO();
      const end = luxon.DateTime.fromISO(endRaw, { zone }).toUTC().toISO();

      return { start, end };
    });

    console.log('✅ Belegte Outlook-Slots geladen:', belegteOutlookSlots.length);

  } catch (err) {
    console.error('⚠ Outlook Slots konnten nicht geladen werden:', err);
    belegteOutlookSlots = [];
  }
}

function terminUeberschneidet(slot, belegte) {
  const slotStart = luxon.DateTime.fromISO(slot.start).toUTC().toMillis();
  const slotEnd = luxon.DateTime.fromISO(slot.end).toUTC().toMillis();

  return belegte.some(event => {
    const eventStart = luxon.DateTime.fromISO(event.start).toUTC().toMillis();
    const eventEnd = luxon.DateTime.fromISO(event.end).toUTC().toMillis();
    return eventEnd > slotStart && eventStart < slotEnd;
  });
}

async function ladeAnfragen() {
  const typFilter = document.getElementById('filterTyp')?.value || "alle";
  const statusFilter = document.getElementById('filterStatus')?.value || "neu";

  await ladeBelegteOutlookSlots();
  
  try {
    const res = await fetch('/anfrage');
    const anfragen = await res.json();
    console.log("📋 Geladene Anfragen:", anfragen);
    
    const container = document.getElementById('anfrageContainer');
    container.innerHTML = '';
    
    const gefilterteAnfragen = anfragen.filter(anfrage => {
      if (typFilter === 'telefon' && !anfrage.istTelefonanfrage) return false;
      if (typFilter === 'vorort' && anfrage.istTelefonanfrage) return false;
      if (statusFilter === 'neu' && anfrage.status === 'erledigt') return false;
      if (statusFilter === 'bearbeitet' && anfrage.status !== 'erledigt') return false;
      return true;
    });

    if (gefilterteAnfragen.length === 0) {
      const keine = document.createElement('p');
      keine.className = "text-center text-gray-500 py-8";
      keine.textContent = "Keine Anfragen vorhanden.";
      container.appendChild(keine);
      return;
    }

    gefilterteAnfragen.forEach(anfrage => {
      // ✅ FIXED: Korrekte ID-Extraktion
      const anfrageId = anfrage.id || anfrage._id; // Beide Varianten berücksichtigen
      
      console.log("🔍 Verarbeite Anfrage:", {
        originalId: anfrage.id,
        _id: anfrage._id,
        anfrageId: anfrageId,
        istTelefonanfrage: anfrage.istTelefonanfrage,
        status: anfrage.status,
        terminAnzahl: anfrage.termine?.length || 0,
        termine: anfrage.termine,
        bestaetigterTermin: anfrage.bestaetigterTermin
      });
      
      if (!anfrageId) {
        console.error("❌ Keine gültige ID für Anfrage:", anfrage);
        return; // Skip diese Anfrage
      }

      const { beschreibung, termine, kontakt, problem, istTelefonanfrage, status, bestaetigterTermin } = anfrage;

      const dom = document.createElement('div');
      dom.className = "md:col-span-3 bg-white p-6 mb-4 shadow rounded-xl grid md:grid-cols-3 gap-6";

      const left = document.createElement('section');
      left.className = "md:col-span-2";

      const icons = document.createElement('div');
      icons.className = "mb-2 flex gap-4";
      
      const tuerenSpan = document.createElement('span');
      tuerenSpan.textContent = `🚪 Türen: ${problem?.Tueren ?? 0}`;
      icons.appendChild(tuerenSpan);
      
      const fensterSpan = document.createElement('span');
      fensterSpan.textContent = `🪟 Fenster: ${problem?.Fenster ?? 0}`;
      icons.appendChild(fensterSpan);
      
      const rolladenSpan = document.createElement('span');
      rolladenSpan.textContent = `🎛️ Rolladen: ${problem?.Rolladen ?? 0}`;
      icons.appendChild(rolladenSpan);
      
      if (istTelefonanfrage) {
        const telefonSpan = document.createElement('span');
        telefonSpan.className = "ml-auto text-sm px-2 py-1 bg-yellow-200 text-yellow-800 rounded";
        telefonSpan.textContent = "📞 Telefontermin";
        icons.appendChild(telefonSpan);
      }
      
      left.appendChild(icons);

      const nachricht = document.createElement('p');
      nachricht.className = "mb-4";
      const nachrichtBold = document.createElement('strong');
      nachrichtBold.textContent = "Nachricht:";
      nachricht.appendChild(nachrichtBold);
      nachricht.appendChild(document.createElement('br'));
      nachricht.appendChild(document.createTextNode(escapeHTML(String(beschreibung || ''))));
      left.appendChild(nachricht);

      const kontaktDiv = document.createElement('div');
      kontaktDiv.className = "grid md:grid-cols-2 gap-2 text-sm";
      
      const felder = [
        ["Name", `${kontakt?.vorname || ''} ${kontakt?.nachname || ''}`],
        ["Kundennummer", kontakt?.kundennummer || 'Keine Angabe'],
        ["Firma", kontakt?.firma || 'Keine Angabe'],
        ["Email", kontakt?.email || 'Keine Angabe'],
        ["Adresse", `${kontakt?.adresse || ''} ${kontakt?.plz || ''} ${kontakt?.ort || ''}`],
        ["Telefon", kontakt?.telefon || 'Keine Angabe']
      ];
      
      felder.forEach(([label, wert]) => {
        const div = document.createElement('div');
        const labelBold = document.createElement('strong');
        labelBold.textContent = label + ': ';
        div.appendChild(labelBold);
        div.appendChild(document.createTextNode(escapeHTML(String(wert || ''))));
        kontaktDiv.appendChild(div);
      });
      left.appendChild(kontaktDiv);

      const right = document.createElement('section');

      if (!istTelefonanfrage) {
        const terminLabel = document.createElement('label');
        terminLabel.className = "block mb-2 font-semibold";
        terminLabel.textContent = "1. Terminslot wählen (Datum)";
        right.appendChild(terminLabel);

        if (bestaetigterTermin?.start) {
          const start = new Date(bestaetigterTermin.start);
          const end = new Date(bestaetigterTermin.end);
          const text = `${start.toLocaleDateString('de-DE')} — ${start.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} bis ${end.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;

          const confirmed = document.createElement('p');
          confirmed.className = "text-green-700 font-semibold mb-2";
          confirmed.textContent = `✓ Bestätigt: ${text}`;
          right.appendChild(confirmed);
        }

        if (status !== 'erledigt') {
          const terminAuswahl = document.createElement('div');
          terminAuswahl.className = "flex flex-wrap gap-2 mb-4";

          // ✅ FIXED: Bessere Prüfung und Debugging für Termine
          console.log("🗓️ Termine für Anfrage", anfrageId, ":", termine);

          if (Array.isArray(termine) && termine.length > 0) {
            termine.forEach((t, index) => {
              console.log("📅 Verarbeite Termin", index, ":", t);
              
              const slot = { start: t.start, end: t.end };
              const istBelegt = terminUeberschneidet(slot, belegteOutlookSlots);
              const startDate = new Date(t.start);
              const endDate = new Date(t.end);
              
              // ✅ FIXED: Bessere Zeitformatierung mit Fehlerbehandlung
              let label;
              try {
                label = `${startDate.toLocaleDateString('de-DE')} — ${startDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} bis ${endDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
              } catch (error) {
                console.error("❌ Fehler bei Zeitformatierung:", error, t);
                label = `Termin ${index + 1} (${t.start} - ${t.end})`;
              }

              const slotButton = document.createElement('button');
              slotButton.textContent = label;
              slotButton.className = "px-3 py-1 rounded-full border transition text-sm";
              slotButton.dataset.index = index;

              // ✅ FIXED: Verbesserte Bestätigung-Check
              const istAusgewaehlt = bestaetigterTermin && (
                (t.start === bestaetigterTermin.start && t.end === bestaetigterTermin.end) ||
                (new Date(t.start).getTime() === new Date(bestaetigterTermin.start).getTime() && 
                 new Date(t.end).getTime() === new Date(bestaetigterTermin.end).getTime())
              );

              if (istAusgewaehlt) {
                slotButton.classList.add("bg-green-600", "text-white", "cursor-default", "border-green-600");
                slotButton.disabled = true;
                console.log("✅ Slot markiert als bestätigt:", t);
              } else if (bestaetigterTermin) {
                slotButton.classList.add("opacity-50", "cursor-not-allowed", "border-gray-300");
                slotButton.disabled = true;
                console.log("⏸️ Slot deaktiviert (anderer bestätigt):", t);
              } else {
                // Aktive Slots
                if (istBelegt) {
                  slotButton.classList.add("bg-orange-200", "text-orange-800", "border-orange-300");
                  console.log("🟠 Slot belegt:", t);
                } else {
                  slotButton.classList.add("border-gray-300", "hover:bg-gray-100");
                  console.log("⚪ Slot frei:", t);
                }

                slotButton.addEventListener('click', () => {
                  console.log("🔘 Slot ausgewählt:", t);
                  
                  // Reset alle anderen Buttons
                  terminAuswahl.querySelectorAll('button').forEach(btn => {
                    if (btn === slotButton || btn.disabled) return;
                    btn.classList.remove('ring-2', 'ring-blue-500');
                    const btnIndex = parseInt(btn.dataset.index);
                    const originalSlot = termine[btnIndex];
                    const originalIstBelegt = terminUeberschneidet({start: originalSlot.start, end: originalSlot.end}, belegteOutlookSlots);
                    btn.className = "px-3 py-1 rounded-full border transition text-sm";
                    if (originalIstBelegt) {
                      btn.classList.add("bg-orange-200", "text-orange-800", "border-orange-300");
                    } else {
                      btn.classList.add("border-gray-300", "hover:bg-gray-100");
                    }
                  });
                  
                  // Markiere gewählten Button
                  slotButton.classList.add('ring-2', 'ring-blue-500');
                  
                  // Speichere Auswahl
                  window[`selectedSlot-${anfrageId}`] = {
                    datum: startDate.toISOString().split('T')[0],
                    originalSlot: { start: t.start, end: t.end }
                  };
                  
                  console.log("💾 Slot gespeichert als:", window[`selectedSlot-${anfrageId}`]);
                });
              }

              terminAuswahl.appendChild(slotButton);
            });
          } else {
            // ✅ Keine Termine verfügbar - Warnung anzeigen
            const warnung = document.createElement('p');
            warnung.className = "text-amber-600 bg-amber-50 p-3 rounded border";
            warnung.innerHTML = "⚠️ Keine Terminvorschläge vorhanden.<br><small>Möglicherweise ist dies eine Telefonanfrage oder die Termine wurden nicht korrekt gespeichert.</small>";
            terminAuswahl.appendChild(warnung);
            console.warn("⚠️ Keine Termine für Anfrage:", anfrageId, "Termine:", termine);
          }

          right.appendChild(terminAuswahl);

          const zeitspanneLabel = document.createElement('label');
          zeitspanneLabel.className = "block mb-2 font-semibold mt-4";
          zeitspanneLabel.textContent = "2. Zeitspanne festlegen";
          right.appendChild(zeitspanneLabel);

          const zeitspanneContainer = document.createElement('div');
          zeitspanneContainer.id = `zeitspanne-${anfrageId}`;
          zeitspanneContainer.className = "grid grid-cols-2 gap-2 mb-4";

          function createQuarterHourTimePicker(idBase, placeholder = "") {
            const wrapper = document.createElement('div');
            wrapper.className = "flex gap-2";

            const hourSel = document.createElement('select');
            hourSel.id = `${idBase}-hour`;
            hourSel.className = "border rounded p-2";
            for (let h = 0; h < 24; h++) {
              const opt = document.createElement('option');
              opt.value = String(h).padStart(2, '0');
              opt.textContent = opt.value;
              hourSel.appendChild(opt);
            }

            const minuteSel = document.createElement('select');
            minuteSel.id = `${idBase}-minute`;
            minuteSel.className = "border rounded p-2";
            ["00", "15", "30", "45"].forEach(mm => {
              const opt = document.createElement('option');
              opt.value = mm;
              opt.textContent = mm;
              minuteSel.appendChild(opt);
            });

            const hidden = document.createElement('input');
            hidden.type = "time";
            hidden.id = idBase;
            hidden.name = idBase;
            hidden.className = "hidden";
            hidden.step = 900;
            if (placeholder) hidden.placeholder = placeholder;

            function sync() {
              hidden.value = `${hourSel.value}:${minuteSel.value}`;
            }
            hourSel.addEventListener('change', sync);
            minuteSel.addEventListener('change', sync);

            sync();

            wrapper.appendChild(hourSel);
            wrapper.appendChild(minuteSel);
            wrapper.appendChild(hidden);
            return wrapper;
          }

          const vonPicker = createQuarterHourTimePicker(`von-${anfrageId}`, "Von");
          zeitspanneContainer.appendChild(vonPicker);

          const bisPicker = createQuarterHourTimePicker(`bis-${anfrageId}`, "Bis");
          zeitspanneContainer.appendChild(bisPicker);

          right.appendChild(zeitspanneContainer);

          const bemerkungLabel = document.createElement('label');
          bemerkungLabel.className = "block mb-2 font-semibold mt-4";
          bemerkungLabel.textContent = "3. Bemerkung";
          right.appendChild(bemerkungLabel);

          const bemerkungInput = document.createElement('textarea');
          bemerkungInput.id = `bemerkung-${anfrageId}`;
          bemerkungInput.rows = 3;
          bemerkungInput.className = "w-full border rounded p-2 mb-4";
          bemerkungInput.placeholder = "Bemerkung für Monteur";
          right.appendChild(bemerkungInput);
        }
      }

      const buttons = document.createElement('div');
      buttons.className = "flex flex-col gap-2";

      if (status !== 'erledigt') {
        if (!istTelefonanfrage) {
          const ablehnenBtn = document.createElement('button');
          ablehnenBtn.textContent = "Anfrage ablehnen";
          ablehnenBtn.className = "bg-red-500 hover:bg-red-600 text-white py-2 rounded";
          // ✅ FIXED: Korrekte ID-Übergabe
          ablehnenBtn.addEventListener('click', () => {
            console.log("🔍 Ablehnen Button clicked für ID:", anfrageId);
            ablehnen(anfrageId);
          });
          buttons.appendChild(ablehnenBtn);

          const bestaetigenBtn = document.createElement('button');
          bestaetigenBtn.textContent = "Termin bestätigen";
          bestaetigenBtn.className = "bg-blue-600 hover:bg-blue-700 text-white py-2 rounded font-semibold";
          // ✅ FIXED: Korrekte ID-Übergabe
          bestaetigenBtn.addEventListener('click', () => {
            console.log("🔍 Bestätigen Button clicked für ID:", anfrageId);
            bestaetigeTermin(anfrageId);
          });
          buttons.appendChild(bestaetigenBtn);
        } else {
          const erledigtBtn = document.createElement('button');
          erledigtBtn.textContent = "Als bearbeitet markieren";
          erledigtBtn.className = "bg-blue-600 hover:bg-blue-700 text-white py-2 rounded font-semibold";
          erledigtBtn.addEventListener('click', async () => {
            console.log("🔍 Erledigt Button clicked für ID:", anfrageId);
            const res = await fetch(`/anfrage/${anfrageId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ nurStatusUpdate: true })
            });
            if (res.ok) {
              alert("Anfrage als erledigt markiert.");
              ladeAnfragen();
            } else {
              alert("Fehler beim Status-Update.");
            }
          });
          buttons.appendChild(erledigtBtn);
        }
      }

      const loeschBtn = document.createElement('button');
      loeschBtn.textContent = "Anfrage löschen";
      loeschBtn.className = "bg-red-800 hover:bg-red-900 text-white py-2 rounded";
      loeschBtn.addEventListener('click', async () => {
        console.log("🔍 Löschen Button clicked für ID:", anfrageId);
        if (!confirm("Diese Anfrage wirklich löschen? (Ohne Email-Versand)")) return;
        const res = await fetch(`/anfrage/${anfrageId}`, { method: 'DELETE' });
        if (res.ok) {
          alert("Anfrage gelöscht.");
          ladeAnfragen();
        } else {
          alert("Fehler beim Löschen.");
        }
      });
      buttons.appendChild(loeschBtn);

      right.appendChild(buttons);
      dom.appendChild(left);
      dom.appendChild(right);

      const erstelltAm = new Date(anfrage.createdAt || anfrage.erstelltAm);
      const erstelltInfo = document.createElement('p');
      erstelltInfo.className = "text-xs text-gray-500 mt-2 col-span-3";
      erstelltInfo.textContent = `Erstellt am: ${erstelltAm.toLocaleDateString('de-DE')} ${erstelltAm.toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit'})} | ID: ${anfrageId}`;
      dom.appendChild(erstelltInfo);

      container.appendChild(dom);
    });
    
  } catch (error) {
    console.error("❌ Fehler beim Laden der Anfragen:", error);
    const container = document.getElementById('anfrageContainer');
    container.innerHTML = '<p class="text-center text-red-500 py-8">Fehler beim Laden der Anfragen</p>';
  }
}

// ✅ FIXED: Verbesserte Ablehnen-Funktion mit korrekter Route
async function ablehnen(id) {
  console.log("❌ Ablehnen aufgerufen für ID:", id);
  
  if (!id || id === 'undefined') {
    console.error("❌ Ungültige ID für ablehnen:", id);
    alert("Fehler: Ungültige Anfrage-ID");
    return;
  }
  
  if (!confirm("Anfrage wirklich ablehnen? (Email wird versendet)")) return;

  try {
    const bemerkung = document.getElementById(`bemerkung-${id}`)?.value?.trim() || '';
    
    console.log("📤 Sende Ablehnungsanfrage für ID:", id, "mit Bemerkung:", bemerkung);

    // ✅ FIXED: Korrekte Route für Ablehnung mit Email
    const res = await fetch(`/anfrage/${id}/ablehnen`, {
      method: 'POST', // Nicht DELETE!
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bemerkung })
    });

    if (res.ok) {
      const result = await res.json();
      console.log("✅ Ablehnung erfolgreich:", result);
      alert("Anfrage abgelehnt und Email versendet.");
      ladeAnfragen();
    } else {
      const error = await res.text();
      console.error("❌ Fehler beim Ablehnen:", res.status, error);
      alert("Fehler beim Ablehnen: " + error);
    }
  } catch (error) {
    console.error("❌ Network-Fehler beim Ablehnen:", error);
    alert("Netzwerkfehler beim Ablehnen.");
  }
}

// ✅ FIXED: Verbesserte Bestätigen-Funktion
async function bestaetigeTermin(id) {
  console.log("✅ Bestätigen aufgerufen für ID:", id);
  
  if (!id || id === 'undefined') {
    console.error("❌ Ungültige ID für bestätigen:", id);
    alert("Fehler: Ungültige Anfrage-ID");
    return;
  }
  
  const selectedSlot = window[`selectedSlot-${id}`];
  const vonZeit = document.getElementById(`von-${id}`)?.value;
  const bisZeit = document.getElementById(`bis-${id}`)?.value;
  const bemerkung = document.getElementById(`bemerkung-${id}`)?.value?.trim() || '';

  if (!selectedSlot) {
    alert("Bitte einen Terminslot auswählen.");
    return;
  }

  if (!vonZeit || !bisZeit) {
    alert("Bitte Start- und Endzeit eingeben.");
    return;
  }

  // Datum vom Slot + Zeit von manueller Eingabe kombinieren
  const startDateTime = new Date(`${selectedSlot.datum}T${vonZeit}:00`);
  const endDateTime = new Date(`${selectedSlot.datum}T${bisZeit}:00`);

  if (endDateTime <= startDateTime) {
    alert("Die Endzeit muss nach der Startzeit liegen.");
    return;
  }

  try {
    console.log("📤 Sende Bestätigungsanfrage für ID:", id);
    
    const res = await fetch(`/anfrage/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        start: startDateTime.toISOString(),
        end: endDateTime.toISOString(),
        bemerkung
      })
    });

    if (res.ok) {
      const result = await res.json();
      console.log("✅ Bestätigung erfolgreich:", result);
      alert(`Termin bestätigt für ${selectedSlot.datum} von ${vonZeit} bis ${bisZeit}`);
      ladeAnfragen();
    } else {
      const error = await res.text();
      console.error("❌ Fehler beim Bestätigen:", res.status, error);
      alert("Fehler beim Bestätigen: " + error);
    }
  } catch (error) {
    console.error("❌ Network-Fehler beim Bestätigen:", error);
    alert("Netzwerkfehler beim Bestätigen.");
  }
}

// ✅ Logout-Funktion
async function logout() {
  try {
    await fetch('/logout', { method: 'POST' });
    window.location.href = '/';
  } catch (error) {
    console.error("❌ Logout-Fehler:", error);
    // Trotzdem weiterleiten
    window.location.href = '/';
  }
}

// ✅ Initialization
document.addEventListener('DOMContentLoaded', () => {
  console.log("🚀 Admin.js initialisiert");
  
  // Lade initial die Anfragen
  ladeAnfragen();
  
  // Event-Listener für Filter
  const filterTyp = document.getElementById("filterTyp");
  const filterStatus = document.getElementById("filterStatus");
  
  if (filterTyp) filterTyp.addEventListener("change", ladeAnfragen);
  if (filterStatus) filterStatus.addEventListener("change", ladeAnfragen);
  
  // ✅ Logout Button Event-Listener
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', logout);
  }
});


