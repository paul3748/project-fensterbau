// models/Anfrage.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Anfrage = sequelize.define('Anfrage', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  // Problem-Kategorien als JSON
  problem: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {
      Fenster: 0,
      Tueren: 0,
      Rolladen: 0
    }
  },
  beschreibung: {
    type: DataTypes.TEXT
  },
  // Termine als JSON Array
  termine: {
    type: DataTypes.JSONB,
    defaultValue: []
  },
  // Kontakt-Daten als JSON
  kontakt: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {}
  },
  status: {
    type: DataTypes.ENUM('neu', 'erledigt'),
    defaultValue: 'neu'
  },
  // Bestätigter Termin als JSON
  bestaetigterTermin: {
    type: DataTypes.JSONB,
    defaultValue: null
  },
  bemerkung: {
    type: DataTypes.TEXT
  },
  istTelefonanfrage: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
}, {
  tableName: 'anfrages', // EXPLIZIT auf bestehende Tabelle verweisen
  timestamps: true // createdAt, updatedAt
});

module.exports = Anfrage;