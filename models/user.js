// models/User.js
const { DataTypes } = require('sequelize');
const bcrypt = require('bcrypt');
const { sequelize } = require('../config/database');

const User = sequelize.define('User', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  username: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false
  },
  role: {
    type: DataTypes.STRING,
    defaultValue: 'user'
  }
}, {
  tableName: 'users', // EXPLIZIT auf bestehende Tabelle verweisen
  timestamps: true,
  hooks: {
    beforeCreate: async (user) => {
      if (user.password) {
        const salt = await bcrypt.genSalt(process.env.BCRYPT_ROUNDS);
        user.password = await bcrypt.hash(user.password, salt);
      }
    },
    beforeUpdate: async (user) => {
      if (user.changed('password')) {
        const salt = await bcrypt.genSalt(process.env.BCRYPT_ROUNDS);
        user.password = await bcrypt.hash(user.password, salt);
      }
    }
  }
});

// Methode zum Passwort-Vergleich
User.prototype.validatePassword = function(inputPassword) {
  return bcrypt.compare(inputPassword, this.password);
};

module.exports = User;