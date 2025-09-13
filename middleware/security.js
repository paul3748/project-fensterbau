// middleware/security.js - FIXED VERSION mit korrekter CSRF Token Behandlung
const { body, validationResult } = require('express-validator');
const { logSecurityEvent, logSuspiciousActivity } = require('../utils/logger');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const crypto = require('crypto');

// [... andere Funktionen bleiben gleich ...]

// ✅ FIXED: Generate CSRF Token mit expliziter String-Konvertierung
const generateCSRFToken = (req, res, next) => {
  if (!req.session) {
    console.log('⚠️ Keine Session verfügbar für CSRF Token');
    return next();
  }
  
  // ✅ Token nur generieren wenn wirklich keiner existiert
  if (!req.session.csrfToken) {
    // ✅ WICHTIG: Als String speichern, nicht als Buffer oder Objekt
    const tokenString = crypto.randomBytes(32).toString('hex');
    req.session.csrfToken = tokenString;
    console.log('🔑 Neuer CSRF Token generiert:', tokenString.substring(0, 8) + '...');
    
    // ✅ Session explizit speichern um sicherzustellen dass Token persistiert wird
    req.session.save((err) => {
      if (err) {
        console.error('❌ Fehler beim Speichern der Session:', err);
      } else {
        console.log('✅ CSRF Token in Session gespeichert');
      }
    });
  } else {
    console.log('🔄 Verwende existierenden CSRF Token:', req.session.csrfToken.substring(0, 8) + '...');
  }
  
  res.locals.csrfToken = req.session.csrfToken;
  next();
};

// ✅ IMPROVED: CSRF Protection mit besserer Session-Behandlung
const csrfProtection = (req, res, next) => {
  // GET Requests überspringen
  if (req.method === 'GET') {
    console.log('✅ GET Request - CSRF Check übersprungen');
    return next();
  }
  
  console.log('🛡️ CSRF Check für:', {
    method: req.method,
    path: req.path,
    sessionID: req.sessionID?.substring(0, 8) + '...',
    hasSession: !!req.session,
    isNewSession: req.session?.isNew,
    contentType: req.headers['content-type']
  });
  
  // Token aus verschiedenen Quellen extrahieren
  let token = req.headers['x-csrf-token'] || req.body._csrf;
  
  const sessionToken = req.session?.csrfToken;
  
  console.log('🔍 Token Details:', {
    receivedToken: token ? token.substring(0, 8) + '...' : 'NONE',
    sessionToken: sessionToken ? sessionToken.substring(0, 8) + '...' : 'NONE',
    tokenExists: !!token,
    sessionTokenExists: !!sessionToken,
    tokensMatch: token === sessionToken,
    sessionTokenType: typeof sessionToken,
    receivedTokenType: typeof token
  });
  
  // Detaillierte Fehlerprüfung
  if (!token) {
    console.log('❌ CSRF Fehler: Kein Token im Request');
    logSecurityEvent('CSRF_NO_TOKEN', req);
    return res.status(403).json({
      success: false,
      message: 'CSRF-Token fehlt. Seite neu laden und erneut versuchen.',
      code: 'CSRF_MISSING'
    });
  }
  
  if (!sessionToken) {
    console.log('❌ CSRF Fehler: Kein Token in Session');
    logSecurityEvent('CSRF_NO_SESSION_TOKEN', req);
    return res.status(403).json({
      success: false,
      message: 'Session ungültig. Seite neu laden und erneut versuchen.',
      code: 'CSRF_SESSION_INVALID'
    });
  }
  
  // ✅ String-Vergleich mit expliziter Konvertierung
  const sessionTokenStr = String(sessionToken);
  const receivedTokenStr = String(token);
  
  if (receivedTokenStr !== sessionTokenStr) {
    console.log('❌ CSRF Fehler: Token-Mismatch');
    console.log('Expected:', sessionTokenStr);
    console.log('Received:', receivedTokenStr);
    
    logSecurityEvent('CSRF_TOKEN_MISMATCH', req, { 
      providedToken: receivedTokenStr.substring(0, 8),
      expectedToken: sessionTokenStr.substring(0, 8)
    });
    
    return res.status(403).json({
      success: false,
      message: 'CSRF-Token ungültig. Seite neu laden und erneut versuchen.',
      code: 'CSRF_MISMATCH'
    });
  }
  
  console.log('✅ CSRF Check bestanden für:', req.path);
  next();
};

// ✅ Vereinfachte CSRF Protection für HTML-Formulare
const csrfProtectionForForms = (req, res, next) => {
  // GET Requests überspringen
  if (req.method === 'GET') {
    return next();
  }
  
  console.log('🛡️ CSRF Check für Formular:', {
    method: req.method,
    path: req.path,
    sessionID: req.sessionID?.substring(0, 8) + '...',
    hasSession: !!req.session,
    contentType: req.headers['content-type']
  });
  
  // Für HTML-Formulare: Body ist bereits geparst durch express.urlencoded()
  if (req.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
    // Token aus bereits geparstem Body extrahieren
    const token = req.body._csrf;
    const sessionToken = req.session?.csrfToken;
    
    console.log('🔍 Formular Token Details:', {
      receivedToken: token ? token.substring(0, 8) + '...' : 'NONE',
      sessionToken: sessionToken ? sessionToken.substring(0, 8) + '...' : 'NONE',
      tokenExists: !!token,
      sessionTokenExists: !!sessionToken,
      tokensMatch: token === sessionToken,
      bodyKeys: Object.keys(req.body || {})
    });
    
    // CSRF-Check
    if (!token) {
      console.log('❌ CSRF Fehler: Kein Token im Formular');
      logSecurityEvent('CSRF_NO_TOKEN', req);
      return res.status(403).json({
        success: false,
        message: 'CSRF-Token fehlt. Seite neu laden und erneut versuchen.',
        code: 'CSRF_MISSING'
      });
    }
    
    if (!sessionToken) {
      console.log('❌ CSRF Fehler: Kein Token in Session');
      logSecurityEvent('CSRF_NO_SESSION_TOKEN', req);
      return res.status(403).json({
        success: false,
        message: 'Session ungültig. Seite neu laden und erneut versuchen.',
        code: 'CSRF_SESSION_INVALID'
      });
    }
    
    if (token !== sessionToken) {
      console.log('❌ CSRF Fehler: Token-Mismatch');
      logSecurityEvent('CSRF_TOKEN_MISMATCH', req, { 
        providedToken: token.substring(0, 8),
        expectedToken: sessionToken.substring(0, 8)
      });
      return res.status(403).json({
        success: false,
        message: 'CSRF-Token ungültig. Seite neu laden und erneut versuchen.',
        code: 'CSRF_MISMATCH'
      });
    }
    
    console.log('✅ CSRF Check bestanden für Formular:', req.path);
    next();
  } else {
    // Für andere Content-Types normale CSRF-Protection verwenden
    return csrfProtection(req, res, next);
  }
};

// Input Validation Middleware
const anfrageValidation = [
  body('kontakt.vorname')
    .trim()
    .isLength({ min: 2, max: 50 })
    .matches(/^[a-zA-ZäöüßÄÖÜ\s-']+$/)
    .withMessage('Vorname enthält ungültige Zeichen'),
  
  body('kontakt.nachname')
    .trim()
    .isLength({ min: 2, max: 50 })
    .matches(/^[a-zA-ZäöüßÄÖÜ\s-']+$/)
    .withMessage('Nachname enthält ungültige Zeichen'),
  
  body('kontakt.email')
    .normalizeEmail()
    .isEmail()
    .isLength({ max: 254 })
    .withMessage('Ungültige Email-Adresse'),
  
  body('kontakt.telefon')
    .trim()
    .matches(/^[\d\s\+\-\(\)\/]+$/)
    .isLength({ min: 5, max: 20 })
    .withMessage('Ungültige Telefonnummer'),
  
  body('beschreibung')
    .trim()
    .isLength({ min: 10, max: 2000 })
    .blacklist('<>"\';')
    .withMessage('Beschreibung zu kurz, zu lang oder enthält ungültige Zeichen. Min 10 Zeichen, Max 2000 Zeichen.'),
  
  body('kontakt.adresse')
    .trim()
    .isLength({ min: 5, max: 100 })
    .blacklist('<>"\'')
    .withMessage('Adresse ungültig'),
  
  body('kontakt.plz')
    .trim()
    .matches(/^\d{5}$/)
    .withMessage('PLZ muss 5 Ziffern haben'),
  
  body('kontakt.ort')
    .trim()
    .isLength({ min: 2, max: 50 })
    .matches(/^[a-zA-ZäöüßÄÖÜ\s-']+$/)
    .withMessage('Ort enthält ungültige Zeichen')
];

// Login Validation
const loginValidation = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 30 })
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('Username enthält ungültige Zeichen'),
  
  body('password')
    .isLength({ min: 8, max: 128 })
    .withMessage('Passwort muss zwischen 8-128 Zeichen haben')
];

// Validation Error Handler
const handleValidation = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const allErrors = errors.array();
    const firstError = allErrors[0]; // Nur die erste Fehlermeldung als "message" zurückgeben

    logSuspiciousActivity(req, 'VALIDATION_FAILED', {
      errors: allErrors,
      body: sanitizeForLogging(req.body)
    });

    return res.status(400).json({
      success: false,
      message: firstError.msg, // <-- zeigt die konkrete Fehlermeldung an
      field: firstError.param, // <-- gibt das Feld zurück, das fehlerhaft ist
      errors: allErrors // <-- alle Fehler werden zusätzlich mitgegeben, falls das Frontend sie braucht
    });
  }

  next();
};


// Sanitize sensitive data for logging
const sanitizeForLogging = (data) => {
  const sanitized = { ...data };
  if (sanitized.password) sanitized.password = '[REDACTED]';
  if (sanitized.kontakt?.email) sanitized.kontakt.email = sanitized.kontakt.email.replace(/(.{2}).*@/, '$1***@');
  return sanitized;
};

// Advanced Rate Limiting mit IP Reputation (nur erfolgreiche Requests zählen)
const createAdvancedRateLimit = (options) => {
  const store = new Map(); // In Produktion besser Redis verwenden

  return rateLimit({
    ...options,
    keyGenerator: (req) => {
      // IPv6-safe IP + User-Agent Kombination
      const ipPart = ipKeyGenerator(req); 
      const uaPart = req.get('User-Agent')?.substring(0, 50) || 'unknown';
      return `${ipPart}_${uaPart}`;
    },
    skipFailedRequests: true, // ❌ Fehlerhafte Requests (z.B. 400) werden nicht gezählt
    handler: (req, res) => {
      logSuspiciousActivity(req, 'RATE_LIMIT_EXCEEDED', {
        limit: options.max,
        windowMs: options.windowMs
      });
      res.status(429).json({
        success: false,
        message: 'Zu viele Anfragen. Bitte warten Sie.',
        retryAfter: Math.ceil(options.windowMs / 1000)
      });
    },
  });
};


// SQL Injection Protection (zusätzlich zu Sequelize)
const sqlInjectionProtection = (req, res, next) => {
  console.log('SQL Protection Middleware:', req.path);
  const suspiciousPatterns = [
    /(\b(union|select|insert|update|delete|drop|create|alter|exec|execute)\b)/gi,
    /('|('')|;|--|\*|\\\/)/gi,
    /(script|javascript|vbscript|onload|onerror|onclick)/gi
  ];

  const checkValue = (value) => {
    if (typeof value === 'string') {
      return suspiciousPatterns.some(pattern => pattern.test(value));
    }
    if (typeof value === 'object' && value !== null) {
      return Object.values(value).some(checkValue);
    }
    return false;
  };

  if (checkValue(req.body) || checkValue(req.query) || checkValue(req.params)) {
    logSuspiciousActivity(req, 'SUSPECTED_INJECTION_ATTEMPT', {
      body: sanitizeForLogging(req.body),
      query: req.query,
      params: req.params
    });
    return res.status(400).json({
      success: false,
      message: 'Ungültige Eingabe erkannt'
    });
  }
  
  next();
};

// Authentication Check mit Session-Sicherheit
const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    logSecurityEvent('UNAUTHORIZED_ACCESS_ATTEMPT', req);
    return res.status(401).json({
      success: false,
      message: 'Authentifizierung erforderlich'
    });
  }
  
  // Session Hijacking Schutz
  const userAgent = req.get('User-Agent');
  if (req.session.userAgent && req.session.userAgent !== userAgent) {
    req.session.destroy();
    logSecurityEvent('SESSION_HIJACK_ATTEMPT', req, {
      sessionUserAgent: req.session.userAgent,
      requestUserAgent: userAgent
    });
    return res.status(401).json({
      success: false,
      message: 'Session ungültig'
    });
  }
  
  req.session.userAgent = userAgent;
  next();
};

module.exports = {
  anfrageValidation,
  loginValidation,
  handleValidation,
  createAdvancedRateLimit,
  sqlInjectionProtection,
  requireAuth,
  csrfProtection,
  csrfProtectionForForms,
  generateCSRFToken,
  sanitizeForLogging
};