// routes/outlook.js - UPDATED mit differenzierter Routensicherheit
const express = require('express');
const router = express.Router();
const { ConfidentialClientApplication } = require('@azure/msal-node');
const axios = require('axios');
const { DateTime } = require('luxon');
const { logger, logSecurityEvent } = require('../utils/logger');

console.log('✅ Outlook-Router geladen mit Sicherheits-Updates');

// Debug-Middleware nur für Development
if (process.env.NODE_ENV === 'development') {
  router.use((req, res, next) => { 
    console.log('[DEBUG Outlook]', req.method, req.path, {
      hasAuth: !!req.session?.user,
      userRole: req.session?.user?.role,
      ip: req.ip
    }); 
    next(); 
  });
}

// MSAL-Konfiguration
const msalConfig = {
  auth: {
    clientId: process.env.CLIENT_ID,
    authority: `https://login.microsoftonline.com/${process.env.TENANT_ID}`,
    clientSecret: process.env.CLIENT_SECRET,
  },
};

const cca = new ConfidentialClientApplication(msalConfig);

// Token abrufen mit Error Handling
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
    datum.setHours(0,0,0,0);
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

// ✅ ÖFFENTLICHER ENDPUNKT - Freie Slots für Terminanfrage-Formular
// Wird von terminanfrage.js verwendet - MUSS öffentlich zugänglich bleiben
router.get('/freie-slots', async (req, res) => {
  try {
    console.log('📅 Öffentliche Slot-Abfrage von:', req.ip, {
      userAgent: req.headers['user-agent']?.substring(0, 50) + '...',
      timestamp: new Date().toISOString()
    });

    const token = await getToken();

    const response = await axios.get(
      `https://graph.microsoft.com/v1.0/users/${process.env.OUTLOOK_USER_EMAIL}/calendar/events`,
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000 // 10 Sekunden Timeout
      }
    );

    // Alle Events mit korrekter Zeitzonenkonvertierung
    const belegteEvents = response.data.value.map(event => ({
      start: DateTime.fromISO(event.start.dateTime, { zone: event.start.timeZone }).toUTC().toISO(),
      end: DateTime.fromISO(event.end.dateTime, { zone: event.end.timeZone }).toUTC().toISO(),
      subject: event.subject || 'Unbekannt'
    }));

    const alleSlots = generateZeitslots();
    
    console.log(`📊 Slot-Generierung: ${alleSlots.length} Slots, ${belegteEvents.length} Events`);
    
    // Filter mit maxOverlap = 1 (bei 2 Terminen im Slot wird blockiert)
    const { filterFreieSlots } = require('../utils/kalenderUtils');
    const freieSlots = filterFreieSlots(alleSlots, belegteEvents, 1);
    
    console.log(`✅ Gefiltert auf ${freieSlots.length} freie Slots (max 1 Termin pro Slot)`);

    // Erfolgreiche Abfrage loggen
    logger.info('Öffentliche Slot-Abfrage erfolgreich', {
      ip: req.ip,
      totalSlots: alleSlots.length,
      totalEvents: belegteEvents.length,
      freeSlots: freieSlots.length,
      userAgent: req.headers['user-agent']
    });

    // Beide Datensätze zurückgeben
    res.json({
      freieSlots: freieSlots,
      alleEvents: belegteEvents,
      debug: {
        totalSlots: alleSlots.length,
        totalEvents: belegteEvents.length,
        freeSlots: freieSlots.length,
        generatedAt: new Date().toISOString()
      }
    });
    
  } catch (err) {
    console.error("❌ Fehler bei öffentlicher Slot-Abfrage:", err.message);
    
    // Sicherheitsereignis loggen bei wiederholten Fehlern
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