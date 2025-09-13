// routes/anfrageRoutes.js - UPDATED mit differenzierter Routensicherheit
const express = require('express');
const router = express.Router();
const { 
  anfrageValidation, 
  handleValidation,
  csrfProtection 
} = require('../middleware/security');
const { 
  erstelleAnfrage, 
  holeAlleAnfragen, 
  aktualisiereAnfrage, 
  ablehneAnfrage, 
  loescheAnfrage 
} = require('../controllers/anfrageController');
const { logger } = require('../utils/logger');

// ✅ ÖFFENTLICHER ENDPUNKT - Neue Anfrage erstellen
// Wird von terminanfrage.js verwendet - MUSS öffentlich zugänglich bleiben
router.post('/', csrfProtection, anfrageValidation, handleValidation, async (req, res) => {
  try {
    console.log('📝 Öffentliche Anfrage erhalten:', {
      ip: req.ip,
      sessionId: req.sessionID?.substring(0, 8) + '...',
      hasCSRF: !!req.headers['x-csrf-token'],
      istTelefonanfrage: req.body.istTelefonanfrage,
      terminAnzahl: req.body.termine?.length || 0
    });

    // Zusätzliche Validierung für öffentliche Anfragen
    const { problem, beschreibung, termine, kontakt, istTelefonanfrage } = req.body;

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

    // Kontaktdaten-Validierung
    if (!kontakt?.email || !kontakt?.nachname || !kontakt?.vorname) {
      return res.status(400).json({
        success: false,
        message: 'Pflichtfelder (Name, Nachname, E-Mail) müssen ausgefüllt werden'
      });
    }

    // E-Mail-Format prüfen
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(kontakt.email)) {
      return res.status(400).json({
        success: false,
        message: 'Ungültiges E-Mail-Format'
      });
    }

    // Controller aufrufen
    await erstelleAnfrage(req, res);
    
  } catch (error) {
    console.error('❌ Fehler bei öffentlicher Anfrage:', error);
    
    logger.error('Öffentliche Anfrage Fehler', {
      error: error.message,
      stack: error.stack,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      body: req.body
    });

    res.status(500).json({
      success: false,
      message: 'Fehler beim Verarbeiten der Anfrage'
    });
  }
});

// ✅ GESCHÜTZTE ADMIN-ENDPUNKTE
// Diese werden automatisch durch routeSecurityMiddleware geschützt

// Alle Anfragen abrufen (nur Admin)
router.get('/', async (req, res) => {
  try {
    console.log('📋 Admin fragt alle Anfragen ab:', {
      userId: req.session.user.id,
      username: req.session.user.username,
      ip: req.ip
    });
    
    await holeAlleAnfragen(req, res);
    
  } catch (error) {
    console.error('❌ Fehler beim Abrufen aller Anfragen:', error);
    res.status(500).json({
      success: false,
      message: 'Fehler beim Abrufen der Anfragen'
    });
  }
});

// Einzelne Anfrage abrufen (nur Admin)
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('📄 Admin fragt einzelne Anfrage ab:', {
      anfrageId: id,
      userId: req.session.user.id,
      username: req.session.user.username,
      ip: req.ip
    });
    
    const { Anfrage } = require('../models');
    const anfrage = await Anfrage.findByPk(id);
    
    if (!anfrage) {
      return res.status(404).json({
        success: false,
        message: 'Anfrage nicht gefunden'
      });
    }
    
    res.json({
      success: true,
      anfrage: anfrage
    });
    
  } catch (error) {
    console.error('❌ Fehler beim Abrufen der Anfrage:', error);
    res.status(500).json({
      success: false,
      message: 'Fehler beim Abrufen der Anfrage'
    });
  }
});

// Anfrage-Status aktualisieren (nur Admin)
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('✏️ Admin aktualisiert Anfrage:', {
      anfrageId: id,
      updateData: req.body,
      userId: req.session.user.id,
      username: req.session.user.username,
      ip: req.ip
    });
    
    await aktualisiereAnfrage(req, res);
    
  } catch (error) {
    console.error('❌ Fehler beim Aktualisieren der Anfrage:', error);
    res.status(500).json({
      success: false,
      message: 'Fehler beim Aktualisieren der Anfrage'
    });
  }
});

// Anfrage ablehnen mit E-Mail (nur Admin)
router.post('/:id/ablehnen', async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('❌ Admin lehnt Anfrage ab:', {
      anfrageId: id,
      bemerkung: req.body.bemerkung,
      userId: req.session.user.id,
      username: req.session.user.username,
      ip: req.ip
    });
    
    // Weiterleitung an Controller
    req.params.id = id;
    await ablehneAnfrage(req, res);
    
  } catch (error) {
    console.error('❌ Fehler beim Ablehnen der Anfrage:', error);
    res.status(500).json({
      success: false,
      message: 'Fehler beim Ablehnen der Anfrage'
    });
  }
});

// Anfrage löschen ohne E-Mail (nur Admin)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('🗑️ Admin löscht Anfrage:', {
      anfrageId: id,
      userId: req.session.user.id,
      username: req.session.user.username,
      ip: req.ip
    });
    
    await loescheAnfrage(req, res);
    
  } catch (error) {
    console.error('❌ Fehler beim Löschen der Anfrage:', error);
    res.status(500).json({
      success: false,
      message: 'Fehler beim Löschen der Anfrage'
    });
  }
});

// ✅ STATISTIKEN für Admin-Dashboard (nur Admin)
router.get('/stats/overview', async (req, res) => {
  try {
    console.log('📊 Admin fragt Statistiken ab:', {
      userId: req.session.user.id,
      username: req.session.user.username,
      ip: req.ip
    });
    
    const { Anfrage } = require('../models');
    const { Op } = require('sequelize');
    
    const heute = new Date();
    const wochenStart = new Date(heute.setDate(heute.getDate() - heute.getDay() + 1));
    const monatStart = new Date(heute.getFullYear(), heute.getMonth(), 1);
    
    const stats = await Promise.all([
      // Gesamt-Anfragen
      Anfrage.count(),
      
      // Neue Anfragen
      Anfrage.count({ where: { status: 'neu' } }),
      
      // Erledigte Anfragen
      Anfrage.count({ where: { status: 'erledigt' } }),
      
      // Anfragen diese Woche
      Anfrage.count({
        where: {
          createdAt: { [Op.gte]: wochenStart }
        }
      }),
      
      // Anfragen diesen Monat
      Anfrage.count({
        where: {
          createdAt: { [Op.gte]: monatStart }
        }
      }),
      
      // Telefonanfragen vs. Vor-Ort
      Anfrage.count({ where: { istTelefonanfrage: true } }),
      Anfrage.count({ where: { istTelefonanfrage: false } })
    ]);
    
    res.json({
      success: true,
      stats: {
        gesamt: stats[0],
        neu: stats[1],
        erledigt: stats[2],
        dieseWoche: stats[3],
        dieserMonat: stats[4],
        telefonanfragen: stats[5],
        vorOrtAnfragen: stats[6]
      }
    });
    
  } catch (error) {
    console.error('❌ Fehler beim Abrufen der Statistiken:', error);
    res.status(500).json({
      success: false,
      message: 'Fehler beim Abrufen der Statistiken'
    });
  }
});

// ✅ EXPORT-FUNKTIONEN für Admin (nur Admin)
router.get('/export/csv', async (req, res) => {
  try {
    console.log('📄 Admin exportiert Anfragen als CSV:', {
      userId: req.session.user.id,
      username: req.session.user.username,
      ip: req.ip
    });
    
    const { Anfrage } = require('../models');
    const anfragen = await Anfrage.findAll({
      order: [['createdAt', 'DESC']]
    });
    
    // Simple CSV-Generierung
    const csvHeader = 'ID,Erstellt,Status,Name,Email,Telefon,Problem,Beschreibung,Telefonanfrage\n';
    const csvData = anfragen.map(anfrage => {
      const kontakt = typeof anfrage.kontakt === 'string' ? 
        JSON.parse(anfrage.kontakt) : anfrage.kontakt;
      const problem = typeof anfrage.problem === 'string' ? 
        JSON.parse(anfrage.problem) : anfrage.problem;
      
      return [
        anfrage.id,
        anfrage.createdAt.toISOString().split('T')[0],
        anfrage.status,
        `"${kontakt.vorname} ${kontakt.nachname}"`,
        kontakt.email,
        kontakt.telefon || '',
        `"${Object.keys(problem).join(', ')}"`,
        `"${anfrage.beschreibung?.replace(/"/g, '""') || ''}"`,
        anfrage.istTelefonanfrage ? 'Ja' : 'Nein'
      ].join(',');
    }).join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="anfragen_${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csvHeader + csvData);
    
  } catch (error) {
    console.error('❌ Fehler beim CSV-Export:', error);
    res.status(500).json({
      success: false,
      message: 'Fehler beim CSV-Export'
    });
  }
});

module.exports = router;