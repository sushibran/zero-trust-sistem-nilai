const { timingSafeEqual } = require('node:crypto');
const { verifyAccessToken, verifyServiceToken } = require('../../gateway/tokens');

function equalSecret(supplied, expected) {
  if (!supplied || !expected) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function protectService(req, res, next) {
  if (!equalSecret(req.get('X-Gateway-Secret'), process.env.GATEWAY_SECRET)) {
    return res.status(403).json({ error: 'Gateway secret tidak valid' });
  }
  const match = /^Bearer\s+(.+)$/i.exec(req.get('Authorization') || '');
  if (!match) return res.status(401).json({ error: 'Bearer token diperlukan' });
  try {
    try {
      req.auth = { ...verifyAccessToken(match[1]), tokenType: 'access' };
    } catch {
      req.auth = { ...verifyServiceToken(match[1]), tokenType: 'service' };
    }
    return next();
  } catch {
    return res.status(401).json({ error: 'Token tidak valid atau kedaluwarsa' });
  }
}

module.exports = { protectService };
