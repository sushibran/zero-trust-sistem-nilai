require('dotenv').config();
const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/connection');
const { issueAccessToken, verifyAccessToken, issueServiceToken, verifyServiceToken } = require('./tokens');
const { decide } = require('./policy');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const audit = (subject, endpoint, deviceId, decision, reason) => db.prepare(
  'INSERT INTO audit_logs (subject, endpoint, device_id, decision, reason) VALUES (?, ?, ?, ?, ?)'
).run(String(subject), endpoint, deviceId || null, decision, reason);

function requireEnvironment() {
  for (const key of ['JWT_ACCESS_SECRET', 'JWT_SERVICE_SECRET', 'GATEWAY_SECRET']) {
    if (!process.env[key] || process.env[key].startsWith('replace-with-')) {
      throw new Error(`${key} belum diatur. Salin .env.example menjadi .env dan isi secret unik.`);
    }
  }
}

app.post('/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const deviceId = req.get('X-Device-ID');
  const user = typeof username === 'string' ? db.prepare('SELECT * FROM users WHERE username = ?').get(username) : null;
  const device = user && deviceId ? db.prepare('SELECT 1 FROM devices WHERE user_id = ? AND device_id = ? AND active = 1').get(user.id, deviceId) : null;

  if (!user || typeof password !== 'string' || !bcrypt.compareSync(password, user.password_hash) || !device) {
    audit(username || 'unknown', req.path, deviceId, 'deny', 'Kredensial atau device tidak valid');
    return res.status(401).json({ error: 'Kredensial atau device tidak valid' });
  }

  const refreshToken = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + Number(process.env.REFRESH_TOKEN_TTL_DAYS || 1) * 86400000).toISOString();
  db.prepare('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)').run(user.id, hash(refreshToken), expiresAt);
  audit(user.username, req.path, deviceId, 'allow', 'Login berhasil; kredensial dan device valid');
  return res.json({ accessToken: issueAccessToken(user), refreshToken, tokenType: 'Bearer', expiresIn: process.env.ACCESS_TOKEN_TTL || '10m' });
});

app.post('/auth/refresh', (req, res) => {
  const refreshToken = req.body?.refreshToken;
  if (typeof refreshToken !== 'string') {
    audit('unknown', req.path, req.get('X-Device-ID'), 'deny', 'Refresh token tidak diberikan');
    return res.status(401).json({ error: 'Refresh token tidak valid' });
  }
  const oldHash = hash(refreshToken);
  const row = db.prepare(`SELECT r.id, r.user_id, r.expires_at, r.revoked_at, u.username, u.role, u.nim
    FROM refresh_tokens r JOIN users u ON u.id = r.user_id WHERE r.token_hash = ?`).get(oldHash);
  if (!row || row.revoked_at || Date.parse(row.expires_at) <= Date.now()) {
    audit(row?.username || 'unknown', req.path, req.get('X-Device-ID'), 'deny', 'Refresh token tidak valid, kedaluwarsa, atau dicabut');
    return res.status(401).json({ error: 'Refresh token tidak valid' });
  }

  const nextRefresh = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + Number(process.env.REFRESH_TOKEN_TTL_DAYS || 1) * 86400000).toISOString();
  const rotate = db.prepare('UPDATE refresh_tokens SET revoked_at = datetime(\'now\') WHERE id = ? AND revoked_at IS NULL');
  const insert = db.prepare('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)');
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = rotate.run(row.id);
    if (!result.changes) throw new Error('Refresh token sudah digunakan');
    insert.run(row.user_id, hash(nextRefresh), expiresAt);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    audit(row.username, req.path, req.get('X-Device-ID'), 'deny', 'Refresh token sudah dicabut atau digunakan');
    return res.status(401).json({ error: 'Refresh token tidak valid' });
  }
  audit(row.username, req.path, req.get('X-Device-ID'), 'allow', 'Refresh token valid; token dirotasi');
  return res.json({ accessToken: issueAccessToken(row), refreshToken: nextRefresh, tokenType: 'Bearer', expiresIn: process.env.ACCESS_TOKEN_TTL || '10m' });
});

app.post('/auth/logout', (req, res) => {
  const refreshToken = req.body?.refreshToken;
  if (typeof refreshToken !== 'string') {
    audit('unknown', req.path, req.get('X-Device-ID'), 'deny', 'Refresh token tidak diberikan');
    return res.status(401).json({ error: 'Refresh token tidak valid' });
  }
  const row = db.prepare(`SELECT r.id, r.revoked_at, r.expires_at, u.username FROM refresh_tokens r
    JOIN users u ON u.id = r.user_id WHERE r.token_hash = ?`).get(hash(refreshToken));
  if (!row || row.revoked_at || Date.parse(row.expires_at) <= Date.now()) {
    audit(row?.username || 'unknown', req.path, req.get('X-Device-ID'), 'deny', 'Refresh token tidak valid, kedaluwarsa, atau dicabut');
    return res.status(401).json({ error: 'Refresh token tidak valid' });
  }
  db.prepare('UPDATE refresh_tokens SET revoked_at = datetime(\'now\') WHERE id = ?').run(row.id);
  audit(row.username, req.path, req.get('X-Device-ID'), 'allow', 'Logout; refresh token dicabut');
  return res.status(204).end();
});

app.post('/auth/service', (req, res) => {
  const { clientId, clientSecret } = req.body || {};
  const client = typeof clientId === 'string' ? db.prepare('SELECT * FROM service_clients WHERE client_id = ? AND active = 1').get(clientId) : null;
  if (!client || typeof clientSecret !== 'string' || !bcrypt.compareSync(clientSecret, client.secret_hash)) {
    audit(clientId || 'unknown-service', req.path, null, 'deny', 'Client service tidak valid');
    return res.status(401).json({ error: 'Client ID atau secret tidak valid' });
  }
  audit(clientId, req.path, null, 'allow', 'Client service valid');
  return res.json({ accessToken: issueServiceToken(client.client_id), tokenType: 'Bearer', expiresIn: process.env.SERVICE_TOKEN_TTL || '5m' });
});

function getBearer(req) {
  const header = req.get('Authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1];
}

app.all(['/nilai', '/nilai/*', '/kelas/*', '/transkrip', '/transkrip/*'], async (req, res) => {
  const endpoint = req.path;
  const token = getBearer(req);
  if (!token) {
    audit('unknown', endpoint, req.get('X-Device-ID'), 'deny', 'Bearer token tidak diberikan');
    return res.status(401).json({ error: 'Bearer token diperlukan' });
  }

  let claims;
  try {
    claims = verifyAccessToken(token);
  } catch {
    try {
      claims = verifyServiceToken(token);
    } catch {
      audit('unknown', endpoint, req.get('X-Device-ID'), 'deny', 'Token tidak valid atau kedaluwarsa');
      return res.status(401).json({ error: 'Token tidak valid atau kedaluwarsa' });
    }
  }

  if (claims.role === 'service') {
    const allowed = req.method === 'POST' && endpoint === '/transkrip/sinkron';
    audit(claims.sub, endpoint, null, allowed ? 'allow' : 'deny', allowed ? 'Token service diizinkan untuk sinkronisasi' : 'Token service hanya boleh sinkronisasi transkrip');
    if (!allowed) return res.status(403).json({ error: 'Token service tidak diizinkan untuk endpoint ini' });
    return forward(req, res, 'transkrip', token);
  }

  const deviceId = req.get('X-Device-ID');
  const device = deviceId && db.prepare('SELECT 1 FROM devices WHERE user_id = ? AND device_id = ? AND active = 1').get(Number(claims.sub), deviceId);
  if (!device) {
    audit(claims.username || claims.sub, endpoint, deviceId, 'deny', 'Device tidak terdaftar atau tidak aktif untuk user');
    return res.status(403).json({ error: 'Device tidak terdaftar atau tidak aktif' });
  }

  const result = decide(claims, req.method, endpoint);
  audit(claims.username || claims.sub, endpoint, deviceId, result.allow ? 'allow' : 'deny', result.reason);
  if (!result.allow) return res.status(403).json({ error: 'Akses ditolak', reason: result.reason });
  const target = endpoint.startsWith('/transkrip') ? 'transkrip' : 'nilai';
  return forward(req, res, target, token, result.gradeIds);
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  audit('unknown', req.path, req.get('X-Device-ID'), 'deny', 'Request tidak dapat diparse atau format body tidak valid');
  return res.status(err.status || 400).json({ error: 'Request tidak valid' });
});

app.use((req, res) => {
  audit('unknown', req.path, req.get('X-Device-ID'), 'deny', 'Endpoint atau metode tidak dikenal');
  return res.status(404).json({ error: 'Endpoint tidak ditemukan' });
});

async function forward(req, res, service, token, gradeIds) {
  const base = service === 'nilai'
    ? (process.env.NILAI_SERVICE_URL || 'http://localhost:3001')
    : (process.env.TRANSKRIP_SERVICE_URL || 'http://localhost:3002');
  try {
    const headers = { 'X-Gateway-Secret': process.env.GATEWAY_SECRET, Authorization: `Bearer ${token}` };
    if (gradeIds) headers['X-Policy-Grade-Ids'] = gradeIds.join(',');
    if (req.get('Content-Type')) headers['Content-Type'] = req.get('Content-Type');
    if (req.get('X-Device-ID')) headers['X-Device-ID'] = req.get('X-Device-ID');
    const response = await fetch(new URL(req.originalUrl, base), {
      method: req.method,
      headers,
      ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body: JSON.stringify(req.body || {}) })
    });
    const contentType = response.headers.get('content-type');
    if (contentType) res.set('Content-Type', contentType);
    const body = Buffer.from(await response.arrayBuffer());
    return res.status(response.status).send(body);
  } catch (error) {
    return res.status(502).json({ error: `Service ${service} tidak dapat dihubungi` });
  }
}

const port = Number(process.env.GATEWAY_PORT || 3000);
try {
  requireEnvironment();
  app.listen(port, () => console.log(`API Gateway aktif di http://localhost:${port}`));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
