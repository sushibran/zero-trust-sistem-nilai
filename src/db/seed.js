require('dotenv').config();
const bcrypt = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const db = new DatabaseSync(path.resolve(process.env.DB_PATH || './data/zero-trust.db'));
db.exec('PRAGMA foreign_keys = ON');

const users = [
  ['admin', 'Administrator', 'admin', 'admin123', null],
  ['dosen1', 'Dosen Satu', 'dosen', 'dosen123', null],
  ['dosen2', 'Dosen Dua', 'dosen', 'dosen123', null],
  ['mhs1', 'Mahasiswa Satu', 'mahasiswa', 'mhs123', '227006001'],
  ['mhs2', 'Mahasiswa Dua', 'mahasiswa', 'mhs123', '227006002'],
  ['mhs3', 'Mahasiswa Tiga', 'mahasiswa', 'mhs123', '227006003']
];

const seed = () => {
  db.exec('BEGIN');
  try {
  const addUser = db.prepare(`INSERT OR IGNORE INTO users (username, display_name, role, password_hash, nim)
    VALUES (?, ?, ?, ?, ?)`);
  const findUser = db.prepare('SELECT id FROM users WHERE username = ?');
  const addDevice = db.prepare('INSERT OR IGNORE INTO devices (user_id, device_id, label) VALUES (?, ?, ?)');

  for (const [username, displayName, role, password, nim] of users) {
    addUser.run(username, displayName, role, bcrypt.hashSync(password, 10), nim);
    addDevice.run(findUser.get(username).id, `device-${username}`, `Perangkat demo ${username}`);
  }

  const lecturer1 = findUser.get('dosen1').id;
  const lecturer2 = findUser.get('dosen2').id;
  const addCourse = db.prepare('INSERT OR IGNORE INTO courses (code, name, lecturer_id) VALUES (?, ?, ?)');
  addCourse.run('IF101', 'Pengantar Informatika', lecturer1);
  addCourse.run('IF202', 'Keamanan Informasi', lecturer2);
  const course1 = db.prepare('SELECT id FROM courses WHERE code = ?').get('IF101').id;
  const course2 = db.prepare('SELECT id FROM courses WHERE code = ?').get('IF202').id;
  const studentIds = ['mhs1', 'mhs2', 'mhs3'].map(name => findUser.get(name).id);
  const enroll = db.prepare('INSERT OR IGNORE INTO enrollments (course_id, student_id) VALUES (?, ?)');
  const addGrade = db.prepare('INSERT OR IGNORE INTO grades (course_id, student_id, score) VALUES (?, ?, ?)');
  studentIds.forEach((studentId, i) => {
    enroll.run(course1, studentId);
    enroll.run(course2, studentId);
    addGrade.run(course1, studentId, 80 + i);
    addGrade.run(course2, studentId, 85 + i);
  });

  db.prepare(`INSERT INTO service_clients (client_id, secret_hash, role) VALUES (?, ?, ?)
    ON CONFLICT(client_id) DO UPDATE SET secret_hash = excluded.secret_hash, active = 1`)
    .run('nilai-service', bcrypt.hashSync(process.env.SERVICE_CLIENT_SECRET || 'nilai-service-demo-secret', 10), 'service');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
};

seed();
db.close();
console.log('Seed data selesai. Kredensial demo dicantumkan di README akhir.');
