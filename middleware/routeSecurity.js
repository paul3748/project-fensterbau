// middleware/routeSecurity.js - Express 5 kompatible Version

const crypto = require('crypto');
const { logger, logSecurityEvent } = require('../utils/logger');

/**
 * Definition der öffentlich zugänglichen Endpunkte
 * Diese können ohne Authentifizierung aufgerufen werden
 */
const PUBLIC_ROUTES = {
  // Terminanfrage-Formular Endpunkte
  'GET:/outlook/freie-slots': true,           // Freie Zeitslots abrufen
  'GET:/outlook/available-slots': true,       // Alternative Route für Slots
  'POST:/anfrage': true,                      // Neue Terminanfrage erstellen
  'GET:/csrf-token': true,                    // CSRF Token abrufen
  
  // Statische Dateien und Haupt-Formular
  'GET:/': true,                              // Hauptseite (Terminformular)
  'GET:/terminanfrage.html': true,            // Direkter Zugriff aufs Formular
  'GET:/health': true,                        // Health Check
  
  // Login-Bereich
  'GET:/login': true,                         // Login-Seite anzeigen
  'POST:/login': true,                        // Login durchführen
  'POST:/logout': true,                       // Logout durchführen
};

/**
 * Admin-geschützte Endpunkte - explizite Definition
 * Alle anderen Admin-Funktionen sind standardmäßig geschützt
 */
const ADMIN_PROTECTED_ROUTES = {
  // Admin Dashboard
  'GET:/admin': true,
  // ❌ FIXED: Entferne problematische Wildcard-Patterns
  // 'GET:/admin/*': true,  // <- Das verursacht den path-to-regexp Fehler
  
  // Anfrage-Management (Admin-Funktionen)
  'GET:/anfrage': true,                       // Alle Anfragen auflisten
  // ❌ FIXED: Spezifische Routen statt Wildcards
  // 'PUT:/anfrage/*': true,                  // <- Problematisch
  // 'DELETE:/anfrage/*': true,               // <- Problematisch  
  // 'GET:/anfrage/*': true,                  // <- Problematisch
  
  // Outlook Admin-Funktionen
  'GET:/outlook/events': true,                // Alle Kalenderereignisse
  'POST:/outlook/events': true,               // Kalendereintrag erstellen
  'GET:/outlook/test': true,                  // Test-Route
  'GET:/outlook/health': true,                // Health Check
  // ❌ FIXED: Spezifische Routen statt Wildcards
  // 'PUT:/outlook/events/*': true,           // <- Problematisch
  // 'DELETE:/outlook/events/*': true,        // <- Problematisch
  
  // Benutzer-Management
  'GET:/users': true,
  'POST:/users': true,
  // ❌ FIXED: Entferne Wildcard-Patterns
  // 'PUT:/users/*': true,                    // <- Problematisch
  // 'DELETE:/users/*': true,                 // <- Problematisch
  
  // Statistiken und Export
  'GET:/anfrage/stats/overview': true,
  'GET:/anfrage/export/csv': true,
};

/**
 * Prüft ob eine Route öffentlich zugänglich ist
 */
function isPublicRoute(method, path) {
  const routeKey = `${method}:${path}`;
  
  // Exakte Übereinstimmung
  if (PUBLIC_ROUTES[routeKey]) {
    return true;
  }
  
  // ❌ REMOVED: Problematische Wildcard-Logik entfernt
  // Stattdessen: String-basierte Präfix-Prüfung
  
  // Statische Dateien (JS, CSS, Bilder, etc.)
  if (method === 'GET' && path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|map)$/)) {
    return true;
  }
  
  return false;
}

/**
 * Prüft ob eine Route Admin-Authentifizierung benötigt
 */
function requiresAdminAuth(method, path) {
  const routeKey = `${method}:${path}`;
  
  // Exakte Übereinstimmung
  if (ADMIN_PROTECTED_ROUTES[routeKey]) {
    return true;
  }
  
  // ❌ FIXED: String-basierte Präfix-Prüfung statt Wildcard-Regex
  // Admin-Pfade standardmäßig schützen
  if (path.startsWith('/admin')) {
    return true;
  }
  
  // Anfrage-Management Routen (mit ID-Parameter)
  if (path.startsWith('/anfrage/') && ['GET', 'PUT', 'DELETE', 'POST'].includes(method)) {
    // Ausnahme für öffentliche POST-Route
    if (method === 'POST' && path === '/anfrage') {
      return false;
    }
    return true;
  }
  
  // Outlook-Admin Routen (mit eventId-Parameter)  
  if (path.startsWith('/outlook/events/') && ['PUT', 'DELETE', 'PATCH'].includes(method)) {
    return true;
  }
  
  // User-Management Routen (mit ID-Parameter)
  if (path.startsWith('/users/') && ['PUT', 'DELETE', 'PATCH'].includes(method)) {
    return true;
  }
  
  return false;
}

/**
 * Hauptsicherheits-Middleware
 * Entscheidet basierend auf Route, welche Authentifizierung erforderlich ist
 */
const routeSecurityMiddleware = (req, res, next) => {
  const method = req.method;
  const path = req.path;
  
  console.log('🛡️ Route Security Check:', {
    method,
    path,
    isPublic: isPublicRoute(method, path),
    requiresAdmin: requiresAdminAuth(method, path),
    hasSession: !!req.session,
    hasUser: !!req.session?.user,
    userRole: req.session?.user?.role,
    ip: req.ip
  });

  // Öffentliche Routen durchlassen
  if (isPublicRoute(method, path)) {
    console.log('✅ Öffentliche Route - Zugriff erlaubt');
    return next();
  }

  // Admin-Routen prüfen
  if (requiresAdminAuth(method, path)) {
    return requireAdminAuth(req, res, next);
  }

  // Alle anderen Routen sind standardmäßig öffentlich
  // (es sei denn, sie werden explizit als geschützt definiert)
  console.log('✅ Standard-Route - Zugriff erlaubt');
  next();
};

/**
 * Admin-Authentifizierungs-Middleware
 */
const requireAdminAuth = (req, res, next) => {
  console.log('🔐 Admin Auth Required:', {
    path: req.path,
    method: req.method,
    hasSession: !!req.session,
    hasUser: !!req.session?.user,
    userRole: req.session?.user?.role,
    sessionID: req.sessionID?.substring(0, 8) + '...'
  });

  // Session-Validierung
  if (!req.session?.user) {
    logSecurityEvent('UNAUTHORIZED_ACCESS_ATTEMPT', req, { 
      reason: 'No session or user',
      attemptedPath: req.path,
      requiresAuth: 'admin'
    });
    
    // Bei API-Requests JSON zurückgeben
    if (req.xhr || req.headers.accept?.includes('application/json') || req.path.startsWith('/api')) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentifizierung erforderlich',
        requiresLogin: true,
        redirectTo: '/login'
      });
    }
    
    // Bei Browser-Requests zur Login-Seite weiterleiten
    return res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl));
  }

  // Rollen-Validierung
  if (req.session.user.role !== 'admin') {
    logSecurityEvent('INSUFFICIENT_PERMISSIONS', req, { 
      userId: req.session.user.id,
      username: req.session.user.username,
      userRole: req.session.user.role,
      requiredRole: 'admin',
      attemptedPath: req.path 
    });
    
    if (req.xhr || req.headers.accept?.includes('application/json') || req.path.startsWith('/api')) {
      return res.status(403).json({ 
        success: false, 
        message: 'Unzureichende Berechtigung',
        userRole: req.session.user.role,
        requiredRole: 'admin'
      });
    }
    
    return res.status(403).send('Zugriff verweigert - Admin-Berechtigung erforderlich');
  }

  // Session-Timeout prüfen (2 Stunden)
  const sessionAge = Date.now() - new Date(req.session.user.loginTime).getTime();
  const maxSessionAge = 2 * 60 * 60 * 1000;
  
  if (sessionAge > maxSessionAge) {
    logSecurityEvent('SESSION_EXPIRED', req, { 
      userId: req.session.user.id,
      sessionAge: Math.round(sessionAge / 1000 / 60), // in Minuten
      maxAgeMinutes: maxSessionAge / 1000 / 60
    });
    
    req.session.destroy((err) => {
      if (err) console.error('Session destroy error:', err);
    });
    
    if (req.xhr || req.headers.accept?.includes('application/json') || req.path.startsWith('/api')) {
      return res.status(401).json({ 
        success: false, 
        message: 'Session abgelaufen - Bitte erneut anmelden',
        requiresLogin: true,
        reason: 'session_expired'
      });
    }
    
    return res.redirect('/login?message=session_expired&redirect=' + encodeURIComponent(req.originalUrl));
  }

  // Optional: IP-Konsistenz prüfen
  if (process.env.CHECK_IP_CONSISTENCY === 'true' && 
      req.session.loginIP && 
      req.session.loginIP !== req.ip) {
    
    logSecurityEvent('IP_CHANGE_DETECTED', req, { 
      userId: req.session.user.id,
      originalIP: req.session.loginIP, 
      newIP: req.ip 
    });
    
    req.session.destroy((err) => {
      if (err) console.error('Session destroy error:', err);
    });
    
    if (req.xhr || req.headers.accept?.includes('application/json') || req.path.startsWith('/api')) {
      return res.status(401).json({ 
        success: false, 
        message: 'Sicherheitskonflikt - IP-Adresse geändert',
        requiresLogin: true,
        reason: 'ip_change'
      });
    }
    
    return res.redirect('/login?message=security_conflict');
  }

  // Erfolgreiche Authentifizierung
  console.log('✅ Admin-Authentifizierung erfolgreich');
  
  // Aktivitäts-Logging für Admin-Aktionen
  logSecurityEvent('ADMIN_ACCESS', req, {
    userId: req.session.user.id,
    username: req.session.user.username,
    action: `${req.method} ${req.path}`,
    sessionAge: Math.round(sessionAge / 1000 / 60)
  });
  
  next();
};

/**
 * Spezielle Middleware für API-Endpunkte mit erweiterten Sicherheitsprüfungen
 */
const apiSecurityMiddleware = (req, res, next) => {
  // Zusätzliche API-spezifische Sicherheitsprüfungen
  
  // Content-Type Validation für POST/PUT Requests
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    if (!req.headers['content-type']?.includes('application/json')) {
      logSecurityEvent('INVALID_CONTENT_TYPE', req, { 
        contentType: req.headers['content-type'],
        expectedType: 'application/json'
      });
      return res.status(400).json({
        success: false,
        message: 'Ungültiger Content-Type - JSON erwartet'
      });
    }
  }

  // User-Agent Validation (Basic Bot Protection)
  if (!req.headers['user-agent'] || req.headers['user-agent'].length < 10) {
    logSecurityEvent('SUSPICIOUS_USER_AGENT', req, { 
      userAgent: req.headers['user-agent']
    });
    
    // Für öffentliche Routen nur warnen, nicht blockieren
    if (!isPublicRoute(req.method, req.path)) {
      return res.status(400).json({
        success: false,
        message: 'Ungültiger User-Agent'
      });
    }
  }

  next();
};

/**
 * Debug-Middleware für Entwicklung
 */
const debugRouteMiddleware = (req, res, next) => {
  if (process.env.NODE_ENV === 'development') {
    console.log('🔍 Route Debug:', {
      method: req.method,
      path: req.path,
      query: req.query,
      isPublic: isPublicRoute(req.method, req.path),
      requiresAdmin: requiresAdminAuth(req.method, req.path),
      userAgent: req.headers['user-agent']?.substring(0, 50) + '...',
      contentType: req.headers['content-type'],
      hasAuth: !!req.session?.user
    });
  }
  next();
};

module.exports = {
  routeSecurityMiddleware,
  requireAdminAuth,
  apiSecurityMiddleware,
  debugRouteMiddleware,
  isPublicRoute,
  requiresAdminAuth,
  PUBLIC_ROUTES,
  ADMIN_PROTECTED_ROUTES
};