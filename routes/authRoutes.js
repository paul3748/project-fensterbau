const express = require('express');
const path = require('path');
const csrf = require('csurf');
const router = express.Router();
const { login, checkLogin, logout } = require('../controllers/authController');

const csrfProtection = csrf({ cookie: false });

// Login-Seite anzeigen
router.get('/login', csrfProtection, (req, res) => {
  res.sendFile(path.join(__dirname, '../views/login.html'));
});

// Login-Verarbeitung mit CSRF-Schutz
router.post('/login', csrfProtection, login);

// Geschützte Admin-Seite
router.get('/admin', checkLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '../views/admin.html'));
});

// Logout
router.post('/logout', logout);

module.exports = router;