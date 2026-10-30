require('dotenv').config();
const express = require('express');
const db = require('../../db/connection');
const { protectService } = require('../shared/security');
const { isWithinAccessHours } = require('../shared/hours');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use(protectService);

app.get('/nilai', (req, res) => {
  const { role, sub } = req.auth;
  if (req.auth.tokenType !== 'access' || !['mahasiswa', 'dosen'].includes(role)) {
    return res.status(403).json({ error: 'Role tidak diizinkan melihat nilai' });
  }
  const rows = role === 'mahasiswa'
    ? db.prepare(`SELECT g.id, c.id AS courseId, c.code AS courseCode, c.name AS courseName,
        u.nim, u.display_name AS studentName, g.score, g.is_final AS isFinal, g.updated_at AS updatedAt
      FROM grades g JOIN courses c ON c.id = g.course_id JOIN users u ON u.id = g.student_id
      WHERE g.student_id = ? ORDER BY c.code`).all(Number(sub))
    : db.prepare(`SELECT g.id, c.id AS courseId, c.code AS courseCode, c.name AS courseName,
        u.nim, u.display_name AS studentName, g.score, g.is_final AS isFinal, g.updated_at AS updatedAt
      FROM grades g JOIN courses c ON c.id = g.course_id JOIN users u ON u.id = g.student_id
      WHERE c.lecturer_id = ? ORDER BY c.code, u.nim`).all(Number(sub));
  return res.json({ data: rows });
});

app.put('/nilai/:id', (req, res) => {
  if (req.auth.tokenType !== 'access' || req.auth.role !== 'dosen') {
    return res.status(403).json({ error: 'Hanya dosen dapat mengubah nilai' });
  }
  if (!isWithinAccessHours()) return res.status(403).json({ error: 'Di luar jam akses perubahan nilai' });
  const id = Number(req.params.id);
  const score = req.body?.score;
  if (!Number.isInteger(id) || !Number.isFinite(score) || score < 0 || score > 100) {
    return res.status(400).json({ error: 'ID nilai atau score tidak valid (score 0–100)' });
  }
  const row = db.prepare(`SELECT g.id, g.is_final, c.lecturer_id FROM grades g
    JOIN courses c ON c.id = g.course_id WHERE g.id = ?`).get(id);
  if (!row) return res.status(404).json({ error: 'Nilai tidak ditemukan' });
  if (row.lecturer_id !== Number(req.auth.sub)) return res.status(403).json({ error: 'Dosen bukan pengampu kelas nilai ini' });
  if (row.is_final) return res.status(409).json({ error: 'Nilai sudah final dan tidak dapat diubah' });
  db.prepare(`UPDATE grades SET score = ?, updated_at = datetime('now') WHERE id = ? AND is_final = 0`).run(score, id);
  return res.json({ message: 'Nilai berhasil diperbarui', id, score });
});

async function synchronizeTranscript(courseId) {
  const base = process.env.GATEWAY_URL || 'http://localhost:3000';
  const tokenResponse = await fetch(new URL('/auth/service', base), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: process.env.SERVICE_CLIENT_ID || 'nilai-service',
      clientSecret: process.env.SERVICE_CLIENT_SECRET || 'nilai-service-demo-secret'
    })
  });
  if (!tokenResponse.ok) throw new Error(`Penerbitan token service gagal (${tokenResponse.status})`);
  const { accessToken } = await tokenResponse.json();
  const syncResponse = await fetch(new URL('/transkrip/sinkron', base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ courseId })
  });
  if (!syncResponse.ok) throw new Error(`Sinkronisasi ditolak (${syncResponse.status})`);
  return syncResponse.json();
}

app.post('/kelas/:id/finalisasi', async (req, res) => {
  if (req.auth.tokenType !== 'access' || req.auth.role !== 'dosen') {
    return res.status(403).json({ error: 'Hanya dosen dapat memfinalisasi nilai' });
  }
  if (!isWithinAccessHours()) return res.status(403).json({ error: 'Di luar jam akses finalisasi nilai' });
  const courseId = Number(req.params.id);
  if (!Number.isInteger(courseId)) return res.status(400).json({ error: 'ID kelas tidak valid' });
  const course = db.prepare('SELECT id, code, name, lecturer_id FROM courses WHERE id = ?').get(courseId);
  if (!course) return res.status(404).json({ error: 'Kelas tidak ditemukan' });
  if (course.lecturer_id !== Number(req.auth.sub)) return res.status(403).json({ error: 'Dosen bukan pengampu kelas ini' });
  const incomplete = db.prepare('SELECT COUNT(*) AS count FROM grades WHERE course_id = ? AND score IS NULL').get(courseId).count;
  const total = db.prepare('SELECT COUNT(*) AS count FROM grades WHERE course_id = ?').get(courseId).count;
  if (!total || incomplete) return res.status(409).json({ error: 'Nilai kelas belum lengkap' });

  db.prepare(`UPDATE grades SET is_final = 1, updated_at = datetime('now') WHERE course_id = ?`).run(courseId);
  try {
    const sync = await synchronizeTranscript(courseId);
    return res.json({ message: 'Nilai difinalisasi dan transkrip disinkronkan', course: course.code, sync });
  } catch (error) {
    return res.status(502).json({
      error: 'Nilai sudah difinalisasi, tetapi sinkronisasi transkrip gagal. Ulangi finalisasi untuk mencoba kembali.',
      detail: error.message,
      courseId
    });
  }
});

app.use((err, req, res, next) => {
  console.error('Service Nilai error:', err.message);
  res.status(500).json({ error: 'Terjadi kesalahan internal pada Service Nilai' });
});

const port = Number(process.env.NILAI_PORT || 3001);
app.listen(port, () => console.log(`Service Nilai aktif di http://localhost:${port}`));
