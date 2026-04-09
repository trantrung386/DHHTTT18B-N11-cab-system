const axios = require('axios');

/**
 * JWT Authentication Middleware
 * API Gateway -> Auth Service
 */
const authenticateToken = async (req, res, next) => {
  try {
    /* ================== SKIP RULES ================== */
    const publicRoutes = ['/auth', '/health'];

    if (publicRoutes.some(route => req.path.startsWith(route))) {
      return next();
    }

    /* ================== GET TOKEN ================== */
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        error: 'Authorization header is required',
        code: 'MISSING_AUTH_HEADER'
      });
    }

    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Invalid authorization format',
        code: 'INVALID_AUTH_FORMAT'
      });
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        error: 'Access token is required',
        code: 'MISSING_TOKEN'
      });
    }

    /* ================== CALL AUTH SERVICE ================== */
    const authServiceUrl =
      process.env.AUTH_SERVICE_URL || 'http://auth-service:3004';

    const response = await axios.post(
      `${authServiceUrl}/auth/validate-token`,
      { token },
      {
        timeout: 5000,
        headers: {
          // 🔒 chống fake request giữa services
          'x-service-key': process.env.SERVICE_SECRET || 'gateway-secret'
        }
      }
    );

    /* ================== HANDLE RESPONSE ================== */
    if (!response.data || response.data.valid !== true) {
      return res.status(401).json({
        error: 'Invalid token',
        code: 'INVALID_TOKEN'
      });
    }

    // Gắn user info cho request
    req.user = response.data.user;

    /* ================== BASIC USER VALIDATION ================== */
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        error: 'Invalid user data',
        code: 'INVALID_USER'
      });
    }

    /* ================== LOGGING ================== */
    console.log(
      `🔐 [AUTH] ${req.method} ${req.originalUrl} - userId: ${req.user.id}`
    );

    next();
  } catch (error) {
    console.error('🔒 Auth middleware error:', error.message);

    /* ================== AUTH SERVICE ERROR ================== */
    if (error.response) {
      return res.status(error.response.status).json({
        ...error.response.data
      });
    }

    /* ================== NETWORK / TIMEOUT ================== */
    return res.status(502).json({
      error: 'Authentication service unavailable',
      code: 'AUTH_SERVICE_UNAVAILABLE'
    });
  }
};

/**
 * 🔥 ROLE-BASED ACCESS CONTROL (RBAC)
 */
const authorize = (roles = []) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(403).json({
        error: 'Access denied',
        code: 'NO_ROLE'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'INSUFFICIENT_PERMISSION'
      });
    }

    next();
  };
};

module.exports = {
  authenticateToken,
  authorize
};