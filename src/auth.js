
const crypto = require('crypto');

const secret = process.env.JWT_SECRET;

if (!secret) {
  throw new Error('JWT_SECRET Render में सेट नहीं है।');
}

function encode(data) {
  return Buffer.from(JSON.stringify(data)).toString('base64url');
}

function signToken(user) {
  const header = encode({
    alg: 'HS256',
    typ: 'JWT'
  });

  const payload = encode({
    id: user.id,
    role: user.role || 'user',
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
  });

  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');

  return `${header}.${payload}.${signature}`;
}

function verifyToken(token) {
  const parts = token.split('.');

  if (parts.length !== 3) {
    throw new Error('Invalid token');
  }

  const [header, payload, signature] = parts;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest();

  const actual = Buffer.from(signature, 'base64url');

  if (
    actual.length !== expected.length ||
    !crypto.timingSafeEqual(actual, expected)
  ) {
    throw new Error('Invalid signature');
  }

  const data = JSON.parse(
    Buffer.from(payload, 'base64url').toString()
  );

  if (!data.id || data.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }

  return data;
}

function requireAuth(req, res, next) {
  try {
    const authorization = req.headers.authorization || '';

    if (!authorization.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'कृपया पहले लॉगिन करें।'
      });
    }

    req.user = verifyToken(authorization.slice(7));
    next();
  } catch (error) {
    return res.status(401).json({
      error: 'लॉगिन समाप्त हो गया है। दोबारा लॉगिन करें।'
    });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'केवल एडमिन इस सुविधा का उपयोग कर सकता है।'
    });
  }

  next();
}

module.exports = {
  requireAuth,
  requireAdmin,
  signToken,
  secret
};
