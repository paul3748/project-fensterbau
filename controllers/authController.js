// controllers/authController.js (angepasste Version mit korrekter Session-Behandlung)
const User = require('../models/user');
const { logLoginAttempt, logSecurityEvent } = require('../utils/logger');

// Brute Force Protection
const loginAttempts = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of loginAttempts) {
    if (now - data.lastAttempt > 15 * 60 * 1000) {
      loginAttempts.delete(key);
    }
  }
}, 10 * 60 * 1000);

// Login-Controller
const login = async (req, res) => {
  const { username, password } = req.body;
  const clientIP = req.ip;
  const userAgent = req.get('User-Agent');

  console.log('🔐 Login Versuch:', { 
    username, 
    sessionID: req.sessionID?.substring(0, 8) + '...',
    hasSession: !!req.session,
    sessionKeys: Object.keys(req.session || {})
  });

  try {
    // CSRF Token prüfen
    if (!req.session?.csrfToken || req.body._csrf !== req.session.csrfToken) {
      return res.status(403).json({
        success: false,
        message: 'CSRF-Token fehlt oder ist ungültig',
        code: 'CSRF_MISSING'
      });
    }

    // Brute Force Check
    const attemptKey = `${clientIP}_${username}`;
    const attempts = loginAttempts.get(attemptKey);
    if (attempts && attempts.count >= 5) {
      const timeSinceLastAttempt = Date.now() - attempts.lastAttempt;
      const lockoutTime = Math.min(attempts.count * 2 * 60 * 1000, 30 * 60 * 1000);
      if (timeSinceLastAttempt < lockoutTime) {
        logSecurityEvent('ACCOUNT_LOCKOUT', req, {
          username,
          attempts: attempts.count,
          lockoutTimeRemaining: Math.ceil((lockoutTime - timeSinceLastAttempt) / 1000)
        });
        return res.status(429).json({
          success: false,
          message: `Account temporär gesperrt. Versuchen Sie es in ${Math.ceil((lockoutTime - timeSinceLastAttempt) / 60000)} Minuten erneut.`
        });
      }
    }

    // User aus DB holen
    const user = await User.findOne({ where: { username } });
    if (!user) {
      recordFailedAttempt(attemptKey);
      logLoginAttempt(req, false, username);
      await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 100));
      return res.status(401).json({ success: false, message: 'Ungültige Anmeldedaten' });
    }

    // Passwort prüfen
    const isValid = await user.validatePassword(password);
    if (!isValid) {
      recordFailedAttempt(attemptKey);
      logLoginAttempt(req, false, username);
      return res.status(401).json({ success: false, message: 'Ungültige Anmeldedaten' });
    }

    // Erfolgreich eingeloggt → Versuche zurücksetzen
    loginAttempts.delete(attemptKey);

    // WICHTIG: Session-Daten ZUERST setzen, dann regenerieren
    req.session.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      loginTime: new Date(),
      ip: clientIP
    };
    req.session.userAgent = userAgent;
    req.session.loginIP = clientIP;

    console.log('✅ User-Daten in Session gesetzt:', {
      userId: req.session.user.id,
      username: req.session.user.username,
      role: req.session.user.role,
      sessionID: req.sessionID?.substring(0, 8) + '...'
    });

    // Session explizit speichern vor Response
    req.session.save((err) => {
      if (err) {
        console.error('❌ Fehler beim Speichern der Session:', err);
        return res.status(500).json({ success: false, message: 'Session-Fehler beim Login' });
      }

      console.log('✅ Session erfolgreich gespeichert:', {
        sessionID: req.sessionID?.substring(0, 8) + '...',
        hasUser: !!req.session.user,
        userRole: req.session.user?.role
      });

      logLoginAttempt(req, true, username);

      // Antwort senden
      res.json({ 
        success: true, 
        redirect: '/admin', 
        message: 'Login erfolgreich',
        sessionID: req.sessionID?.substring(0, 8) + '...' // Debug
      });
    });

  } catch (error) {
    console.error('❌ Login error:', error);
    logSecurityEvent('LOGIN_ERROR', req, { username, error: error.message });
    res.status(500).json({ success: false, message: 'Anmeldung fehlgeschlagen' });
  }
};

// Fehlgeschlagene Logins protokollieren
const recordFailedAttempt = (attemptKey) => {
  const now = Date.now();
  const current = loginAttempts.get(attemptKey);
  if (current) {
    loginAttempts.set(attemptKey, {
      count: current.count + 1,
      lastAttempt: now,
      firstAttempt: current.firstAttempt
    });
  } else {
    loginAttempts.set(attemptKey, { count: 1, lastAttempt: now, firstAttempt: now });
  }
};

// Check Login
const checkLogin = (req, res, next) => {
  console.log('🔍 CheckLogin Middleware:', {
    hasSession: !!req.session,
    hasUser: !!req.session?.user,
    sessionID: req.sessionID?.substring(0, 8) + '...',
    userRole: req.session?.user?.role
  });

  if (!req.session?.user) {
    logSecurityEvent('UNAUTHORIZED_ACCESS_ATTEMPT', req);
    return res.status(401).json({ success: false, message: 'Nicht autorisiert' });
  }

  // Session Timeout prüfen
  const sessionAge = Date.now() - new Date(req.session.user.loginTime).getTime();
  const maxSessionAge = 2 * 60 * 60 * 1000; // 2 Stunden
  if (sessionAge > maxSessionAge) {
    req.session.destroy();
    logSecurityEvent('SESSION_EXPIRED', req, { userId: req.session.user.id, sessionAge });
    return res.status(401).json({ success: false, message: 'Session abgelaufen' });
  }

  // Optional: IP-Wechsel prüfen
  if (process.env.CHECK_IP_CONSISTENCY === 'true' && req.session.loginIP && req.session.loginIP !== req.ip) {
    req.session.destroy();
    logSecurityEvent('IP_CHANGE_DETECTED', req, { originalIP: req.session.loginIP, newIP: req.ip });
    return res.status(401).json({ success: false, message: 'Sicherheitskonflikt erkannt' });
  }

  next();
};

const logout = (req, res) => {
  const userId = req.session?.user?.id;
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ success: false, message: 'Abmeldung fehlgeschlagen' });
    }
    logSecurityEvent('LOGOUT', req, { userId });
    res.json({ success: true, message: 'Erfolgreich abgemeldet' });
  });
};

module.exports = { login, checkLogin, logout };