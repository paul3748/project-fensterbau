// debug-local-files.js - Direkt im Projekt-Root ausführen
require('dotenv').config();

console.log('🔍 DEBUG: Teste lokale Dateien (aus Projekt-Root)...\n');
console.log('📁 Working Directory:', process.cwd());

// Test 1: Models/Sequelize
console.log('=== TEST 1: Models/Sequelize ===');
try {
  console.log('🔍 Lade ./models...');
  const models = require('./models');
  console.log('✅ Models erfolgreich geladen');
} catch (error) {
  console.error('❌ FEHLER in Models:', error.message);
  if (error.message.includes('path-to-regexp')) {
    console.error('🚨 PATH-TO-REGEXP FEHLER GEFUNDEN IN MODELS!');
  }
}

console.log('\n=== TEST 2: Utils/Logger ===');
try {
  console.log('🔍 Lade ./utils/logger...');
  const logger = require('./utils/logger');
  console.log('✅ Logger erfolgreich geladen');
} catch (error) {
  console.error('❌ FEHLER in Logger:', error.message);
  if (error.message.includes('path-to-regexp')) {
    console.error('🚨 PATH-TO-REGEXP FEHLER GEFUNDEN IN LOGGER!');
  }
}

console.log('\n=== TEST 3: Middleware/Security ===');
try {
  console.log('🔍 Lade ./middleware/security...');
  const security = require('./middleware/security');
  console.log('✅ Security Middleware erfolgreich geladen');
} catch (error) {
  console.error('❌ FEHLER in Security Middleware:', error.message);
  if (error.message.includes('path-to-regexp')) {
    console.error('🚨 PATH-TO-REGEXP FEHLER GEFUNDEN IN SECURITY!');
  }
}

console.log('\n=== TEST 4: Middleware/RouteSecurity ===');
try {
  console.log('🔍 Lade ./middleware/routeSecurity...');
  const routeSecurity = require('./middleware/routeSecurity');
  console.log('✅ Route Security erfolgreich geladen');
} catch (error) {
  console.error('❌ FEHLER in Route Security:', error.message);
  if (error.message.includes('path-to-regexp')) {
    console.error('🚨 PATH-TO-REGEXP FEHLER GEFUNDEN IN ROUTE-SECURITY!');
  }
}

console.log('\n=== TEST 5: Config/Session ===');
try {
  console.log('🔍 Lade ./config/session...');
  const session = require('./config/session');
  console.log('✅ Session Config erfolgreich geladen');
} catch (error) {
  console.error('❌ FEHLER in Session Config:', error.message);
  if (error.message.includes('path-to-regexp')) {
    console.error('🚨 PATH-TO-REGEXP FEHLER GEFUNDEN IN SESSION-CONFIG!');
  }
}

console.log('\n=== TEST 6: Sequelize initialisieren ===');
try {
  console.log('🔍 Teste Sequelize-Initialisierung...');
  const { sequelize, syncDatabase } = require('./models');
  console.log('✅ Sequelize-Import erfolgreich');
  
  console.log('🔍 Teste sequelize.authenticate()...');
  // Nicht warten, nur testen ob es ohne Fehler startet
  sequelize.authenticate().then(() => {
    console.log('✅ Sequelize-Authentifizierung erfolgreich');
  }).catch(err => {
    console.log('⚠️ Sequelize-Authentifizierung fehlgeschlagen (DB-Problem, nicht path-to-regexp):', err.message);
  });
} catch (error) {
  console.error('❌ FEHLER bei Sequelize-Initialisierung:', error.message);
  if (error.message.includes('path-to-regexp')) {
    console.error('🚨 PATH-TO-REGEXP FEHLER GEFUNDEN BEI SEQUELIZE-INIT!');
  }
}

console.log('\n=== TEST 7: Session Store Setup ===');
try {
  console.log('🔍 Teste Session Store Setup...');
  const { setupSessionStore, createSessionMiddleware, createFallbackSession } = require('./config/session');
  console.log('✅ Session Store Funktionen geladen');
  
  // Test createFallbackSession (sollte sicher sein)
  console.log('🔍 Teste createFallbackSession...');
  const fallbackSession = createFallbackSession();
  console.log('✅ createFallbackSession erfolgreich');
  
} catch (error) {
  console.error('❌ FEHLER im Session Store Setup:', error.message);
  if (error.message.includes('path-to-regexp')) {
    console.error('🚨 PATH-TO-REGEXP FEHLER GEFUNDEN IN SESSION-STORE!');
  }
}

// TEST EXPRESS-ROUTER DIREKT
console.log('\n=== TEST 8: Express Router Test ===');
try {
  console.log('🔍 Teste Express Router direkt...');
  const express = require('express');
  const router = express.Router();
  
  console.log('🔍 Teste problematische Route-Patterns...');
  
  // Test 1: Normale Route
  router.get('/test', (req, res) => res.send('test'));
  console.log('✅ Normale Route OK');
  
  // Test 2: Route mit Parameter
  router.get('/test/:id', (req, res) => res.send('test'));
  console.log('✅ Parameter-Route OK');
  
  // Test 3: Wildcard (das könnte problematisch sein)
  try {
    router.get('/test/*', (req, res) => res.send('test'));
    console.log('✅ Wildcard-Route OK');
  } catch (err) {
    console.error('❌ Wildcard-Route Fehler:', err.message);
    if (err.message.includes('path-to-regexp')) {
      console.error('🚨 WILDCARD-ROUTES SIND DAS PROBLEM!');
    }
  }
  
} catch (error) {
  console.error('❌ Express Router Test Fehler:', error.message);
  if (error.message.includes('path-to-regexp')) {
    console.error('🚨 PATH-TO-REGEXP FEHLER IN EXPRESS ROUTER!');
  }
}

console.log('\n🔍 Lokale Dateien-Tests abgeschlossen.');

// Gib dem System Zeit für async Operationen
setTimeout(() => {
  console.log('\n✅ Debug-Test beendet - alle async Operationen sollten abgeschlossen sein.');
}, 2000);