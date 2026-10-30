require('dotenv').config();
const express = require('express');
const db = require('../../db/connection');
const { protectService } = require('../shared/security');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use(protectService);

app.get('/transkrip/:nim', (req, res) => {
  const { role, sub, tokenType } = req.auth;
  if (tokenType !== 'access' || !['mahasiswa', 'admin'].includes(role)) {
    return res.status(403).json({ error: 'Role tidak diizinkan melihat transkrip' });
  }
  if (role === 'mahasiswa') {
    const user = db.prepare('SELECT nim FROM users WHERE id = ?').get(Number(sub));
    if (!user || user.nim !== req.params.nim) return res.status(403).json({ error: 'Mahasiswa hanya dapat melihat transkrip miliknya' });
  }
  const student = db.prepare('SELECT id, nim, display_name FROM users WHERE nim = ? AND role = ?').get(req.params.nim, 'mahasiswa');
  if (!student) return res.status(404).json({ error: 'Mahasiswa tidak ditemukan' });
  const rows = db.prepare(`SELECT c.code AS courseCode, c.name AS courseName, t.score, t.synced_at AS syncedAt
    FROM transcripts t JOIN courses c ON c.id = t.course_id
    WHERE t.student_id = ? ORDER BY c.code`).all(student.id);
  return res.json({ student: { nim: student.nim, name: student.display_name }, data: rows });
});

app.post('/transkrip/sinkron', (req, res) => {
  if (req.auth.tokenType !== 'service' || req.auth.role !== 'service' || req.auth.sub !== (process.env.SERVICE_CLIENT_ID || 'nilai-service')) {
    return res.status(403).json({ error: 'Hanya token Service Nilai yang dapat menyinkronkan transkrip' });
  }
  const courseId = Number(req.body?.courseId);
  if (!Number.isInteger(courseId)) return res.status(400).json({ error: 'courseId wajib berupa bilangan bulat' });
  const course = db.prepare('SELECT id, code FROM courses WHERE id = ?').get(courseId);
  if (!course) return res.status(404).json({ error: 'Kelas tidak ditemukan' });
  const grades = db.prepare(`SELECT student_id, score FROM grades
    WHERE course_id = ? AND is_final = 1 AND score IS NOT NULL`).all(courseId);
  if (!grades.length) return res.status(409).json({ error: 'Belum ada nilai final untuk disinkronkan' });

  const upsert = db.prepare(`INSERT INTO transcripts (student_id, course_id, score, synced_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(student_id, course_id) DO UPDATE SET score = excluded.score, synced_at = excluded.synced_at`);
  const syncAll = db.transaction ? db.transaction(() => grades.forEach(row => upsert.run(row.student_id, courseId, row.score))) : null;
  if (syncAll) syncAll();
  else {
    db.exec('BEGIN IMMEDIATE');
    try {
      grades.forEach(row => upsert.run(row.student_id, courseId, row.score));
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  return res.json({ message: 'Transkrip disinkronkan', course: course.code, count: grades.length });
});

app.use((err, req, res, next) => {
  console.error('Service Transkrip error:', err.message);
  res.status(500).json({ error: 'Terjadi kesalahan internal pada Service Transkrip' });
});

const port = Number(process.env.TRANSKRIP_PORT || 3002);
app.listen(port, () => console.log(`Service Transkrip aktif di http://localhost:${port}`));
