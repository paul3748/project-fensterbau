// routes/authRoutes.js - FIXED VERSION
const express = require('express');
const path = require('path');
const router = express.Router();
const { login, checkLogin, logout } = require('../controllers/authController');
const { csrfProtection } = require('../middleware/security');

// Login-Seite anzeigen (ÖFFENTLICH)
router.get('/login', (req, res) => {
  console.log('🔑 Login-Seite aufgerufen:', {
    ip: req.ip,
    hasSession: !!req.session,
    isAuthenticated: !!req.session?.user
  });
  
  // Wenn bereits eingeloggt, zum Admin weiterleiten
  if (req.session?.user?.role === 'admin') {
    console.log('↪️ Bereits eingeloggt - Weiterleitung zu Admin');
    return res.redirect('/admin');
  }
  
  res.sendFile(path.join(__dirname, '../views/login.html'));
});

// Login-Verarbeitung mit CSRF-Schutz (ÖFFENTLICH)
router.post('/login', csrfProtection, async (req, res) => {
  try {
    console.log('🔐 Login-Versuch:', {
      username: req.body.username,
      ip: req.ip,
      userAgent: req.headers['user-agent']?.substring(0, 50) + '...',
      hasCSRF: !!req.headers['x-csrf-token'] || !!req.body._csrf
    });
    
    await login(req, res);
    
  } catch (error) {
    console.error('❌ Login-Route Fehler:', error);
    res.status(500).json({
      success: false,
      message: 'Login-Fehler aufgetreten'
    });
  }
});

// Geschützte Admin-Seite (wird automatisch durch routeSecurityMiddleware geschützt)
router.get('/admin', (req, res) => {
  // Sicherheitsprüfung erfolgt bereits durch routeSecurityMiddleware
  console.log('📊 Admin-Dashboard Zugriff:', {
    userId: req.session.user.id,
    username: req.session.user.username,
    ip: req.ip
  });
  
  res.sendFile(path.join(__dirname, '../views/admin.html'));
});

// Logout (ÖFFENTLICH)
router.post('/logout', (req, res) => {
  try {
    console.log('👋 Logout:', {
      userId: req.session?.user?.id,
      username: req.session?.user?.username,
      ip: req.ip
    });
    
    logout(req, res);
    
  } catch (error) {
    console.error('❌ Logout-Fehler:', error);
    res.status(500).json({
      success: false,
      message: 'Logout-Fehler aufgetreten'
    });
  }
});

module.exports = router;