const db = require('../db/connection');

function currentMinutes() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: process.env.TIMEZONE || 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date());
  const hour = Number(parts.find(part => part.type === 'hour').value);
  const minute = Number(parts.find(part => part.type === 'minute').value);
  return hour * 60 + minute;
}

function parseClock(value, fallback) {
  const match = /^(\d{2}):(\d{2})$/.exec(value || fallback);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw new Error(`Format jam tidak valid: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function isWithinAccessHours() {
  const now = currentMinutes();
  const start = parseClock(process.env.ACCESS_START, '07:00');
  const end = parseClock(process.env.ACCESS_END, '21:00');
  return start <= end ? now >= start && now <= end : now >= start || now <= end;
}

function decide(claims, method, pathname) {
  const role = claims.role;
  const subjectId = Number(claims.sub);

  if (method === 'GET' && pathname === '/nilai') {
    if (role === 'mahasiswa') {
      const rows = db.prepare('SELECT id FROM grades WHERE student_id = ?').all(subjectId);
      return { allow: true, reason: 'Cakupan nilai mahasiswa dihitung dari relasi kepemilikan di database', gradeIds: rows.map(row => row.id) };
    }
    if (role === 'dosen') {
      const rows = db.prepare('SELECT g.id FROM grades g JOIN courses c ON c.id = g.course_id WHERE c.lecturer_id = ?').all(subjectId);
      return { allow: true, reason: 'Cakupan nilai dosen dihitung dari kelas ampuan di database', gradeIds: rows.map(row => row.id) };
    }
    return { allow: false, reason: 'Role tidak diizinkan melihat nilai' };
  }

  let match = /^\/nilai\/(\d+)$/.exec(pathname);
  if (method === 'PUT' && match) {
    if (role !== 'dosen') return { allow: false, reason: 'Hanya dosen dapat mengubah nilai' };
    const grade = db.prepare(`SELECT g.is_final, c.lecturer_id FROM grades g JOIN courses c ON c.id = g.course_id WHERE g.id = ?`).get(Number(match[1]));
    if (!grade) return { allow: false, reason: 'Nilai tidak ditemukan' };
    if (grade.lecturer_id !== subjectId) return { allow: false, reason: 'Dosen bukan pengampu kelas nilai ini' };
    if (grade.is_final) return { allow: false, reason: 'Nilai sudah difinalisasi' };
    if (!isWithinAccessHours()) return { allow: false, reason: 'Di luar jam akses perubahan nilai' };
    return { allow: true, reason: 'Dosen pengampu, nilai belum final, dan dalam jam akses' };
  }

  match = /^\/kelas\/(\d+)\/finalisasi$/.exec(pathname);
  if (method === 'POST' && match) {
    if (role !== 'dosen') return { allow: false, reason: 'Hanya dosen dapat memfinalisasi nilai' };
    const course = db.prepare('SELECT lecturer_id FROM courses WHERE id = ?').get(Number(match[1]));
    if (!course) return { allow: false, reason: 'Kelas tidak ditemukan' };
    if (course.lecturer_id !== subjectId) return { allow: false, reason: 'Dosen bukan pengampu kelas ini' };
    if (!isWithinAccessHours()) return { allow: false, reason: 'Di luar jam akses finalisasi nilai' };
    return { allow: true, reason: 'Dosen pengampu dan dalam jam akses' };
  }

  match = /^\/transkrip\/([^/]+)$/.exec(pathname);
  if (method === 'GET' && match) {
    const nim = decodeURIComponent(match[1]);
    if (role === 'mahasiswa') {
      const user = db.prepare('SELECT nim FROM users WHERE id = ?').get(subjectId);
      if (user?.nim !== nim) return { allow: false, reason: 'Mahasiswa hanya dapat melihat transkrip miliknya' };
      return { allow: true, reason: 'NIM sesuai dengan pemilik token' };
    }
    if (role === 'admin') return { allow: true, reason: 'Admin dapat melihat semua transkrip' };
    return { allow: false, reason: 'Role dosen tidak diizinkan melihat transkrip' };
  }

  if (method === 'POST' && pathname === '/transkrip/sinkron') {
    return { allow: false, reason: 'Endpoint sinkronisasi khusus token service' };
  }

  return { allow: false, reason: 'Endpoint atau metode tidak terdaftar dalam kebijakan' };
}

module.exports = { decide, isWithinAccessHours };
