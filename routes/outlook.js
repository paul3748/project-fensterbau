const express = require('express');
const router = express.Router();
const { ConfidentialClientApplication } = require('@azure/msal-node');
const axios = require('axios');
const { DateTime } = require('luxon');
router.get('/test', (req,res) => res.send('Router funktioniert'));

console.log('Outlook-Router geladen');
router.use((req,res,next)=>{ console.log('[DEBUG Outlook]', req.method, req.path); next(); });


// MSAL-Konfiguration
const msalConfig = {
  auth: {
    clientId: process.env.CLIENT_ID,
    authority: `https://login.microsoftonline.com/${process.env.TENANT_ID}`,
    clientSecret: process.env.CLIENT_SECRET,
  },
};

const cca = new ConfidentialClientApplication(msalConfig);

// Token abrufen
async function getToken() {
  const result = await cca.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });
  return result.accessToken;
}

// Rufe Kalendereinträge ab
router.get('/events', async (req, res) => {
  try {
    const token = await getToken();

    const response = await axios.get(
        `https://graph.microsoft.com/v1.0/users/${process.env.OUTLOOK_USER_EMAIL}/calendar/events`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    res.json(response.data.value);
  } catch (err) {
    console.error('Fehler beim Abrufen der Kalenderdaten:', err.message);
    res.status(500).send('Fehler beim Abrufen der Kalenderdaten');
  }
});

const { filterFreieSlots } = require('../utils/kalenderUtils');

// Zeit-Slots generieren (wie im Frontend)
function generateZeitslots() {
  const slots = [];
  const heute = new Date();

  const zeitbloecke = [
    { startStunde: 7, startMinute: 30, endStunde: 10, endMinute: 30 },
    { startStunde: 10, startMinute: 30, endStunde: 13, endMinute: 0 },
    { startStunde: 13, startMinute: 0, endStunde: 15, endMinute: 0 },
  ];

  for (let tag = 1; tag < 28; tag++) {
    const datum = new Date(heute);
    datum.setHours(0,0,0,0);                 // Tagesbeginn
    datum.setDate(datum.getDate() + tag);
    const wochentag = datum.getDay();
    if (wochentag === 0 || wochentag === 6) continue; // Wochenende überspringen

    for (const block of zeitbloecke) {
      const start = new Date(datum);
      start.setHours(block.startStunde, block.startMinute, 0, 0);
      const end = new Date(datum);
      end.setHours(block.endStunde, block.endMinute, 0, 0);
      slots.push({ start: start.toISOString(), end: end.toISOString() });
    }
  }
  return slots;
}

// Neue Route: Freie Slots - jetzt mit beiden Datensätzen
router.get('/freie-slots', async (req, res) => {
  try {
    const token = await getToken();

    const response = await axios.get(
      `https://graph.microsoft.com/v1.0/users/${process.env.OUTLOOK_USER_EMAIL}/calendar/events`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    // Alle Events mit korrekter Zeitzonenkonvertierung
    const belegteEvents = response.data.value.map(event => ({
      start: DateTime.fromISO(event.start.dateTime, { zone: event.start.timeZone }).toUTC().toISO(),
      end: DateTime.fromISO(event.end.dateTime, { zone: event.end.timeZone }).toUTC().toISO(),
    }));

    const alleSlots = generateZeitslots();
    
    console.log(`Generated ${alleSlots.length} slots`); // Debug
    console.log(`Found ${belegteEvents.length} events`); // Debug
    
    // Filter mit maxOverlap = 1 (bei 2 Terminen im Slot wird blockiert)
    const freieSlots = filterFreieSlots(alleSlots, belegteEvents, 1);
    
    console.log(`Filtered to ${freieSlots.length} free slots (allowing max 1 appointment per slot)`); // Debug

    // Beide Datensätze zurückgeben
    res.json({
      freieSlots: freieSlots,
      alleEvents: belegteEvents,
      debug: {
        totalSlots: alleSlots.length,
        totalEvents: belegteEvents.length,
        freeSlots: freieSlots.length
      }
    });
    
  } catch (err) {
    console.error("Fehler bei Outlook-Slots:", err.message);
    res.status(500).json({ error: "Fehler beim Abrufen freier Slots", message: err.message });
  }
});

async function erstelleKalendereintrag(anfrage, start, end, bemerkung) {
  const token = await getToken();

  const problemPlain = anfrage.problem?.toObject ? anfrage.problem.toObject() : anfrage.problem;

  const problemText = Object.entries(problemPlain || {})
    .filter(([key]) => key !== '_id')
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ');

  const adresseText = `${anfrage.kontakt.adresse}, ${anfrage.kontakt.plz} ${anfrage.kontakt.ort}`;

  const body = {
    subject: `Termin ${anfrage.kontakt.vorname} ${anfrage.kontakt.nachname}`,
    body: {
      contentType: 'HTML',
      content: `
        <p><strong>Name:</strong> ${anfrage.kontakt.vorname} ${anfrage.kontakt.nachname}</p>
        <p><strong>Problem:</strong> ${problemText}</p>
        <p><strong>Beschreibung:</strong><br>${anfrage.beschreibung}</p>
        <p><strong>Telefon:</strong> ${anfrage.kontakt.telefon}</p>
        <p><strong>Email:</strong> ${anfrage.kontakt.email}</p>
        ${bemerkung ? `<p><strong>Bemerkung:</strong><br>${bemerkung}</p>` : ''}
      `
    },
    start: {
      dateTime: start,
      timeZone: 'Europe/Berlin'
    },
    end: {
      dateTime: end,
      timeZone: 'Europe/Berlin'
    },
    location: {
      displayName: adresseText || 'Unbekannte Adresse'
    },
    attendees: [],
    isOnlineMeeting: false
  };

  const response = await axios.post(
    `https://graph.microsoft.com/v1.0/users/${process.env.OUTLOOK_USER_EMAIL}/calendar/events`,
    body,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return response.data;
}

module.exports = router;
module.exports.erstelleKalendereintrag = erstelleKalendereintrag;