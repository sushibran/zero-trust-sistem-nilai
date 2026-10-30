const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();
const { DatabaseSync } = require('node:sqlite');

const dbPath = path.resolve(process.env.DB_PATH || './data/zero-trust.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
db.close();
console.log(`Database siap: ${dbPath}`);
