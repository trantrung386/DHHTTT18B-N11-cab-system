const jwt = require('jsonwebtoken');
const { tokenUtils } = require('../config/redis'); // nếu chưa có thì bỏ check blacklist

/**
 * 🔐 AUTH MIDDLEWARE (Zero Trust)
 */
const authenticate = async (req, res, next) => {
  try {
    /* ================== SERVICE-TO-SERVICE CHECK ================== */
    const serviceKey = req.headers['x-service-key'];

    if (serviceKey !== process.env.SERVICE_SECRET) {
      return res.status(403).json({
        message: 'Forbidden - invalid service key'
      });
    }

    /* ================== GET TOKEN ================== */
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        message: 'Missing Authorization header'
      });
    }

    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        message: 'Invalid Authorization format'
      });
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        message: 'Missing token'
      });
    }

    /* ================== CHECK BLACKLIST ================== */
    if (tokenUtils?.isBlacklisted) {
      const isBlacklisted = await tokenUtils.isBlacklisted(token);
      if (isBlacklisted) {
        return res.status(401).json({
          message: 'Token revoked'
        });
      }
    }

    /* ================== VERIFY TOKEN ================== */
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      audience: 'cab-booking-system',
      issuer: 'cab-booking-auth-service'
    });

    req.user = decoded;

    /* ================== LOGGING ================== */
    console.log(
      `🔐 [BOOKING AUTH] ${req.method} ${req.originalUrl} userId=${decoded.userId}`
    );

    next();
  } catch (err) {
    console.error('JWT error:', err.message);

    return res.status(401).json({
      message: 'Invalid token'
    });
  }
};

/**
 * 🔐 RBAC
 */
const authorize = (roles = []) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(403).json({
        message: 'Access denied'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: 'Forbidden'
      });
    }

    next();
  };
};

module.exports = {
  authenticate,
  authorize
};