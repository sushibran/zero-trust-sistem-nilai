require('dotenv').config();
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(path.resolve(process.env.DB_PATH || './data/zero-trust.db'));
db.exec('PRAGMA foreign_keys = ON');

module.exports = db;
