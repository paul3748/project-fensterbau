// controllers/anfrageController.js
const { Anfrage } = require('../models');
const { sendTerminBestaetigung, sendTerminAbsage, sendAnfrageNotification } = require('../utils/mail');
const { erstelleKalendereintrag } = require('../routes/outlook');
const { Op } = require('sequelize');
const { anfrageValidation, handleValidation } = require('../middleware/security');

// Anfrage erstellen
exports.erstelleAnfrage = async (req, res) => {
  const daten = req.body;
  try {
    const neueAnfrage = await Anfrage.create(daten);

    // Benachrichtigungs-Email an interne Adresse
    try {
      console.log('📄 Sende Benachrichtigungs-Email an:', process.env.INTERNAL_NOTIFICATION_EMAIL);
      await sendAnfrageNotification(neueAnfrage);
      console.log('✅ Benachrichtigungs-Email erfolgreich versendet');
    } catch (emailErr) {
      console.error('⚠ Fehler beim Versenden der Benachrichtigung:', emailErr.message);
    }

    res.status(201).json({ message: 'Anfrage erfolgreich gespeichert!', daten: neueAnfrage });
  } catch (err) {
    res.status(500).json({ message: 'Fehler beim Speichern', error: err.message });
  }
};

// Alle Anfragen abrufen
exports.holeAlleAnfragen = async (req, res) => {
  try {
    const anfragen = await Anfrage.findAll({
      order: [['createdAt', 'DESC']]
    });
    res.json(anfragen);
  } catch (err) {
    res.status(500).json({ message: 'Fehler beim Abrufen', error: err.message });
  }
};

// Anfrage aktualisieren
exports.aktualisiereAnfrage = async (req, res) => {
  const { id } = req.params;
  const { start, end, bemerkung, nurStatusUpdate } = req.body;

  try {
    const anfrage = await Anfrage.findByPk(id);
    if (!anfrage) return res.status(404).json({ message: 'Anfrage nicht gefunden' });

    // Nur Status setzen (Telefonanfrage)
    if (nurStatusUpdate) {
      await anfrage.update({
        status: 'erledigt',
        bemerkung: bemerkung || ''
      });
      return res.json({ message: 'Anfrage als erledigt markiert', anfrage });
    }

    // Termin bestätigen
    const startDate = new Date(start);
    const endDate = new Date(end);

    await anfrage.update({
      status: 'erledigt',
      bestaetigterTermin: { start: startDate, end: endDate },
      bemerkung: bemerkung || ''
    });

    // Finde ursprünglichen Zeitslot für Email
    const datum = startDate.toISOString().split('T')[0];
    const originalSlot = anfrage.termine.find(t => {
      const slotDatum = new Date(t.start).toISOString().split('T')[0];
      return slotDatum === datum;
    });

    // Email und Kalendereintrag
    if (originalSlot) {
      await sendTerminBestaetigung(anfrage, originalSlot, bemerkung);
    } else {
      await sendTerminBestaetigung(anfrage, { start: startDate, end: endDate }, bemerkung);
    }
    await erstelleKalendereintrag(anfrage, startDate, endDate, bemerkung);

    res.json({ message: 'Anfrage aktualisiert & Mail gesendet', anfrage });

  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Fehler beim Aktualisieren', error: err.message });
  }
};

// Anfrage ablehnen (mit Email)
exports.ablehneAnfrage = async (req, res) => {
  const { id } = req.params;

  try {
    const anfrage = await Anfrage.findByPk(id);
    if (!anfrage) {
      return res.status(404).json({ message: 'Anfrage nicht gefunden' });
    }

    const istTelefonanfrage = anfrage.istTelefonanfrage;
    const bemerkung = req.body?.bemerkung || '';

    // Email bei Vor-Ort-Anfragen
    if (!istTelefonanfrage) {
      await sendTerminAbsage(anfrage, bemerkung);
    }

    await anfrage.destroy();
    res.json({ message: 'Anfrage abgelehnt und gelöscht' });

  } catch (err) {
    res.status(500).json({ message: 'Fehler beim Ablehnen', error: err.message });
  }
};

// Anfrage löschen (OHNE Email)
exports.loescheAnfrage = async (req, res) => {
  const { id } = req.params;

  try {
    const anfrage = await Anfrage.findByPk(id);
    if (!anfrage) {
      return res.status(404).json({ message: 'Anfrage nicht gefunden' });
    }

    await anfrage.destroy();
    res.json({ message: 'Anfrage gelöscht' });

  } catch (err) {
    res.status(500).json({ message: 'Fehler beim Löschen', error: err.message });
  }
};