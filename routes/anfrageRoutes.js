// routes/anfrageRoutes.js - FIXED with proper CSRF handling
const express = require('express');
const path = require('path');
const router = express.Router();
const { 
  anfrageValidation, 
  handleValidation,
  csrfProtection 
} = require('../middleware/security');
const { Anfrage } = require('../models');
const { logger } = require('../utils/logger');
const { securityMonitor } = require('../utils/securityMonitoring');

// ✅ FIXED: POST Route mit CSRF Protection
router.post('/', csrfProtection, anfrageValidation, handleValidation, async (req, res) => {
  try {
    console.log('📝 Anfrage erhalten:', {
      sessionId: req.sessionID?.substring(0, 8) + '...',
      hasCSRF: !!req.headers['x-csrf-token'],
      csrfValid: true // Wenn wir hier sind, war CSRF erfolgreich
    });

    const { problem, beschreibung, termine, kontakt, istTelefonanfrage } = req.body;

    // Validierung
    if (!problem || Object.keys(problem).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Mindestens ein Problem muss ausgewählt werden'
      });
    }

    if (!istTelefonanfrage && (!termine || termine.length !== 3)) {
      return res.status(400).json({
        success: false,
        message: 'Für Vor-Ort-Termine müssen genau 3 Terminvorschläge ausgewählt werden'
      });
    }

    // Anfrage in Datenbank speichern
    const neueAnfrage = await Anfrage.create({
      problem: JSON.stringify(problem),
      beschreibung,
      termine: JSON.stringify(termine),
      kontakt: JSON.stringify(kontakt),
      istTelefonanfrage: istTelefonanfrage || false,
      status: 'neu',
      erstelltAm: new Date(),
      clientIP: req.ip,
      userAgent: req.get('User-Agent')
    });

    logger.info('Neue Anfrage erstellt', {
      anfrageId: neueAnfrage.id,
      istTelefonanfrage,
      terminAnzahl: termine?.length || 0,
      ip: req.ip
    });

    console.log('✅ Anfrage erfolgreich gespeichert:', neueAnfrage.id);

    res.json({
      success: true,
      message: 'Anfrage erfolgreich übermittelt',
      anfrageId: neueAnfrage.id
    });

  } catch (error) {
    console.error('❌ Fehler beim Erstellen der Anfrage:', error);
    
    logger.error('Fehler beim Erstellen der Anfrage', {
      error: error.message,
      stack: error.stack,
      ip: req.ip,
      body: req.body
    });

    // Security Event bei wiederholten Fehlern
    securityMonitor.trackSecurityEvent('ANFRAGE_ERROR', req, {
      error: error.message
    });

    res.status(500).json({
      success: false,
      message: 'Fehler beim Verarbeiten der Anfrage'
    });
  }
});

// GET Route für Formular (ohne CSRF Protection)
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'terminanfrage.html'));
});
// GET / - Alle Anfragen abrufen (Admin)
router.get('/', getAllAnfragen);

// POST / - Neue Anfrage erstellen (Öffentlich)  
router.post('/', anfrageValidation, handleValidation, createAnfrage);

// PUT /:id - Status ändern (Admin)
router.put('/:id', updateAnfrageStatus);

// DELETE /:id - Löschen (Admin)
router.delete('/:id', deleteAnfrage);

module.exports = router;