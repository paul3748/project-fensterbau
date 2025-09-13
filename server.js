// server.js - FIXED VERSION with proper CSP, Session & CSRF handling
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

// FIXED: CSP erlaubt externe CDN-Ressourcen für Admin-Bereich
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

app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

app.use((req, res, next) => {
  const forwarded = req.headers['x-forwarded-proto'];
  if (forwarded && forwarded !== 'https') {
    logSecurityEvent('HTTP_TO_HTTPS_REDIRECT', req);
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  }
  next();
});

// ---------------------- Rate Limiting - FIXED ----------------------
const strictLimiter = createAdvancedRateLimit({ windowMs: 15*60*1000, max: 100 }); // Erhöht von 50 auf 100
const loginLimiter = createAdvancedRateLimit({ windowMs: 15*60*1000, max: 5, skipSuccessfulRequests:true }); // Erhöht von 3 auf 5
const anfrageFormLimiter = createAdvancedRateLimit({ windowMs: 30*60*1000, max: 5 }); // Erhöht von 2 auf 5

// FIXED: Separates Rate Limiting für Admin-API-Calls
const adminApiLimiter = createAdvancedRateLimit({ 
  windowMs: 15*60*1000, 
  max: 200, // Hoch für Admin-Bereich
  skipSuccessfulRequests: true 
});

// Global Rate Limiting
app.use(strictLimiter);

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

// FIXED: Zusätzlicher Static-Ordner für Admin-Views
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

    // Session-Debugging nur im Development
    if (process.env.NODE_ENV === 'development') {
      app.use((req, res, next) => {
        if (!req.path.match(/\.(js|css|png|jpg|ico)$/) && !req.path.includes('favicon')) {
          console.log('🔋 Session Debug:', {
            path: req.path,
            sessionID: req.sessionID?.substring(0, 8) + '...',
            isNew: req.session?.isNew,
            hasUser: !!req.session?.user,
            sessionKeys: Object.keys(req.session || {}).filter(k => k !== 'cookie')
          });
        }
        next();
      });
    }

    app.use(sqlInjectionProtection);

    // ---------------------- CSRF Token Endpoint ----------------------
    app.get('/csrf-token', (req, res) => {
      console.log('🔐 CSRF Token Request:', {
        path: req.path,
        sessionID: req.sessionID?.substring(0, 8) + '...',
        hasToken: !!req.session?.csrfToken
      });

      if (!req.session?.csrfToken) {
        console.log('❌ Kein CSRF Token - Generiere neuen');
        const newToken = crypto.randomBytes(32).toString('hex');
        req.session.csrfToken = newToken;

        req.session.save(err => {
          if (err) {
            console.error('❌ Fehler beim Speichern der Session:', err);
            return res.status(500).json({ success: false, message: 'Session-Fehler' });
          }
          console.log('✅ Neuer CSRF Token gespeichert:', newToken.substring(0, 8) + '...');
          res.json({ csrfToken: newToken });
        });
      } else {
        console.log('✅ Existierender Token gefunden:', String(req.session.csrfToken).substring(0, 8) + '...');
        res.json({ csrfToken: String(req.session.csrfToken) });
      }
    });

// ---------------------- Routes - FIXED Order ----------------------
    
    // Login-Seite (öffentlich)
    app.get('/login', (req, res) => {
      res.sendFile(path.join(__dirname, 'views', 'login.html'));
    });

    // Login POST - Verwende den AuthController direkt
    app.post('/login', loginLimiter, csrfProtection, async (req, res) => {
      const { login } = require('./controllers/authController');
      await login(req, res);
    });

// ---------------------- Geschützte Admin-Routen ----------------------
    
    // Admin-Bereich mit Authentifizierung
    app.get('/admin', (req, res) => {
      console.log('Admin Access Check (ausführlich):', {
        hasUser: !!req.session?.user,
        userRole: req.session?.user?.role,
        sessionID: req.sessionID?.substring(0, 8) + '...',
        sessionKeys: Object.keys(req.session || {}),
        sessionUser: req.session?.user,
        cookies: req.headers.cookie?.substring(0, 50) + '...'
      });
      
      if (!req.session?.user || req.session.user.role !== 'admin') {
        console.log('Admin Access Denied - Grund:', {
          noSession: !req.session?.user,
          wrongRole: req.session?.user?.role !== 'admin',
          actualRole: req.session?.user?.role
        });
        return res.redirect('/login');
      }
      
      console.log('Admin Access Granted');
      res.sendFile(path.join(__dirname, 'views', 'admin.html'));
    });

// ---------------------- Granulare API-Sicherheit ----------------------
    
    // Admin-Authentifizierung
    const requireAdminAuth = (req, res, next) => {
      console.log('Admin Auth Check:', {
        path: req.path,
        method: req.method,
        hasUser: !!req.session?.user,
        userRole: req.session?.user?.role
      });

      if (!req.session?.user || req.session.user.role !== 'admin') {
        return res.status(401).json({ 
          success: false, 
          message: 'Authentifizierung erforderlich',
          requiresLogin: true
        });
      }
      next();
    };

    // ---------------------- ÖFFENTLICHE API-Routen (für Terminanfrage-Formular) ----------------------
    
    // Verfügbare Zeitslots abrufen - ÖFFENTLICH
    app.get('/outlook/available-slots', anfrageFormLimiter, (req, res, next) => {
      console.log('Öffentliche Zeitslot-Abfrage von:', req.ip);
      // Weiterleitung an Outlook-Route ohne Admin-Check
    });

    // Neue Terminanfrage erstellen - ÖFFENTLICH  
    app.post('/anfrage', anfrageFormLimiter, (req, res, next) => {
      console.log('Öffentliche Terminanfrage-Erstellung von:', req.ip);
      // Weiterleitung ohne Admin-Check
    });

    // ---------------------- GESCHÜTZTE API-Routen (nur für Admin) ----------------------
    
    // Alle Outlook-Routen AUSSER available-slots sind geschützt
    app.use('/outlook', (req, res, next) => {
      // Ausnahme: available-slots ist öffentlich
      if (req.path === '/available-slots' && req.method === 'GET') {
        console.log('Öffentlicher Zugriff auf available-slots erlaubt');
        return next();
      }
      
      // Alle anderen Outlook-Routen erfordern Admin-Auth
      console.log('Geschützter Outlook-Endpunkt:', req.path);
      return requireAdminAuth(req, res, next);
    }, adminApiLimiter, outlookRoutes);

    // Alle Anfrage-Routen AUSSER POST / sind geschützt
    app.use('/anfrage', (req, res, next) => {
      // Ausnahme: POST /anfrage ist öffentlich (neue Anfrage erstellen)
      if (req.path === '/' && req.method === 'POST') {
        console.log('Öffentliche Anfrage-Erstellung erlaubt');
        return next();
      }
      
      // Alle anderen Anfrage-Routen erfordern Admin-Auth
      console.log('Geschützter Anfrage-Endpunkt:', req.method, req.path);
      return requireAdminAuth(req, res, next);
    }, adminApiLimiter, anfrageRoutes);

    // Admin-Bereich
    app.get('/admin', (req, res) => {
      if (!req.session?.user || req.session.user.role !== 'admin') {
        return res.redirect('/login');
      }
      res.sendFile(path.join(__dirname, 'views', 'admin.html'));
    });

    // Hauptseite (öffentlich)
    app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'terminanfrage.html'));
    });
    // Health Check
    app.get('/health', (req, res) => res.status(200).json({ 
      status:'OK', 
      timestamp: new Date().toISOString() 
    }));

    // ---------------------- Error Handling ----------------------
    app.use((err, req, res, next) => {
      if (res.headersSent) return next(err);
      const errorId = crypto.randomBytes(16).toString('hex');
      console.error('❌ Server Error:', { errorId, message: err.message, stack: err.stack });
      
      // Bei JSON-Requests JSON-Antwort
      if (req.headers['content-type']?.includes('application/json') || req.path.startsWith('/api')) {
        return res.status(500).json({ success: false, message: 'Interner Server-Fehler', errorId });
      }
      
      res.status(500).send('Interner Server-Fehler');
    });

    app.use((req, res) => {
      if (!req.path.match(/\.(js|css|png|jpg|ico|map)$/)) {
        console.log('🔍 404 Not Found:', req.method, req.path);
        logSecurityEvent('404_NOT_FOUND', req);
      }
      
      if (req.headers['content-type']?.includes('application/json') || req.path.startsWith('/api')) {
        return res.status(404).json({ success:false, message:'Ressource nicht gefunden' });
      }
      
      res.status(404).send('Seite nicht gefunden');
    });

    // ---------------------- Server Start ----------------------
    server = app.listen(port, () => {
      console.log(`✅ Server läuft auf Port ${port}`);
      console.log(`🌐 Frontend: http://localhost:${port}`);
      console.log(`🔒 CSRF Protection: Aktiv`);
      console.log(`📊 Session Store: PostgreSQL`);
      console.log(`🛡️ CSP: Externe CDNs erlaubt für Admin`);
    });

  } catch (err) {
    console.error('❌ Fehler beim Start:', err);
    console.log('📄 Fallback auf Memory-Session...');
    
    app.use(createFallbackSession());

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

module.exports = app;

