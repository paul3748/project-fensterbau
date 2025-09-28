// server.js - FIXED VERSION mit korrigierter CSP und CSRF-Behandlung
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const path = require('path');
const session = require('express-session');
const crypto = require('crypto');
const { sequelize, syncDatabase } = require('./models');
const { logger, logSecurityEvent } = require('./utils/logger');
const {
  createAdvancedRateLimit,
  sqlInjectionProtection,
  csrfProtection,
  generateCSRFToken // ✅ CSRF Token Generator importieren
} = require('./middleware/security');

// ✅ NEUE Sicherheits-Middleware importieren
const {
  routeSecurityMiddleware,
  requireAdminAuth,
  apiSecurityMiddleware,
  debugRouteMiddleware
} = require('./middleware/routeSecurity');

const {
  setupSessionStore,
  createSessionMiddleware,
  createFallbackSession
} = require('./config/session');

const outlookRoutes = require('./routes/outlook');
const anfrageRoutes = require('./routes/anfrageRoutes');
const authRoutes = require('./routes/authRoutes');

const app = express();
const port = process.env.PORT || 3000;
let server;

// ---------------------- Security Middleware ----------------------
app.set('trust proxy', 1);

// ✅ FIXED: Erweiterte CSP mit allen benötigten Domains
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'", // ✅ Für inline Skripte in HTML erlauben
          "'sha256-i1tPkbOgEmRzYZyS1VSnIxA4ThV+3CiI3KXyhhk0Mtk='",
          "https://consent.cookiebot.com", // ✅ Cookiebot
          "https://www.googletagmanager.com", // ✅ Google Tag Manager
          "https://cdn.tailwindcss.com",
          "https://cdn.jsdelivr.net",
          "https://cdnjs.cloudflare.com",
          "https://consentcdn.cookiebot.com"
        ],
        scriptSrcElem: [
          "'self'",
          "'sha256-i1tPkbOgEmRzYZyS1VSnIxA4ThV+3CiI3KXyhhk0Mtk='",
          "https://consent.cookiebot.com",
          "https://www.googletagmanager.com",
          "https://www.google-analytics.com",
          "https://cdn.tailwindcss.com",
          "https://cdn.jsdelivr.net",
          "https://cdnjs.cloudflare.com",
          "https://consentcdn.cookiebot.com"
        ],
        styleSrc: [
          "'self'", 
          "'unsafe-inline'", // ✅ Für inline CSS
          "https://cdn.tailwindcss.com",
          "https://fonts.googleapis.com",
          "https://www.googletagmanager.com", 
          "https://consentcdn.cookiebot.com"
        ],
        imgSrc: [
          "'self'", 
          "data:", 
          "https:", 
          "https://www.googletagmanager.com", // ✅ GTM Pixel
          "https://www.google-analytics.com"
        ],
        connectSrc: [
          "'self'",
          // ✅ WICHTIG: Localhost für lokale API-Calls NICHT erlauben in Production
          ...(process.env.NODE_ENV === 'development' ? ["http://localhost:3000"] : []),
          "https://www.google-analytics.com", // ✅ Analytics
          "https://www.googletagmanager.com",
          "https://consent.cookiebot.com", // ✅ Cookiebot API
          "https://consentcdn.cookiebot.com"
        ],
        fontSrc: [
          "'self'",
          "https://fonts.gstatic.com", // ✅ Google Fonts
          "data:" // ✅ Für base64 fonts
        ],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: [
          "'self'",
          "https://www.googletagmanager.com",
          "https://consent.cookiebot.com", // ✅ Cookiebot iFrames
          "https://consentcdn.cookiebot.com"
        ],
        childSrc: [
          "'self'",
          "https://consent.cookiebot.com", // ✅ Cookiebot
          "https://consentcdn.cookiebot.com"
        ],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"], // ✅ Clickjacking Schutz
        upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
      }
    },
    crossOriginEmbedderPolicy: false,
    hsts: { 
      maxAge: 31536000, 
      includeSubDomains: true, 
      preload: true 
    },
    referrerPolicy: { policy: "same-origin" }
  })
);

// Zusätzliche Security Headers
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // ✅ Nur in Production HSTS setzen
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// HTTPS Redirect (nur in Production)
app.use((req, res, next) => {
  const forwarded = req.headers['x-forwarded-proto'];
  if (process.env.NODE_ENV === 'production' && forwarded && forwarded !== 'https') {
    logSecurityEvent('HTTP_TO_HTTPS_REDIRECT', req);
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  }
  next();
});

// ---------------------- Rate Limiting ----------------------
const publicLimiter = createAdvancedRateLimit({ 
  windowMs: 15*60*1000, 
  max: 200, 
  message: 'Zu viele Anfragen von dieser IP'
});

const strictLimiter = createAdvancedRateLimit({ 
  windowMs: 15*60*1000, 
  max: 100,
  message: 'Rate Limit erreicht - bitte warten Sie'
});

const loginLimiter = createAdvancedRateLimit({ 
  windowMs: 15*60*1000, 
  max: 5, 
  skipSuccessfulRequests: true,
  message: 'Zu viele Login-Versuche'
});

const anfrageFormLimiter = createAdvancedRateLimit({ 
  windowMs: 30*60*1000, 
  max: 10, 
  message: 'Zu viele Terminanfragen von dieser IP'
});

const adminApiLimiter = createAdvancedRateLimit({ 
  windowMs: 15*60*1000, 
  max: 300, 
  skipSuccessfulRequests: true,
  message: 'Admin Rate Limit erreicht'
});

// Rate Limiting basierend auf Route-Typ
app.use((req, res, next) => {
  // Login-Endpunkte
  if (req.path === '/login' && req.method === 'POST') {
    return loginLimiter(req, res, next);
  }
  
  // Terminanfrage-Endpunkte
  if ((req.path === '/anfrage' && req.method === 'POST') || 
      req.path.startsWith('/outlook/freie-slots')) {
    return anfrageFormLimiter(req, res, next);
  }
  
  // Admin-Endpunkte
  if (req.path.startsWith('/admin') || 
      (req.path.startsWith('/outlook') && req.method !== 'GET') ||
      (req.path.startsWith('/anfrage') && req.method !== 'POST')) {
    return adminApiLimiter(req, res, next);
  }
  
  // Standard Rate Limiting für alle anderen
  return publicLimiter(req, res, next);
});

// ---------------------- Body Parser ----------------------
app.use(express.json({ limit:'1mb' }));
app.use(express.urlencoded({ extended:true, limit:'1mb', parameterLimit:50 }));

// ---------------------- Static Files ----------------------
app.use(express.static(path.join(__dirname,'public'), {
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

app.use('/views', express.static(path.join(__dirname,'views'), {
  maxAge: '1d'
}));

// ---------------------- Database & Server Start ----------------------
(async () => {
  try {
    await sequelize.authenticate();
    await syncDatabase();

    // Session Store initialisieren
    const sessionStore = await setupSessionStore(sequelize);
    app.use(createSessionMiddleware(sessionStore));
    console.log('✅ Session Store erfolgreich eingerichtet');

    // ✅ CSRF Token Generator für ALLE Requests (vor anderen Middleware)
    app.use(generateCSRFToken);

    // ✅ DEBUG Middleware (nur in Development)
    if (process.env.NODE_ENV === 'development') {
      app.use(debugRouteMiddleware);
    }

    // ✅ SQL Injection Protection
    app.use(sqlInjectionProtection);

    // ✅ API Security Middleware
    app.use('/api', apiSecurityMiddleware);
    app.use('/outlook', apiSecurityMiddleware);
    app.use('/anfrage', apiSecurityMiddleware);

    // ✅ HAUPTSICHERHEITS-MIDDLEWARE - Entscheidet über Zugriffskontrolle
    app.use(routeSecurityMiddleware);

    // ---------------------- CSRF Token Endpoint ----------------------
    // ✅ FIXED: Verbesserter CSRF-Endpunkt mit besserer Session-Behandlung
    app.get('/csrf-token', (req, res) => {
      console.log('🔐 CSRF Token Request:', {
        path: req.path,
        sessionID: req.sessionID?.substring(0, 8) + '...',
        hasSession: !!req.session,
        hasToken: !!req.session?.csrfToken,
        ip: req.ip
      });

      // ✅ Token sollte bereits durch generateCSRFToken Middleware gesetzt sein
      if (!req.session?.csrfToken) {
        console.log('⚠️ Kein CSRF Token in Session - generiere neuen');
        const newToken = crypto.randomBytes(32).toString('hex');
        req.session.csrfToken = newToken;

        req.session.save(err => {
          if (err) {
            console.error('❌ Fehler beim Speichern der Session:', err);
            return res.status(500).json({ 
              success: false, 
              message: 'Session-Fehler beim CSRF Token',
              error: process.env.NODE_ENV === 'development' ? err.message : undefined
            });
          }
          
          console.log('✅ Neuer CSRF Token gespeichert');
          res.json({ 
            success: true,
            csrfToken: newToken, 
            sessionId: req.sessionID?.substring(0, 8) + '...',
            timestamp: new Date().toISOString()
          });
        });
      } else {
        console.log('✅ Existierender CSRF Token gefunden');
        res.json({ 
          success: true,
          csrfToken: String(req.session.csrfToken),
          sessionId: req.sessionID?.substring(0, 8) + '...',
          timestamp: new Date().toISOString()
        });
      }
    });

    // ---------------------- Routes ----------------------
    
    // ✅ Hauptseite - Terminanfrage-Formular (ÖFFENTLICH)
    app.get('/', (req, res) => {
      console.log('📝 Hauptseite aufgerufen von:', req.ip, {
        userAgent: req.headers['user-agent']?.substring(0, 50) + '...',
        hasSession: !!req.session,
        sessionID: req.sessionID?.substring(0, 8) + '...'
      });
      res.sendFile(path.join(__dirname, 'public', 'home.html'));
    });

    app.get('/:page', (req, res, next) => {
  const file = path.join(__dirname, 'public', `${req.params.page}.html`);
  res.sendFile(file, (err) => {
    if (err) {
      next(); // Falls Datei nicht existiert -> 404 Handler
    }
  });
  });

    // ✅ Login-Bereich (ÖFFENTLICH)
    app.get('/login', (req, res) => {
      // Wenn bereits eingeloggt, zum Admin weiterleiten
      if (req.session?.user?.role === 'admin') {
        console.log('↪️ Bereits eingeloggt - Weiterleitung zu Admin:', req.session.user.username);
        return res.redirect('/admin');
      }
      
      console.log('🔑 Login-Seite aufgerufen von:', req.ip);
      res.sendFile(path.join(__dirname, 'views', 'login.html'));
    });

    // ✅ Login POST (ÖFFENTLICH, aber mit CSRF-Schutz)
    app.post('/login', csrfProtection, async (req, res) => {
      try {
        console.log('🔐 Login-Versuch:', {
          username: req.body.username,
          ip: req.ip,
          hasCSRF: !!req.headers['x-csrf-token'] || !!req.body._csrf,
          sessionID: req.sessionID?.substring(0, 8) + '...'
        });
        
        const { login } = require('./controllers/authController');
        await login(req, res);
        
      } catch (error) {
        console.error('❌ Login-Route Fehler:', error);
        res.status(500).json({
          success: false,
          message: 'Login-Fehler aufgetreten',
          error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
      }
    });

    // ✅ Logout (ÖFFENTLICH)
    app.post('/logout', (req, res) => {
      try {
        console.log('👋 Logout:', {
          userId: req.session?.user?.id,
          username: req.session?.user?.username,
          ip: req.ip
        });
        
        const { logout } = require('./controllers/authController');
        logout(req, res);
        
      } catch (error) {
        console.error('❌ Logout-Fehler:', error);
        res.status(500).json({
          success: false,
          message: 'Logout-Fehler aufgetreten'
        });
      }
    });

    // ✅ Admin-Dashboard (GESCHÜTZT)
    app.get('/admin', (req, res) => {
      console.log('📊 Admin-Dashboard Zugriff:', {
        username: req.session.user.username,
        userId: req.session.user.id,
        ip: req.ip
      });
      res.sendFile(path.join(__dirname, 'views', 'admin.html'));
    });

    // ✅ API-Routen mit automatischer Sicherheitsprüfung
    app.use('/outlook', outlookRoutes);
    app.use('/anfrage', anfrageRoutes);
    app.use('/', authRoutes);

    // ✅ Health Check (ÖFFENTLICH)
    app.get('/health', (req, res) => {
      res.status(200).json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        version: process.env.APP_VERSION || '1.0.0'
      });
    });

    // ---------------------- Error Handling ----------------------
    
    // 404 Handler
    app.use((req, res, next) => {
      // Statische Dateien nicht loggen
      if (!req.originalUrl.match(/\.(js|css|png|jpg|ico|map|svg|woff|woff2|ttf|eot)$/)) {
        console.log('🔍 404 Not Found:', req.method, req.originalUrl);
        logSecurityEvent('404_NOT_FOUND', req, {
          attemptedPath: req.originalUrl,
          userAgent: req.headers['user-agent']
        });
      }
      
      // JSON-Response für API-Calls
      if (req.headers['content-type']?.includes('application/json') || 
          req.originalUrl.startsWith('/api') || 
          req.originalUrl.startsWith('/outlook') || 
          req.originalUrl.startsWith('/anfrage')) {
        return res.status(404).json({ 
          success: false, 
          message: 'Endpunkt nicht gefunden',
          path: req.originalUrl
        });
      }
      
      // HTML-Response für Browser
      res.status(404).send(`
        <!DOCTYPE html>
        <html lang="de">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Seite nicht gefunden</title>
            <style>
              body { font-family: Arial, sans-serif; text-align: center; margin-top: 50px; }
              .container { max-width: 600px; margin: 0 auto; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>404 - Seite nicht gefunden</h1>
              <p>Die angeforderte Seite existiert nicht.</p>
              <a href="/">← Zurück zur Startseite</a>
            </div>
          </body>
        </html>
      `);
    });

    // ✅ IMPROVED: Global Error Handler mit besserer CSRF-Behandlung
    app.use((err, req, res, next) => {
      if (res.headersSent) return next(err);
      
      const errorId = crypto.randomBytes(16).toString('hex');
      
      // CSRF-Fehler speziell behandeln
      if (err.code === 'EBADCSRFTOKEN' || err.message?.includes('CSRF')) {
        console.log('❌ CSRF Token Fehler:', {
          errorId,
          path: req.path,
          method: req.method,
          sessionID: req.sessionID?.substring(0, 8) + '...',
          hasSession: !!req.session,
          hasToken: !!req.session?.csrfToken,
          providedToken: req.headers['x-csrf-token']?.substring(0, 8) + '...' || req.body?._csrf?.substring(0, 8) + '...'
        });
        
        logSecurityEvent('CSRF_TOKEN_ERROR', req, { 
          errorId,
          errorCode: err.code,
          errorMessage: err.message
        });
        
        if (req.xhr || req.headers.accept?.includes('application/json')) {
          return res.status(403).json({ 
            success: false, 
            message: 'CSRF-Token ungültig oder fehlt. Seite neu laden und erneut versuchen.',
            code: 'CSRF_INVALID',
            errorId,
            action: 'reload_page'
          });
        }
        
        return res.redirect('/login?message=csrf_error');
      }
      
      // Session-Fehler
      if (err.message?.includes('session') || err.message?.includes('Session')) {
        console.log('❌ Session Fehler:', {
          errorId,
          path: req.path,
          method: req.method,
          error: err.message
        });
        
        logSecurityEvent('SESSION_ERROR', req, {
          errorId,
          error: err.message
        });
        
        if (req.xhr || req.headers.accept?.includes('application/json')) {
          return res.status(500).json({ 
            success: false, 
            message: 'Session-Fehler. Seite neu laden und erneut versuchen.',
            code: 'SESSION_ERROR',
            errorId
          });
        }
        
        return res.redirect('/?message=session_error');
      }
      
      // Allgemeine Fehler
      console.error('❌ Server Error:', { 
        errorId, 
        message: err.message, 
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
        path: req.path,
        method: req.method,
        ip: req.ip
      });
      
      logSecurityEvent('SERVER_ERROR', req, {
        errorId,
        error: err.message,
        stack: err.stack
      });
      
      // JSON-Response für API-Calls
      if (req.xhr || req.headers.accept?.includes('application/json') || req.path.startsWith('/api')) {
        return res.status(500).json({ 
          success: false, 
          message: 'Interner Server-Fehler', 
          errorId,
          error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
      }
      
      // HTML-Response für Browser
      res.status(500).send(`
        <!DOCTYPE html>
        <html lang="de">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Server Fehler</title>
            <style>
              body { font-family: Arial, sans-serif; text-align: center; margin-top: 50px; }
              .container { max-width: 600px; margin: 0 auto; }
              .error-id { font-size: 0.8em; color: #666; margin-top: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>500 - Server Fehler</h1>
              <p>Ein unerwarteter Fehler ist aufgetreten.</p>
              <a href="/">← Zurück zur Startseite</a>
              <div class="error-id">Fehler-ID: ${errorId}</div>
            </div>
          </body>
        </html>
      `);
    });

    // ---------------------- Server Start ----------------------
    server = app.listen(port, '0.0.0.0', () => { // ✅ Auf alle Interfaces binden für Cloud
      console.log(`✅ Server läuft auf Port ${port}`);
      console.log(`🌐 Terminanfrage: http://localhost:${port}`);
      console.log(`🔒 Admin-Login: http://localhost:${port}/login`);
      console.log(`📊 Admin-Dashboard: http://localhost:${port}/admin`);
      console.log(`🛡️ Differenzierte Routensicherheit: Aktiv`);
      console.log(`📝 Öffentliche Endpunkte: Terminformular, CSRF, Slot-Abfrage`);
      console.log(`🔐 Geschützte Endpunkte: Admin-Dashboard, Anfrage-Management`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🔐 CSRF Protection: Aktiv mit automatischer Token-Generierung`);
      console.log(`🛡️ CSP: Erweitert für Cookiebot und GTM`);
    });

  } catch (err) {
    console.error('❌ Fehler beim Start:', err);
    console.log('📄 Fallback auf Memory-Session...');
    
    // Fallback-Session für Development
    app.use(createFallbackSession());
    
    // Minimale Route-Sicherheit im Fallback-Mode
    app.use(routeSecurityMiddleware);
    
    app.get('/csrf-token', (req, res) => {
      if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      }
      res.json({ 
        success: true,
        csrfToken: req.session.csrfToken,
        fallback: true 
      });
    });

    app.use('/outlook', outlookRoutes);
    app.use('/anfrage', anfrageFormLimiter, anfrageRoutes);
    app.use('/', authRoutes);

    server = app.listen(port, '0.0.0.0', () => {
      console.log(`⚠️ Server läuft auf Port ${port} (Fallback-Mode)`);
      console.log(`🛡️ Routensicherheit: Reduziert (Memory-Session)`);
    });
  }
})();

// ---------------------- Graceful Shutdown ----------------------
process.on('SIGTERM', () => {
  console.log('🔴 SIGTERM received, shutting down gracefully');
  if (server) {
    server.close(() => {
      console.log('✅ Server stopped');
      sequelize?.close?.();
      process.exit(0);
    });
  }
});

process.on('SIGINT', () => {
  console.log('🔴 SIGINT received, shutting down gracefully');
  if (server) {
    server.close(() => {
      console.log('✅ Server stopped');
      sequelize?.close?.();
      process.exit(0);
    });
  }
});

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  logSecurityEvent('UNCAUGHT_EXCEPTION', { ip: 'system' }, { 
    error: err.message, 
    stack: err.stack 
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  logSecurityEvent('UNHANDLED_REJECTION', { ip: 'system' }, { 
    reason: reason?.toString?.() || String(reason), 
    promise: promise.toString() 
  });
});

module.exports = app;