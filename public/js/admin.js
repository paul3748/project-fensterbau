function escapeHTML(str) {
  return str.replace(/[&<>"']/g, match => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[match]));
}

let belegteOutlookSlots = [];

async function ladeBelegteOutlookSlots() {
  try {
    const res = await fetch('/outlook/events');
    const events = await res.json();

    belegteOutlookSlots = events.map(ev => {
      const startRaw = ev.start?.dateTime || ev.start;
      const endRaw = ev.end?.dateTime || ev.end;
      const zone = ev.start?.timeZone || 'UTC';

      const start = luxon.DateTime.fromISO(startRaw, { zone }).toUTC().toISO();
      const end = luxon.DateTime.fromISO(endRaw, { zone }).toUTC().toISO();

      return { start, end };
    });

    console.log('✅ Belegte Outlook-Slots geladen:', belegteOutlookSlots);

  } catch (err) {
    console.error('⚠ Outlook Slots konnten nicht geladen werden:', err);
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
  const res = await fetch('/anfrage');
  const anfragen = await res.json();
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
    const { _id, beschreibung, termine, kontakt, problem, istTelefonanfrage, status, bestaetigterTermin } = anfrage;

    const dom = document.createElement('div');
    dom.className = "md:col-span-3 bg-white p-6 mb-4 shadow rounded-xl grid md:grid-cols-3 gap-6";

    const left = document.createElement('section');
    left.className = "md:col-span-2";

    const icons = document.createElement('div');
    icons.className = "mb-2 flex gap-4";
    icons.innerHTML = `
    <span>🚪 Türen: ${problem?.Tueren ?? 0}</span>
    <span>🪟 Fenster: ${problem?.Fenster ?? 0}</span>
    <span>🎛️ Rolladen: ${problem?.Rolladen ?? 0}</span>
      ${istTelefonanfrage ? '<span class="ml-auto text-sm px-2 py-1 bg-yellow-200 text-yellow-800 rounded">📞 Telefontermin</span>' : ''}
    `;
    left.appendChild(icons);

    const nachricht = document.createElement('p');
    nachricht.className = "mb-4";
    nachricht.innerHTML = `<strong>Nachricht:</strong><br>${escapeHTML(beschreibung || '')}`;
    left.appendChild(nachricht);

    const kontaktDiv = document.createElement('div');
    kontaktDiv.className = "grid md:grid-cols-2 gap-2 text-sm";
    const felder = [
      ["Name", `${kontakt.vorname} ${kontakt.nachname}`],
      ["Kundennummer", kontakt.kundennummer || 'Keine Angabe'],
      ["Firma", kontakt.firma || 'Keine Angabe'],
      ["Email", kontakt.email],
      ["Adresse", `${kontakt.adresse} ${kontakt.plz} ${kontakt.ort}`],
      ["Telefon", kontakt.telefon]
    ];
    felder.forEach(([label, wert]) => {
      const div = document.createElement('div');
      div.innerHTML = `<strong>${label}:</strong> ${escapeHTML(wert)}`;
      kontaktDiv.appendChild(div);
    });
    left.appendChild(kontaktDiv);

    const right = document.createElement('section');

    // 📅 Termin-Anzeige für Vor-Ort-Anfragen
    if (!istTelefonanfrage) {
      const terminLabel = document.createElement('label');
      terminLabel.className = "block mb-2 font-semibold";
      terminLabel.textContent = "1. Terminslot wählen (Datum)";
      right.appendChild(terminLabel);

      // ✅ Bestätigter Termin immer anzeigen
      if (bestaetigterTermin?.start) {
        const start = new Date(bestaetigterTermin.start);
        const end = new Date(bestaetigterTermin.end);
        const text = `${start.toLocaleDateString('de-DE')} — ${start.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} bis ${end.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;

        const confirmed = document.createElement('p');
        confirmed.className = "text-green-700 font-semibold mb-2";
        confirmed.textContent = `✓ Bestätigt: ${text}`;
        right.appendChild(confirmed);
      }

      // 🗓️ Termin-Auswahl nur wenn nicht erledigt
      if (status !== 'erledigt') {
        const terminAuswahl = document.createElement('div');
        terminAuswahl.className = "flex flex-wrap gap-2 mb-4";

        termine.forEach((t, index) => {
          const slot = { start: t.start, end: t.end };
          const istBelegt = terminUeberschneidet(slot, belegteOutlookSlots);
          const startDate = new Date(t.start);
          const endDate = new Date(t.end);
          const label = `${startDate.toLocaleDateString('de-DE')} — ${startDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} bis ${endDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;

          const slotButton = document.createElement('button');
          slotButton.textContent = label;
          slotButton.className = "px-3 py-1 rounded-full border transition text-sm";
          slotButton.dataset.index = index; // Index hinzufügen für eindeutige Identifikation

          const istAusgewaehlt = bestaetigterTermin &&
            t.start === bestaetigterTermin.start &&
            t.end === bestaetigterTermin.end;

          if (istAusgewaehlt) {
            slotButton.classList.add("bg-green-600", "text-white", "cursor-default", "border-green-600");
            slotButton.disabled = true;
          } else if (bestaetigterTermin) {
            slotButton.classList.add("opacity-50", "cursor-not-allowed", "border-gray-300");
            slotButton.disabled = true;
          } else {
            // Alle Slots sind klickbar - setze initiale Farbe basierend auf Verfügbarkeit
            if (istBelegt) {
              // 🟠 Orange für belegte Slots
              slotButton.classList.add("bg-orange-200", "text-orange-800", "border-orange-300");
            } else {
              // ⚪ Weiß für freie Slots
              slotButton.classList.add("border-gray-300", "hover:bg-gray-100");
            }

            slotButton.addEventListener('click', () => {
              // Reset alle anderen Buttons zu ihrem ursprünglichen Zustand
              terminAuswahl.querySelectorAll('button').forEach(btn => {
                if (btn === slotButton || btn.disabled) return;
                
                // Entferne Ring
                btn.classList.remove('ring-2', 'ring-blue-500');
                
                // Bestimme ursprüngliche Farbe basierend auf dem spezifischen Slot
                const btnIndex = parseInt(btn.dataset.index);
                const originalSlot = termine[btnIndex];
                const originalIstBelegt = terminUeberschneidet({start: originalSlot.start, end: originalSlot.end}, belegteOutlookSlots);
                
                // Setze Klassen zurück
                btn.className = "px-3 py-1 rounded-full border transition text-sm";
                if (originalIstBelegt) {
                  btn.classList.add("bg-orange-200", "text-orange-800", "border-orange-300");
                } else {
                  btn.classList.add("border-gray-300", "hover:bg-gray-100");
                }
              });
              
              // Markiere den gewählten Slot mit Ring (aber Farbe bleibt)
              slotButton.classList.add('ring-2', 'ring-blue-500');

              // Speichere gewählten Slot (Datum + Original für Email)
              window[`selectedSlot-${_id}`] = {
                datum: startDate.toISOString().split('T')[0], // Nur das Datum
                originalSlot: { start: t.start, end: t.end }  // Für Email-Anzeige
              };
            });
          }

          terminAuswahl.appendChild(slotButton);
        });

        right.appendChild(terminAuswahl);

        // 🕐 Zeitspanne für gewähltes Datum
        const zeitspanneLabel = document.createElement('label');
        zeitspanneLabel.className = "block mb-2 font-semibold mt-4";
        zeitspanneLabel.textContent = "2. Zeitspanne festlegen";
        right.appendChild(zeitspanneLabel);

        const zeitspanneContainer = document.createElement('div');
        zeitspanneContainer.id = `zeitspanne-${_id}`;
        zeitspanneContainer.className = "grid grid-cols-2 gap-2 mb-4";

        // Helper: 15-Minuten-Select + hidden time-Input (kompatibel zu deinem Code)
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

          // Verstecktes echtes <input type="time"> damit dein restlicher Code weiter funktioniert
          const hidden = document.createElement('input');
          hidden.type = "time";
          hidden.id = idBase;             // gleiche ID wie bisher (z.B. "von-123")
          hidden.name = idBase;           // ggf. anpassen, falls du ein anderes name brauchst
          hidden.className = "hidden";    // nicht anzeigen
          hidden.step = 900;              // 15-Minuten Schritte erzwingen/validieren
          if (placeholder) hidden.placeholder = placeholder;

          function sync() {
            hidden.value = `${hourSel.value}:${minuteSel.value}`;
          }
          hourSel.addEventListener('change', sync);
          minuteSel.addEventListener('change', sync);

          // Initial setzen
          sync();

          wrapper.appendChild(hourSel);
          wrapper.appendChild(minuteSel);
          wrapper.appendChild(hidden);
          return wrapper;
        }

        // "Von"
        const vonPicker = createQuarterHourTimePicker(`von-${_id}`, "Von");
        zeitspanneContainer.appendChild(vonPicker);

        // "Bis"
        const bisPicker = createQuarterHourTimePicker(`bis-${_id}`, "Bis");
        zeitspanneContainer.appendChild(bisPicker);

        right.appendChild(zeitspanneContainer);

        // ✏️ Bemerkung
        const bemerkungLabel = document.createElement('label');
        bemerkungLabel.className = "block mb-2 font-semibold mt-4";
        bemerkungLabel.textContent = "3. Bemerkung";
        right.appendChild(bemerkungLabel);

        const bemerkungInput = document.createElement('textarea');
        bemerkungInput.id = `bemerkung-${_id}`;
        bemerkungInput.rows = 3;
        bemerkungInput.className = "w-full border rounded p-2 mb-4";
        bemerkungInput.placeholder = "Bemerkung für Monteur";
        right.appendChild(bemerkungInput);
      }
    }

    // 📘 Buttons
    const buttons = document.createElement('div');
    buttons.className = "flex flex-col gap-2";

    if (status !== 'erledigt') {
      if (!istTelefonanfrage) {
        // Vor-Ort: Bestätigen + Ablehnen
        buttons.innerHTML = `
          <button onclick="ablehnen('${_id}')" class="bg-red-500 hover:bg-red-600 text-white py-2 rounded">Anfrage ablehnen</button>
          <button onclick="bestaetigeTermin('${_id}')" class="bg-blue-600 hover:bg-blue-700 text-white py-2 rounded font-semibold">Termin bestätigen</button>
        `;
      } else {
        // Telefon: Als bearbeitet
        const erledigtBtn = document.createElement('button');
        erledigtBtn.textContent = "Als bearbeitet markieren";
        erledigtBtn.className = "bg-blue-600 hover:bg-blue-700 text-white py-2 rounded font-semibold";
        erledigtBtn.addEventListener('click', async () => {
          const res = await fetch(`/anfrage/${_id}`, {
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

    // 🗒 Löschen immer erlaubt
    const loeschBtn = document.createElement('button');
    loeschBtn.textContent = "Anfrage löschen";
    loeschBtn.className = "bg-red-800 hover:bg-red-900 text-white py-2 rounded";
    loeschBtn.addEventListener('click', async () => {
      if (!confirm("Diese Anfrage wirklich löschen? (Ohne Email-Versand)")) return;
      const res = await fetch(`/anfrage/${_id}`, { method: 'DELETE' });
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

    // 📅 Erstellt am
    const erstelltAm = new Date(anfrage.createdAt || anfrage.erstelltAm);
    const erstelltInfo = document.createElement('p');
    erstelltInfo.className = "text-xs text-gray-500 mt-2";
    erstelltInfo.textContent = `Erstellt am: ${erstelltAm.toLocaleDateString('de-DE')} ${erstelltAm.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
    dom.appendChild(erstelltInfo);

    container.appendChild(dom);
  });
}

async function bestaetigeTermin(id) {
  const bemerkungEl = document.getElementById(`bemerkung-${id}`);
  const bemerkung = bemerkungEl ? bemerkungEl.value.trim() : '';

  const selectedSlot = window[`selectedSlot-${id}`];
  const vonZeit = document.getElementById(`von-${id}`)?.value;
  const bisZeit = document.getElementById(`bis-${id}`)?.value;

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
    alert(`Termin bestätigt für ${selectedSlot.datum} von ${vonZeit} bis ${bisZeit}`);
    ladeAnfragen();
  } else {
    alert("Fehler beim Bestätigen.");
  }
}

// ❌ Ablehnen mit Email
async function ablehnen(id) {
  if (!confirm("Wirklich ablehnen? (Email wird versendet)")) return;

  const bemerkung = document.getElementById(`bemerkung-${id}`)?.value.trim() || '';

  // Verwende spezifische Route für Ablehnen
  await fetch(`/anfrage/${id}/ablehnen`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bemerkung })
  });

  alert("Anfrage abgelehnt und Email versendet.");
  ladeAnfragen();
}

async function logout() {
  await fetch('/logout', { method: 'POST' });
  window.location.href = '/';
}

ladeAnfragen();
document.getElementById("filterTyp").addEventListener("change", ladeAnfragen);
document.getElementById("filterStatus").addEventListener("change", ladeAnfragen);