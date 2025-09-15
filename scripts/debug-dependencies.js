// debug-dependencies.js - Teste Abhängigkeiten einzeln
require('dotenv').config();

console.log('🔍 DEBUG: Teste Abhängigkeiten einzeln...\n');

// Test 1: Models/Sequelize
console.log('=== TEST 1: Models/Sequelize ===');
try {
  console.log('🔍 Lade ./models...');
  const models = require('./models');
  console.log('✅ Models erfolgreich geladen');
  console.log('🔍 Teste Sequelize...');
  if (models.sequelize) {
    console.log('✅ Sequelize-Instanz gefunden');
  }
} catch (error) {
  console.error('❌ FEHLER in Models:', error.message);
  console.error('Stack:', error.stack);
}

console.log('\n=== TEST 2: Utils/Logger ===');
try {
  console.log('🔍 Lade ./utils/logger...');
  const logger = require('./utils/logger');
  console.log('✅ Logger erfolgreich geladen');
} catch (error) {
  console.error('❌ FEHLER in Logger:', error.message);
  console.error('Stack:', error.stack);
}

console.log('\n=== TEST 3: Middleware/Security ===');
try {
  console.log('🔍 Lade ./middleware/security...');
  const security = require('./middleware/security');
  console.log('✅ Security Middleware erfolgreich geladen');
  console.log('🔍 Teste createAdvancedRateLimit...');
  if (typeof security.createAdvancedRateLimit === 'function') {
    console.log('✅ createAdvancedRateLimit-Funktion gefunden');
  }
} catch (error) {
  console.error('❌ FEHLER in Security Middleware:', error.message);
  console.error('Stack:', error.stack);
}

console.log('\n=== TEST 4: Middleware/RouteSecurity ===');
try {
  console.log('🔍 Lade ./middleware/routeSecurity...');
  const routeSecurity = require('./middleware/routeSecurity');
  console.log('✅ Route Security erfolgreich geladen');
} catch (error) {
  console.error('❌ FEHLER in Route Security:', error.message);
  console.error('Stack:', error.stack);
}

console.log('\n=== TEST 5: Config/Session ===');
try {
  console.log('🔍 Lade ./config/session...');
  const session = require('./config/session');
  console.log('✅ Session Config erfolgreich geladen');
  console.log('🔍 Teste Session-Funktionen...');
  if (typeof session.setupSessionStore === 'function') {
    console.log('✅ setupSessionStore-Funktion gefunden');
  }
  if (typeof session.createFallbackSession === 'function') {
    console.log('✅ createFallbackSession-Funktion gefunden');
  }
} catch (error) {
  console.error('❌ FEHLER in Session Config:', error.message);
  console.error('Stack:', error.stack);
}

console.log('\n=== TEST 6: Express-Rate-Limit (npm-Package) ===');
try {
  console.log('🔍 Lade express-rate-limit...');
  const rateLimit = require('express-rate-limit');
  console.log('✅ express-rate-limit erfolgreich geladen');
  
  console.log('🔍 Teste Rate-Limit-Erstellung...');
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
  });
  console.log('✅ Rate Limiter erfolgreich erstellt');
} catch (error) {
  console.error('❌ FEHLER in express-rate-limit:', error.message);
  console.error('Stack:', error.stack);
}

console.log('\n=== TEST 7: Helmet ===');
try {
  console.log('🔍 Lade helmet...');
  const helmet = require('helmet');
  console.log('✅ Helmet erfolgreich geladen');
} catch (error) {
  console.error('❌ FEHLER in Helmet:', error.message);
  console.error('Stack:', error.stack);
}

console.log('\n=== TEST 8: Express-Session ===');
try {
  console.log('🔍 Lade express-session...');
  const expressSession = require('express-session');
  console.log('✅ express-session erfolgreich geladen');
} catch (error) {
  console.error('❌ FEHLER in express-session:', error.message);
  console.error('Stack:', error.stack);
}

console.log('\n=== TEST 9: Connect-Session-Sequelize ===');
try {
  console.log('🔍 Lade connect-session-sequelize...');
  const SequelizeStore = require('connect-session-sequelize');
  console.log('✅ connect-session-sequelize erfolgreich geladen');
} catch (error) {
  console.error('❌ FEHLER in connect-session-sequelize:', error.message);
  console.error('Stack:', error.stack);
}

console.log('\n=== TEST 10: CSURF (könnte problematisch sein) ===');
try {
  console.log('🔍 Lade csurf...');
  const csrf = require('csurf');
  console.log('✅ csurf erfolgreich geladen');
  
  console.log('🔍 Teste CSRF-Middleware-Erstellung...');
  const csrfMiddleware = csrf({ cookie: false });
  console.log('✅ CSRF Middleware erfolgreich erstellt');
} catch (error) {
  console.error('❌ FEHLER in CSURF - HIER KÖNNTE DAS PROBLEM LIEGEN:', error.message);
  console.error('Stack:', error.stack);
}

console.log('\n🔍 Dependency-Tests abgeschlossen.');