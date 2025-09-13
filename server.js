// server.js - UPDATED VERSION mit differenzierter Routensicherheit
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
  csrfProtection
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

// CSP mit erlaubten externen Ressourcen
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "https://cdn.tailwindcss.com",
          "https://cdn.jsdelivr.net",
          "https://cdnjs.cloudflare.com"
        ],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false,
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: "same-origin" }
  })
);

// Zusätzliche Security Headers
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// HTTPS Redirect
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
  max: 200, // Erhöht für öffentliche Endpunkte
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
  max: 10, // Erhöht für Terminanfragen
  message: 'Zu viele Terminanfragen von dieser IP'
});

const adminApiLimiter = createAdvancedRateLimit({ 
  windowMs: 15*60*1000, 
  max: 300, // Hoch für Admin-Bereich
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
    // ✅ Bereits als öffentliche Route definiert, keine zusätzliche Authentifizierung nötig
    app.get('/csrf-token', (req, res) => {
      console.log('🔐 CSRF Token Request:', {
        path: req.path,
        sessionID: req.sessionID?.substring(0, 8) + '...',
        hasToken: !!req.session?.csrfToken
      });

      if (!req.session?.csrfToken) {
        const newToken = crypto.randomBytes(32).toString('hex');
        req.session.csrfToken = newToken;

        req.session.save(err => {
          if (err) {
            console.error('❌ Fehler beim Speichern der Session:', err);
            return res.status(500).json({ success: false, message: 'Session-Fehler' });
          }
          console.log('✅ Neuer CSRF Token gespeichert');
          res.json({ csrfToken: newToken, sessionId: req.sessionID?.substring(0, 8) + '...' });
        });
      } else {
        console.log('✅ Existierender Token gefunden');
        res.json({ 
          csrfToken: String(req.session.csrfToken),
          sessionId: req.sessionID?.substring(0, 8) + '...'
        });
      }
    });

    // ---------------------- Routes ----------------------
    
    // ✅ Hauptseite - Terminanfrage-Formular (ÖFFENTLICH)
    app.get('/', (req, res) => {
      console.log('📝 Hauptseite aufgerufen von:', req.ip);
      res.sendFile(path.join(__dirname, 'public', 'terminanfrage.html'));
    });

    // ✅ Login-Bereich (ÖFFENTLICH)
    app.get('/login', (req, res) => {
      // Wenn bereits eingeloggt, zum Admin weiterleiten
      if (req.session?.user?.role === 'admin') {
        return res.redirect('/admin');
      }
      res.sendFile(path.join(__dirname, 'views', 'login.html'));
    });

    // ✅ Login POST (ÖFFENTLICH, aber mit CSRF-Schutz)
    app.post('/login', csrfProtection, async (req, res) => {
      const { login } = require('./controllers/authController');
      await login(req, res);
    });

    // ✅ Logout (ÖFFENTLICH)
    app.post('/logout', (req, res) => {
      const { logout } = require('./controllers/authController');
      logout(req, res);
    });

    // ✅ Admin-Dashboard (GESCHÜTZT - wird automatisch durch routeSecurityMiddleware geprüft)
    app.get('/admin', (req, res) => {
      // Sicherheitsprüfung erfolgt bereits durch routeSecurityMiddleware
      console.log('📊 Admin-Dashboard Zugriff:', req.session.user.username);
      res.sendFile(path.join(__dirname, 'views', 'admin.html'));
    });

    // ✅ API-Routen mit automatischer Sicherheitsprüfung
    // Die routeSecurityMiddleware entscheidet automatisch, welche Endpunkte öffentlich/geschützt sind

    // Outlook-Routes
    app.use('/outlook', outlookRoutes);

    // Anfrage-Routes  
    app.use('/anfrage', anfrageRoutes);

    // Auth-Routes
    app.use('/', authRoutes);

    // ✅ Health Check (ÖFFENTLICH)
    app.get('/health', (req, res) => {
      res.status(200).json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
      });
    });

    // ---------------------- Error Handling ----------------------
    
    // ✅ Route Not Found Handler
    app.use('*', (req, res) => {
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
        <html>
          <head><title>Seite nicht gefunden</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;">
            <h1>404 - Seite nicht gefunden</h1>
            <p>Die angeforderte Seite existiert nicht.</p>
            <a href="/">Zurück zur Startseite</a>
          </body>
        </html>
      `);
    });

    // ✅ Global Error Handler
    app.use((err, req, res, next) => {
      if (res.headersSent) return next(err);
      
      const errorId = crypto.randomBytes(16).toString('hex');
      
      // CSRF-Fehler speziell behandeln
      if (err.code === 'EBADCSRFTOKEN') {
        console.log('❌ CSRF Token Fehler:', {
          errorId,
          path: req.path,
          sessionID: req.sessionID?.substring(0, 8) + '...',
          hasSession: !!req.session
        });
        
        logSecurityEvent('CSRF_TOKEN_INVALID', req, { errorId });
        
        if (req.xhr || req.headers.accept?.includes('application/json')) {
          return res.status(403).json({ 
            success: false, 
            message: 'CSRF-Token ungültig oder fehlt',
            code: 'CSRF_INVALID',
            errorId
          });
        }
        
        return res.redirect('/login?message=csrf_error');
      }
      
      // Allgemeine Fehler
      console.error('❌ Server Error:', { 
        errorId, 
        message: err.message, 
        stack: err.stack,
        path: req.path,
        method: req.method
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
          errorId 
        });
      }
      
      // HTML-Response für Browser
      res.status(500).send(`
        <html>
          <head><title>Server Fehler</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;">
            <h1>500 - Server Fehler</h1>
            <p>Ein unerwarteter Fehler ist aufgetreten.</p>
            <p>Fehler-ID: ${errorId}</p>
            <a href="/">Zurück zur Startseite</a>
          </body>
        </html>
      `);
    });

    // ---------------------- Server Start ----------------------
    server = app.listen(port, () => {
      console.log(`✅ Server läuft auf Port ${port}`);
      console.log(`🌐 Terminanfrage: http://localhost:${port}`);
      console.log(`🔒 Admin-Login: http://localhost:${port}/login`);
      console.log(`📊 Admin-Dashboard: http://localhost:${port}/admin`);
      console.log(`🛡️ Differenzierte Routensicherheit: Aktiv`);
      console.log(`📝 Öffentliche Endpunkte: Terminformular, CSRF, Slot-Abfrage`);
      console.log(`🔐 Geschützte Endpunkte: Admin-Dashboard, Anfrage-Management`);
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
      res.json({ csrfToken: req.session.csrfToken });
    });

    app.use('/outlook', outlookRoutes);
    app.use('/anfrage', anfrageFormLimiter, anfrageRoutes);
    app.use('/', authRoutes);

    server = app.listen(port, () => {
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
      process.exit(0);
    });
  }
});

process.on('SIGINT', () => {
  console.log('🔴 SIGINT received, shutting down gracefully');
  if (server) {
    server.close(() => {
      console.log('✅ Server stopped');
      process.exit(0);
    });
  }
});

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  logSecurityEvent('UNCAUGHT_EXCEPTION', { ip: 'system' }, { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  logSecurityEvent('UNHANDLED_REJECTION', { ip: 'system' }, { reason, promise: promise.toString() });
});

module.exports = app;