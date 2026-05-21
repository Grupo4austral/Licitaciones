import { WebSocketServer } from 'ws';

/**
 * WebSocketManager — maneja conexiones en tiempo real para notificaciones
 * Cada cliente se autentica con su userId y recibe alertas personalizadas
 */
class WebSocketManager {
  constructor() {
    this.wss = null;
    // Map de userId -> Set de conexiones WebSocket activas
    this.clients = new Map();
  }

  /**
   * Inicializa el servidor WebSocket adjunto al servidor HTTP de Express
   * @param {http.Server} server
   */
  init(server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const userId = url.searchParams.get('userId');

      if (!userId) {
        ws.close(1008, 'Se requiere userId');
        return;
      }

      // Registrar cliente
      if (!this.clients.has(userId)) {
        this.clients.set(userId, new Set());
      }
      this.clients.get(userId).add(ws);

      console.log(`[WS] Cliente conectado: userId=${userId} | Total clientes: ${this.clients.size}`);

      // Enviar confirmación de conexión
      ws.send(
        JSON.stringify({
          tipo: 'conexion_ok',
          mensaje: '¡Conectado a LicitIA! Recibirás alertas de nuevas licitaciones en tiempo real.',
          timestamp: new Date().toISOString(),
        })
      );

      ws.on('close', () => {
        const conns = this.clients.get(userId);
        if (conns) {
          conns.delete(ws);
          if (conns.size === 0) this.clients.delete(userId);
        }
        console.log(`[WS] Cliente desconectado: userId=${userId}`);
      });

      ws.on('error', (err) => {
        console.error(`[WS] Error en cliente ${userId}:`, err.message);
      });
    });

    console.log('[WS] Servidor WebSocket iniciado en /ws');
  }

  /**
   * Envía una alerta de nueva licitación a un usuario específico
   * @param {string} userId
   * @param {object} licitacion - datos de la nueva licitación
   */
  notificarNuevaLicitacion(userId, licitacion) {
    const payload = JSON.stringify({
      tipo: 'nueva_licitacion',
      licitacion: {
        id: licitacion.id,
        titulo: licitacion.titulo,
        organismo: licitacion.organismo,
        rubro: licitacion.rubro,
        provincia: licitacion.provincia,
        fecha_cierre: licitacion.fecha_cierre,
        presupuesto_estimado: licitacion.presupuesto_estimado,
        url_original: licitacion.url_original,
      },
      timestamp: new Date().toISOString(),
    });

    const conns = this.clients.get(userId);
    if (!conns || conns.size === 0) return;

    for (const ws of conns) {
      if (ws.readyState === 1) {
        // OPEN
        ws.send(payload);
      }
    }
  }

  /**
   * Broadcast a TODOS los clientes conectados (ej: mantenimiento)
   * @param {object} mensaje
   */
  broadcast(mensaje) {
    const payload = JSON.stringify(mensaje);
    for (const [, conns] of this.clients) {
      for (const ws of conns) {
        if (ws.readyState === 1) ws.send(payload);
      }
    }
  }

  /**
   * Retorna cuántos usuarios únicos están conectados
   */
  get clientesConectados() {
    return this.clients.size;
  }
}

// Singleton
export const wsManager = new WebSocketManager();
