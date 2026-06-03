/**
 * server.js — Servidor principal de LicitIA
 *
 * Inicializa en orden:
 *   1. Express con middlewares (CORS, JSON, Swagger)
 *   2. Rutas API REST
 *   3. Servidor HTTP
 *   4. Servidor WebSocket (adjunto al mismo puerto HTTP)
 *   5. Servicio de ingesta periódica desde datos.gob.ar (API pública ONC)
 */

import express                from 'express';
import cors                   from 'cors';
import { createServer }       from 'http';
import swaggerUi              from 'swagger-ui-express';
import dotenv                 from 'dotenv';
import path                   from 'path';
import { fileURLToPath }      from 'url';

import { swaggerSpec }        from './swagger.js';
import { wsManager }          from './websocket.js';
import { datosGobArService }  from './datosGobAr.js';

import { authRouter }         from './authRoutes.js';
import { licitacionesRouter } from './licitaciones.js';
import { perfilRouter }       from './perfil.js';
import { favoritosRouter }    from './favoritos.js';
import { alertasRouter }      from './alertas.js';
import { assistantRouter }    from './assistant.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Express ────────────────────────────────────────────────────────────────────
const app = express();

app.use(cors({
  origin:          process.env.FRONTEND_URL || '*',
  methods:         ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders:  ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// En producción Render puede servir también el frontend estático desde este
// mismo servicio. Las rutas /api quedan por debajo y no se mezclan.
app.use(express.static(__dirname, {
  extensions: ['html'],
  index: false,
}));

// ── Swagger ────────────────────────────────────────────────────────────────────
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'LicitIA API Docs',
  customCss: '.swagger-ui .topbar { background: #1a3a6b; }',
}));
app.get('/api/docs.json', (_req, res) => res.json(swaggerSpec));

// ── Rutas REST ─────────────────────────────────────────────────────────────────
app.use('/api/auth',         authRouter);
app.use('/api/licitaciones', licitacionesRouter);
app.use('/api/perfil',       perfilRouter);
app.use('/api/favoritos',    favoritosRouter);
app.use('/api/alertas',      alertasRouter);
app.use('/api/asistente',    assistantRouter);

// Health check — útil para Render y monitoreo
app.get('/api/health', (_req, res) => {
  res.json({
    status:           'ok',
    timestamp:        new Date().toISOString(),
    wsConectados:     wsManager.clientesConectados,
    entorno:          process.env.NODE_ENV || 'development',
  });
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/index.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── 404 ────────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` });
});

// ── Error handler global ───────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[Server] Error no capturado:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ── HTTP Server ────────────────────────────────────────────────────────────────
const httpServer = createServer(app);
const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
  console.log(`\n🚀 LicitIA corriendo en http://localhost:${PORT}`);
  console.log(`📚 Swagger UI:    http://localhost:${PORT}/api/docs`);
  console.log(`🔌 WebSocket:     ws://localhost:${PORT}/ws?userId=<id>&token=<jwt>\n`);

  // ── WebSocket: adjuntar al HTTP server ya escuchando ──────────────────────
  wsManager.init(httpServer);

  // ── Ingesta periódica desde datos.gob.ar (API pública de la ONC) ─────────
  // Arranca un polling cada 5 minutos que trae licitaciones nuevas,
  // las persiste en Supabase y notifica a usuarios compatibles por WebSocket.
  datosGobArService.start();
});

// Shutdown graceful (Ctrl+C, SIGTERM de Render/Heroku)
process.on('SIGTERM', () => {
  console.log('\n[Server] SIGTERM recibido. Cerrando...');
  wsManager.cerrar();
  datosGobArService.stop();
  httpServer.close(() => process.exit(0));
});

export default app;
