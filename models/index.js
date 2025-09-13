// models/index.js
const { sequelize } = require('../config/database');
const User = require('./User');
const Anfrage = require('./Anfrage');

// Datenbank synchronisieren
const syncDatabase = async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ PostgreSQL verbunden');
    
    // Tabellen synchronisieren - OHNE ALTER um bestehende Tabellen zu schützen
    await sequelize.sync({ force: false, alter: false });
    console.log('✅ Datenbank-Tabellen synchronisiert');
  } catch (error) {
    console.error('❌ PostgreSQL Fehler:', error);
  }
};

module.exports = {
  sequelize,
  User,
  Anfrage,
  syncDatabase
};