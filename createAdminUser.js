require('dotenv').config();
const { sequelize } = require('./models');
const User = require('./models/user');
const bcrypt = require('bcrypt');

async function createAdminUser() {
  try {
    await sequelize.authenticate();
    console.log('✅ Datenbank verbunden');
    
    // Prüfe ob Admin-User bereits existiert
    const existingAdmin = await User.findOne({ where: { username: 'admin' } });
    
    if (existingAdmin) {
      console.log('✅ Admin-User existiert bereits:', existingAdmin.username);
      return;
    }
    
    // Erstelle Admin-User
    const password = 'dirwo0-Wycwof-borzoj';
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    const adminUser = await User.create({
      username: 'admin',
      password: hashedPassword,
      role: 'admin'
    });
    
    console.log('✅ Admin-User erstellt:', adminUser.username);
    console.log('🔑 Passwort:', password);
    
  } catch (error) {
    console.error('❌ Fehler beim Erstellen des Admin-Users:', error.message);
  } finally {
    await sequelize.close();
  }
}

createAdminUser();
