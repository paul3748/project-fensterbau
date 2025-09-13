// config/database.js - Bereinigte Datenbank-Konfiguration
const { Sequelize } = require('sequelize');
const crypto = require('crypto');
require('dotenv').config();

// Verschlüsselungsklasse für sensitive Daten
class DataEncryption {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    const key = process.env.ENCRYPTION_KEY || process.env.SESSION_SECRET;
    if (!key) throw new Error('❌ Encryption Key nicht gefunden! Bitte ENCRYPTION_KEY oder SESSION_SECRET setzen.');
    this.secretKey = crypto.scryptSync(key, 'salt', 32);
  }

  encrypt(text) {
    if (!text) return text;
    
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipherGCM(this.algorithm, this.secretKey, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  decrypt(encryptedText) {
    if (!encryptedText || !encryptedText.includes(':')) return encryptedText;
    
    try {
      const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      
      const decipher = crypto.createDecipherGCM(this.algorithm, this.secretKey, iv);
      decipher.setAuthTag(authTag);
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      console.error('Decryption failed:', error.message);
      return encryptedText; // Fallback
    }
  }
}

const dataEncryption = new DataEncryption();

// Sichere Sequelize-Konfiguration
const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    
    // SSL-Konfiguration (Hetzner-Server)
    dialectOptions: {
      ssl: process.env.DB_SSL === 'require' ? {
        require: true,
        rejectUnauthorized: false
      } : false,
      statement_timeout: 30000,
      query_timeout: 30000
    },
    
    // Connection Pool Sicherheit
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000,
      evict: 1000,
      handleDisconnects: true
    },
    
    // Logging konfigurieren
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    
    // Benchmark für Performance-Monitoring
    benchmark: process.env.NODE_ENV === 'development',
    
    // Timezone
    timezone: '+01:00', // Deutschland
    
    // Weitere Sicherheitsoptionen
    define: {
      freezeTableName: false, // WICHTIG: false für plural tables
      timestamps: true,
      paranoid: false, // Erstmal deaktiviert
      underscored: false // Camel Case beibehalten
    },
    
    // Retry-Logik für Verbindungsfehler
    retry: {
      max: 3,
      timeout: 60000,
      match: [
        /ETIMEDOUT/,
        /EHOSTUNREACH/,
        /ECONNRESET/,
        /ECONNREFUSED/,
        /ENOTFOUND/,
        /SequelizeConnectionError/,
        /SequelizeConnectionRefusedError/,
        /SequelizeHostNotFoundError/,
        /SequelizeHostNotReachableError/,
        /SequelizeInvalidConnectionError/,
        /SequelizeConnectionTimedOutError/
      ]
    }
  }
);

// Database Health Check
const checkDatabaseHealth = async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established successfully.');
    return true;
  } catch (error) {
    console.error('❌ Unable to connect to database:', error);
    return false;
  }
};

// Database Backup Helper (für Cron Jobs)
const createBackupQuery = () => {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  return `pg_dump ${process.env.DB_NAME} > backup_${timestamp}.sql`;
};

module.exports = {
  sequelize,
  checkDatabaseHealth,
  createBackupQuery,
  dataEncryption
};