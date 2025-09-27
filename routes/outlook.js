// routes/outlook.js - FIXED VERSION mit vollständigen Kalenderwochen

const express = require('express');
const router = express.Router();
const { ConfidentialClientApplication } = require('@azure/msal-node');
const axios = require('axios');
const { DateTime } = require('luxon');
const { logger, logSecurityEvent } = require('../utils/logger');

console.log('✅ Outlook-Router geladen mit Kalenderwochen-Updates');

// MSAL-Konfiguration (unverändert)
const msalConfig = {
  auth: {
    clientId: process.env.CLIENT_ID,
    authority: `https://login.microsoftonline.com/${process.env.TENANT_ID}`,
    clientSecret: process.env.CLIENT_SECRET,
  },
};

const cca = new ConfidentialClientApplication(msalConfig);

// Token abrufen (unverändert)
async function getToken() {
  try {
    const result = await cca.acquireTokenByClientCredential({
      scopes: ['https://graph.microsoft.com/.default'],
    });
    
    if (!result || !result.accessToken) {
      throw new Error('Token-Acquisition fehlgeschlagen');
    }
    
    return result.accessToken;
  } catch (error) {
    console.error('❌ MSAL Token Error:', error.message);
    throw new Error(`Authentifizierung fehlgeschlagen: ${error.message}`);
  }
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
    
    console.log(`📅 Generiere Woche ${woche}: Montag ${montag.toLocaleDateString('de-DE')}`);
    
    // Generiere Slots für Montag bis Freitag dieser Woche
    for (let tag = 0; tag < 5; tag++) { // 0=Montag, 4=Freitag
      const datum = new Date(montag);
      datum.setDate(montag.getDate() + tag);
      
      // ✅ WICHTIG: Alle Slots generieren, auch vergangene (Frontend entscheidet über Verfügbarkeit)
      for (const block of zeitbloecke) {
        const start = new Date(datum);
        start.setHours(block.startStunde, block.startMinute, 0, 0);
        const end = new Date(datum);
        end.setHours(block.endStunde, block.endMinute, 0, 0);
        
        slots.push({ 
          start: start.toISOString(), 
          end: end.toISOString(),
          woche: woche,
          tag: tag, // 0=Montag, 1=Dienstag, etc.
          isPast: start <= heute // ✅ Vergangene Slots markieren
        });
      }
    }
  }
  
  console.log(`📅 Backend: ${slots.length} Slots für 4 vollständige Kalenderwochen generiert`);
  return slots;
}

// ✅ AKTUALISIERTE Route: Freie Slots mit vollständigen Kalenderwochen
router.get('/freie-slots', async (req, res) => {
  try {
    console.log('📅 Öffentliche Slot-Abfrage von:', req.ip, {
      userAgent: req.headers['user-agent']?.substring(0, 50) + '...',
      timestamp: new Date().toISOString()
    });

    const token = await getToken();

    // Events vom Outlook-Kalender holen
    const response = await axios.get(
      `https://graph.microsoft.com/v1.0/users/${process.env.OUTLOOK_USER_EMAIL}/calendar/events`,
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000
      }
    );

    // Alle Events mit korrekter Zeitzonenkonvertierung
    const belegteEvents = response.data.value.map(event => ({
      start: DateTime.fromISO(event.start.dateTime, { zone: event.start.timeZone }).toUTC().toISO(),
      end: DateTime.fromISO(event.end.dateTime, { zone: event.end.timeZone }).toUTC().toISO(),
      subject: event.subject || 'Unbekannt'
    }));

    // ✅ FIXED: Verwende neue Slot-Generation für vollständige Wochen
    const alleSlots = generateVollständigeWochenSlots();
    
    console.log(`📊 Backend Slot-Generierung: ${alleSlots.length} Slots, ${belegteEvents.length} Events`);
    
    // ✅ Filtere nur für "freieSlots" Rückgabe (für Kompatibilität)
    const { filterFreieSlots } = require('../utils/kalenderUtils');
    const nurFreieSlots = filterFreieSlots(alleSlots, belegteEvents, 1);
    
    console.log(`✅ Gefiltert auf ${nurFreieSlots.length} freie Slots (max 2 Termine pro Slot)`);

    // Erfolgreiche Abfrage loggen
    logger.info('Öffentliche Slot-Abfrage erfolgreich', {
      ip: req.ip,
      totalSlots: alleSlots.length,
      totalEvents: belegteEvents.length,
      freeSlots: nurFreieSlots.length,
      userAgent: req.headers['user-agent']
    });

    // ✅ UPDATED: Sowohl alle Slots als auch Events zurückgeben
    res.json({
      // Für Frontend: Alle Slots (inklusive belegter) mit Wochenstruktur
      alleSlots: alleSlots,
      
      // Für Kompatibilität: Nur freie Slots
      freieSlots: nurFreieSlots,
      
      // Alle Events für Belegungsprüfung
      alleEvents: belegteEvents,
      
      debug: {
        totalSlots: alleSlots.length,
        totalEvents: belegteEvents.length,
        freeSlots: nurFreieSlots.length,
        generatedAt: new Date().toISOString(),
        wochenStruktur: 'Vollständige Kalenderwochen ab nächstem Montag'
      }
    });
    
  } catch (err) {
    console.error("❌ Fehler bei öffentlicher Slot-Abfrage:", err.message);
    
    logSecurityEvent('OUTLOOK_API_ERROR', req, {
      error: err.message,
      endpoint: '/freie-slots'
    });
    
    res.status(500).json({ 
      success: false,
      error: "Fehler beim Abrufen freier Slots", 
      message: process.env.NODE_ENV === 'development' ? err.message : 'Service temporär nicht verfügbar'
    });
  }
});

// Alternative öffentliche Route (für Kompatibilität)
router.get('/available-slots', async (req, res) => {
  console.log('🔄 Weiterleitung von /available-slots zu /freie-slots');
  req.url = '/freie-slots';
  return router.handle(req, res);
});

// ✅ GESCHÜTZTE ADMIN-ENDPUNKTE
// Diese werden automatisch durch routeSecurityMiddleware geschützt

// Alle Kalenderereignisse abrufen (nur Admin)
router.get('/events', async (req, res) => {
  try {
    console.log('📋 Admin fragt alle Events ab:', {
      userId: req.session.user.id,
      username: req.session.user.username,
      ip: req.ip
    });

    const token = await getToken();

    const response = await axios.get(
      `https://graph.microsoft.com/v1.0/users/${process.env.OUTLOOK_USER_EMAIL}/calendar/events`,
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000
      }
    );

    logger.info('Admin Events-Abfrage', {
      userId: req.session.user.id,
      username: req.session.user.username,
      eventCount: response.data.value.length
    });

    res.json({
      success: true,
      events: response.data.value,
      count: response.data.value.length,
      retrievedAt: new Date().toISOString()
    });
    
  } catch (err) {
    console.error('❌ Fehler bei Admin Events-Abfrage:', err.message);
    
    logSecurityEvent('ADMIN_OUTLOOK_ERROR', req, {
      userId: req.session.user.id,
      error: err.message,
      endpoint: '/events'
    });
    
    res.status(500).json({
      success: false,
      message: 'Fehler beim Abrufen der Kalenderdaten',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// Kalendereintrag erstellen (nur Admin)
router.post('/events', async (req, res) => {
  try {
    console.log('📅 Admin erstellt Kalendereintrag:', {
      userId: req.session.user.id,
      username: req.session.user.username,
      eventData: req.body,
      ip: req.ip
    });

    const { subject, start, end, description, location, attendees } = req.body;

    if (!subject || !start || !end) {
      return res.status(400).json({
        success: false,
        message: 'Pflichtfelder fehlen: subject, start, end'
      });
    }

    const token = await getToken();

    const eventBody = {
      subject: subject,
      body: {
        contentType: 'HTML',
        content: description || ''
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
        displayName: location || ''
      },
      attendees: attendees || [],
      isOnlineMeeting: false
    };

    const response = await axios.post(
      `https://graph.microsoft.com/v1.0/users/${process.env.OUTLOOK_USER_EMAIL}/calendar/events`,
      eventBody,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    logger.info('Admin Kalendereintrag erstellt', {
      userId: req.session.user.id,
      username: req.session.user.username,
      eventId: response.data.id,
      subject: subject
    });

    res.json({
      success: true,
      message: 'Kalendereintrag erfolgreich erstellt',
      event: response.data
    });

  } catch (err) {
    console.error('❌ Fehler beim Erstellen des Kalendereintrags:', err.message);
    
    logSecurityEvent('ADMIN_CREATE_EVENT_ERROR', req, {
      userId: req.session.user.id,
      error: err.message,
      eventData: req.body
    });
    
    res.status(500).json({
      success: false,
      message: 'Fehler beim Erstellen des Kalendereintrags',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// Kalendereintrag bearbeiten (nur Admin)
router.put('/events/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    const { subject, start, end, description, location } = req.body;

    console.log('✏️ Admin bearbeitet Kalendereintrag:', {
      eventId,
      userId: req.session.user.id,
      username: req.session.user.username,
      ip: req.ip
    });

    const token = await getToken();

    const eventBody = {
      subject: subject,
      body: {
        contentType: 'HTML',
        content: description || ''
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
        displayName: location || ''
      }
    };

    const response = await axios.patch(
      `https://graph.microsoft.com/v1.0/users/${process.env.OUTLOOK_USER_EMAIL}/calendar/events/${eventId}`,
      eventBody,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    logger.info('Admin Kalendereintrag bearbeitet', {
      userId: req.session.user.id,
      username: req.session.user.username,
      eventId: eventId
    });

    res.json({
      success: true,
      message: 'Kalendereintrag erfolgreich aktualisiert',
      event: response.data
    });

  } catch (err) {
    console.error('❌ Fehler beim Bearbeiten des Kalendereintrags:', err.message);
    
    logSecurityEvent('ADMIN_UPDATE_EVENT_ERROR', req, {
      userId: req.session.user.id,
      error: err.message,
      eventId: req.params.eventId
    });
    
    res.status(500).json({
      success: false,
      message: 'Fehler beim Bearbeiten des Kalendereintrags',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// Kalendereintrag löschen (nur Admin)
router.delete('/events/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;

    console.log('🗑️ Admin löscht Kalendereintrag:', {
      eventId,
      userId: req.session.user.id,
      username: req.session.user.username,
      ip: req.ip
    });

    const token = await getToken();

    await axios.delete(
      `https://graph.microsoft.com/v1.0/users/${process.env.OUTLOOK_USER_EMAIL}/calendar/events/${eventId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000
      }
    );

    logger.info('Admin Kalendereintrag gelöscht', {
      userId: req.session.user.id,
      username: req.session.user.username,
      eventId: eventId
    });

    res.json({
      success: true,
      message: 'Kalendereintrag erfolgreich gelöscht'
    });

  } catch (err) {
    console.error('❌ Fehler beim Löschen des Kalendereintrags:', err.message);
    
    logSecurityEvent('ADMIN_DELETE_EVENT_ERROR', req, {
      userId: req.session.user.id,
      error: err.message,
      eventId: req.params.eventId
    });
    
    res.status(500).json({
      success: false,
      message: 'Fehler beim Löschen des Kalendereintrags',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// Test-Route für Entwicklung (nur Admin)
router.get('/test', async (req, res) => {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(404).json({ success: false, message: 'Route nur in Development verfügbar' });
  }

  try {
    console.log('🧪 Admin Test-Route aufgerufen:', {
      userId: req.session?.user?.id || 'anonymous',
      username: req.session?.user?.username || 'anonymous',
      ip: req.ip
    });

    const token = await getToken();
    
    res.json({
      success: true,
      message: 'Outlook-Router funktioniert',
      hasToken: !!token,
      environment: process.env.NODE_ENV,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Test fehlgeschlagen',
      error: error.message
    });
  }
});

// Health Check für Outlook-API (nur Admin)
router.get('/health', async (req, res) => {
  try {
    console.log('💓 Outlook Health Check von Admin:', {
      userId: req.session.user.id,
      username: req.session.user.username,
      ip: req.ip
    });

    const startTime = Date.now();
    const token = await getToken();
    const tokenTime = Date.now() - startTime;

    // Einfacher API-Test
    const testStart = Date.now();
    const response = await axios.get(
      `https://graph.microsoft.com/v1.0/users/${process.env.OUTLOOK_USER_EMAIL}/calendar`,
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000
      }
    );
    const apiTime = Date.now() - testStart;

    res.json({
      success: true,
      status: 'healthy',
      checks: {
        tokenAcquisition: {
          status: 'ok',
          responseTime: tokenTime
        },
        graphApi: {
          status: 'ok',
          responseTime: apiTime
        }
      },
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV
    });

  } catch (error) {
    console.error('❌ Outlook Health Check fehlgeschlagen:', error.message);
    
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Funktion zum Erstellen von Kalendereinträgen (für Controller)
async function erstelleKalendereintrag(anfrage, start, end, bemerkung) {
  try {
    console.log('📅 Erstelle Kalendereintrag für Anfrage:', {
      anfrageId: anfrage.id,
      start: start,
      end: end,
      kunde: `${anfrage.kontakt.vorname} ${anfrage.kontakt.nachname}`
    });

    const token = await getToken();

    const problemPlain = anfrage.problem?.toObject ? anfrage.problem.toObject() : anfrage.problem;
    const kontaktPlain = anfrage.kontakt?.toObject ? anfrage.kontakt.toObject() : anfrage.kontakt;

    const problemText = Object.entries(problemPlain || {})
      .filter(([key]) => key !== '_id')
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');

    const adresseText = kontaktPlain.adresse ? 
      `${kontaktPlain.adresse}, ${kontaktPlain.plz} ${kontaktPlain.ort}` : 
      'Adresse nicht angegeben';

    const body = {
      subject: `Termin: ${kontaktPlain.vorname} ${kontaktPlain.nachname}`,
      body: {
        contentType: 'HTML',
        content: `
          <div style="font-family: Arial, sans-serif;">
            <h3>Kundentermin Details</h3>
            <p><strong>Name:</strong> ${kontaktPlain.vorname} ${kontaktPlain.nachname}</p>
            <p><strong>Firma:</strong> ${kontaktPlain.firma || 'Nicht angegeben'}</p>
            <p><strong>Kundennummer:</strong> ${kontaktPlain.kundennummer || 'Nicht angegeben'}</p>
            <p><strong>Problem/Anliegen:</strong> ${problemText}</p>
            <p><strong>Beschreibung:</strong><br>${anfrage.beschreibung || 'Keine Beschreibung'}</p>
            <hr>
            <p><strong>Kontakt:</strong></p>
            <p>📧 ${kontaktPlain.email}</p>
            <p>📞 ${kontaktPlain.telefon || 'Keine Telefonnummer'}</p>
            <p>📍 ${adresseText}</p>
            ${bemerkung ? `<hr><p><strong>Bemerkung:</strong><br>${bemerkung}</p>` : ''}
            <hr>
            <p><small>Anfrage-ID: ${anfrage.id}<br>Erstellt: ${new Date(anfrage.createdAt).toLocaleString('de-DE')}</small></p>
          </div>
        `
      },
      start: {
        dateTime: start instanceof Date ? start.toISOString() : start,
        timeZone: 'Europe/Berlin'
      },
      end: {
        dateTime: end instanceof Date ? end.toISOString() : end,
        timeZone: 'Europe/Berlin'
      },
      location: {
        displayName: adresseText
      },
      attendees: [],
      isOnlineMeeting: false,
      categories: ['Kundentermin'],
      showAs: 'busy'
    };

    const response = await axios.post(
      `https://graph.microsoft.com/v1.0/users/${process.env.OUTLOOK_USER_EMAIL}/calendar/events`,
      body,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    console.log('✅ Kalendereintrag erfolgreich erstellt:', {
      eventId: response.data.id,
      anfrageId: anfrage.id,
      subject: body.subject
    });

    logger.info('Kalendereintrag automatisch erstellt', {
      anfrageId: anfrage.id,
      eventId: response.data.id,
      kunde: `${kontaktPlain.vorname} ${kontaktPlain.nachname}`,
      start: start,
      end: end
    });

    return response.data;

  } catch (error) {
    console.error('❌ Fehler beim Erstellen des Kalendereintrags:', error.message);
    
    // Fehler loggen, aber nicht weiterwerfen (damit Anfrage trotzdem gespeichert wird)
    logger.error('Kalendereintrag-Erstellung fehlgeschlagen', {
      anfrageId: anfrage.id,
      error: error.message,
      start: start,
      end: end
    });

    throw error;
  }
}

// Error Handler für unbehandelte Fehler in diesem Router
router.use((err, req, res, next) => {
  console.error('❌ Unbehandelter Outlook-Router Fehler:', err.message);
  
  logSecurityEvent('OUTLOOK_ROUTER_ERROR', req, {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });
  
  res.status(500).json({
    success: false,
    message: 'Fehler in Outlook-Integration',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Service temporär nicht verfügbar'
  });
});

module.exports = router;
module.exports.erstelleKalendereintrag = erstelleKalendereintrag;