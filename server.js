import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import swaggerUi from 'swagger-ui-express';
import dotenv from 'dotenv';

import { swaggerSpec } from './config/swagger.js';
import { wsManager } from './services/websocket.js';
import { authRouter } from './routes/auth.js';
import { licitacionesRouter } from './routes/licitaciones.js';
import { perfilRouter } from './routes/perfil.js';
import { favoritosRouter } from './routes/favoritos.js';
import { alertasRouter } from './routes/alertas.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);

// ── Middleware global ──────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Swagger UI ─────────────────────────────────────────────────────
app.use(
  '/api/docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'LicitIA API Docs',
    customCss: `
      .swagger-ui .topbar { background-color: #0f172a; }
      .swagger-ui .topbar-wrapper img { content: none; }
    `,
  })
);
app.get('/api/docs.json', (req, res) => res.json(swaggerSpec));

// ── Rutas API ──────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/licitaciones', licitacionesRouter);
app.use('/api/perfil', perfilRouter);
app.use('/api/favoritos', favoritosRouter);
app.use('/api/alertas', alertasRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    wsClientes: wsManager.clientesConectados,
  });
});

// ── 404 handler ────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` });
});

// ── Error handler global ───────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[Server] Error no manejado:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ── Iniciar WebSocket ──────────────────────────────────────────────
wsManager.init(httpServer);

// ── Arrancar servidor ──────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`\n🚀 LicitIA Backend corriendo en http://localhost:${PORT}`);
  console.log(`📚 Swagger UI disponible en http://localhost:${PORT}/api/docs`);
  console.log(`🔌 WebSocket en ws://localhost:${PORT}/ws?userId=<id>\n`);
});

export default app;
