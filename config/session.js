const session = require('express-session');
const SequelizeStore = require('connect-session-sequelize')(session.Store);
const crypto = require('crypto');

async function setupSessionStore(sequelize) {
    try {
        const sessionStore = new SequelizeStore({
            db: sequelize,
            tableName: 'sessions',
            expiration: 24 * 60 * 60 * 1000, // 1 Tag
            checkExpirationInterval: 15 * 60 * 1000,
            // WICHTIG: Immer JSON korrekt serialisieren
            serialize: (session) => JSON.stringify(session),
            unserialize: (data) => {
                try {
                    return JSON.parse(data);
                } catch (e) {
                    console.error("⚠️ Fehler beim Parsen der Session:", e);
                    return {};
                }
            }
        });

        console.log('Synchronisiere Sessions-Tabelle...');
        await sessionStore.sync({ force: false });
        console.log('Sessions-Tabelle synchronisiert');

        return sessionStore;
    } catch (error) {
        console.error('Session Store Fehler:', error.message);
        throw error;
    }
}

function createSessionMiddleware(store) {
    return session({
        secret: process.env.SESSION_SECRET || 'fallback-secret-nur-development',
        store,
        name: 'sid',
        resave: false,
        saveUninitialized: false,
        rolling: true,
        genid: () => crypto.randomBytes(32).toString('hex'),
        cookie: {
            maxAge: 2 * 60 * 60 * 1000,
            secure: false,
            httpOnly: true,
            sameSite: 'lax'
        }
    });
}

module.exports = { setupSessionStore, createSessionMiddleware };
