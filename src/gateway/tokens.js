const jwt = require('jsonwebtoken');

function issueAccessToken(user) {
  return jwt.sign(
    { role: user.role, username: user.username, ...(user.nim ? { nim: user.nim } : {}), token_type: 'access' },
    process.env.JWT_ACCESS_SECRET,
    { subject: String(user.id), expiresIn: process.env.ACCESS_TOKEN_TTL || '10m' }
  );
}

function verifyAccessToken(token) {
  const claims = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
  if (claims.token_type !== 'access' || !['mahasiswa', 'dosen', 'admin'].includes(claims.role)) {
    throw new Error('Jenis access token tidak valid');
  }
  return claims;
}

function issueServiceToken(clientId) {
  return jwt.sign(
    { role: 'service', token_type: 'service' },
    process.env.JWT_SERVICE_SECRET,
    { subject: clientId, expiresIn: process.env.SERVICE_TOKEN_TTL || '5m' }
  );
}

function verifyServiceToken(token) {
  const claims = jwt.verify(token, process.env.JWT_SERVICE_SECRET);
  if (claims.token_type !== 'service' || claims.role !== 'service') {
    throw new Error('Jenis token service tidak valid');
  }
  return claims;
}

module.exports = { issueAccessToken, verifyAccessToken, issueServiceToken, verifyServiceToken };
