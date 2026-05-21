import jwt from 'jsonwebtoken';

/**
 * Middleware de autenticación JWT
 * Verifica el token Bearer en el header Authorization
 */
export const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'No autorizado',
      detalle: 'Se requiere token JWT en el header Authorization: Bearer <token>',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, email, rol }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado', detalle: 'Iniciá sesión nuevamente' });
    }
    return res.status(401).json({ error: 'Token inválido', detalle: err.message });
  }
};

/**
 * Middleware de autorización por rol
 * @param {...string} roles - roles permitidos
 */
export const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'No autenticado' });
    }
    if (!roles.includes(req.user.rol)) {
      return res.status(403).json({
        error: 'Acceso denegado',
        detalle: `Se requiere rol: ${roles.join(' o ')}`,
      });
    }
    next();
  };
};
