const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

// Log-Verzeichnis erstellen falls nicht vorhanden
const logDir = path.join(__dirname, '../logs');

// Format für Logs
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
  })
);

// Security-spezifisches Log
const securityTransport = new DailyRotateFile({
  filename: path.join(logDir, 'security-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '30d',
  level: 'warn',
  format: logFormat
});

// Allgemeines Application-Log
const appTransport = new DailyRotateFile({
  filename: path.join(logDir, 'app-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '14d',
  format: logFormat
});

// Error-Log
const errorTransport = new DailyRotateFile({
  filename: path.join(logDir, 'error-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '30d',
  level: 'error',
  format: logFormat
});

// Logger erstellen
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [
    appTransport,
    errorTransport,
    securityTransport
  ]
});

// Console-Output für Development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

// Security-Logger (separater Logger für Sicherheitsereignisse)
const securityLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new DailyRotateFile({
      filename: path.join(logDir, 'security-events-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '90d' // Security-Logs länger aufbewahren
    })
  ]
});

// Hilfsfunktionen für Security-Logging
const logSecurityEvent = (event, req, details = {}) => {
  console.log(`[SECURITY EVENT] ${event} @ ${req.path}`);
  securityLogger.info({
    event,
    timestamp: new Date().toISOString(),
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    url: req.originalUrl,
    method: req.method,
    sessionId: req.sessionID,
    userId: req.session?.user?.id,
    details
  });
};

// Rate Limiting Logs
const logRateLimit = (req) => {
  logSecurityEvent('RATE_LIMIT_EXCEEDED', req, {
    rateLimitType: 'general'
  });
};

const logLoginAttempt = (req, success, username) => {
  logSecurityEvent(success ? 'LOGIN_SUCCESS' : 'LOGIN_FAILED', req, {
    username,
    success
  });
};

const logSuspiciousActivity = (req, activity, details) => {
  securityLogger.warn({
    event: 'SUSPICIOUS_ACTIVITY',
    activity,
    timestamp: new Date().toISOString(),
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    url: req.originalUrl,
    details
  });
};

module.exports = {
  logger,
  securityLogger,
  logSecurityEvent,
  logRateLimit,
  logLoginAttempt,
  logSuspiciousActivity
};