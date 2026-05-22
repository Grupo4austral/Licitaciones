/**
 * websocket.js — Servidor WebSocket para notificaciones en tiempo real
 *
 * ARQUITECTURA:
 *   - El servidor WebSocket corre en el mismo puerto que Express (compartido via http.Server)
 *   - Ruta: ws://host/ws?userId=<uuid>&token=<jwt>
 *   - Cada usuario puede tener múltiples conexiones abiertas (distintas pestañas)
 *   - Se usa un Map: userId → Set<WebSocket> para gestionar las conexiones
 *
 * PROTOCOLO DE MENSAJES (servidor → cliente):
 *
 *   Conexión exitosa:
 *   { tipo: "conexion_ok", mensaje: string, timestamp: string }
 *
 *   Nueva licitación disponible:
 *   {
 *     tipo: "nueva_licitacion",
 *     licitacion: { id, titulo, organismo, rubro, provincia, fecha_cierre, presupuesto_estimado, url_original },
 *     timestamp: string
 *   }
 *
 *   Ping del servidor (heartbeat):
 *   { tipo: "ping", timestamp: string }
 *
 * PROTOCOLO DE MENSAJES (cliente → servidor):
 *   { tipo: "pong" }   — respuesta al ping para mantener la conexión viva
 *
 * SEGURIDAD:
 *   - El token JWT se valida al conectar. Conexiones sin token o con token inválido
 *     se rechazan con código 4001 (Unauthorized).
 *   - Se verifica que el userId del query param coincida con el sub del JWT.
 *
 * HEARTBEAT:
 *   - Cada HEARTBEAT_INTERVAL_MS el servidor envía un ping a todos los clientes.
 *   - Si un cliente no responde en HEARTBEAT_TIMEOUT_MS, se cierra su conexión.
 *   - Esto previene conexiones "zombie" que ocupan memoria sin estar activas.
 */

import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';

// ── Configuración ──────────────────────────────────────────────────────────────
const HEARTBEAT_INTERVAL_MS = 30_000;  // ping cada 30 segundos
const HEARTBEAT_TIMEOUT_MS  = 10_000;  // si no hay pong en 10s, cerrar

// ── Clase WebSocketManager ─────────────────────────────────────────────────────
class WebSocketManager {
  #wss;
  #heartbeatTimer;

  // userId → Set<WebSocket> (cada WS tiene además .userId y .isAlive adjuntos)
  #clients;

  constructor() {
    this.#wss            = null;
    this.#heartbeatTimer = null;
    this.#clients        = new Map();
  }

  // ── Inicialización ─────────────────────────────────────────────────────────

  /**
   * Adjunta el servidor WebSocket al servidor HTTP existente de Express.
   * Debe llamarse una sola vez desde server.js, después de httpServer.listen().
   * @param {import('http').Server} httpServer
   */
  init(httpServer) {
    this.#wss = new WebSocketServer({
      server: httpServer,
      path:   '/ws',
    });

    this.#wss.on('connection', (ws, req) => this.#handleConnection(ws, req));
    this.#wss.on('error', (err) => console.error('[WS] Error del servidor:', err.message));

    // Iniciar heartbeat periódico
    this.#heartbeatTimer = setInterval(() => this.#heartbeat(), HEARTBEAT_INTERVAL_MS);

    console.log('[WS] Servidor WebSocket listo en /ws');
  }

  // ── Manejo de nuevas conexiones ────────────────────────────────────────────

  #handleConnection(ws, req) {
    // Parsear query params: ?userId=<uuid>&token=<jwt>
    const urlParsed = new URL(req.url, `http://${req.headers.host}`);
    const userId    = urlParsed.searchParams.get('userId');
    const token     = urlParsed.searchParams.get('token');

    // ── Validación de seguridad ──
    if (!userId || !token) {
      ws.close(4001, 'Se requieren userId y token');
      return;
    }

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      // Verificar que el userId del param coincide con el del token
      if (payload.id !== userId) {
        ws.close(4001, 'Token no corresponde al userId');
        return;
      }
    } catch (err) {
      ws.close(4001, `Token inválido: ${err.message}`);
      return;
    }

    // ── Registrar conexión ──
    ws.userId  = userId;
    ws.isAlive = true;     // para el heartbeat

    if (!this.#clients.has(userId)) {
      this.#clients.set(userId, new Set());
    }
    this.#clients.get(userId).add(ws);

    const totalConexiones = [...this.#clients.values()].reduce((a, s) => a + s.size, 0);
    console.log(`[WS] Conectado: userId=${userId} | Usuarios únicos: ${this.#clients.size} | Conexiones totales: ${totalConexiones}`);

    // Confirmación de conexión exitosa
    this.#send(ws, {
      tipo:      'conexion_ok',
      mensaje:   'Conectado a LicitIA. Recibirás alertas en tiempo real cuando aparezca una licitación compatible con tu perfil.',
      timestamp: new Date().toISOString(),
    });

    // ── Manejo de mensajes entrantes ──
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.tipo === 'pong') {
          ws.isAlive = true;  // el cliente sigue vivo
        }
      } catch {
        // Ignorar mensajes malformados
      }
    });

    // ── Limpieza al desconectar ──
    ws.on('close', (code, reason) => {
      this.#desregistrar(ws);
      console.log(`[WS] Desconectado: userId=${userId} | Código: ${code} | Razón: ${reason?.toString() || 'sin razón'}`);
    });

    ws.on('error', (err) => {
      console.error(`[WS] Error en conexión de ${userId}:`, err.message);
      this.#desregistrar(ws);
    });
  }

  // ── Heartbeat (detección de conexiones muertas) ────────────────────────────

  #heartbeat() {
    const ahora = new Date().toISOString();

    for (const [userId, conns] of this.#clients) {
      for (const ws of conns) {
        if (!ws.isAlive) {
          // No respondió al ping anterior → cerrar
          console.log(`[WS] Cerrando conexión zombie de userId=${userId}`);
          ws.terminate();
          conns.delete(ws);
          continue;
        }

        // Marcar como "pendiente de pong" y enviar ping
        ws.isAlive = false;
        this.#send(ws, { tipo: 'ping', timestamp: ahora });
      }

      // Limpiar entrada del Map si no quedan conexiones activas
      if (conns.size === 0) this.#clients.delete(userId);
    }
  }

  // ── API pública ────────────────────────────────────────────────────────────

  /**
   * Envía una notificación de nueva licitación a todas las conexiones activas
   * de un usuario específico.
   *
   * @param {string} userId — UUID del usuario destinatario
   * @param {object} licitacion — datos de la nueva licitación a notificar
   */
  notificarNuevaLicitacion(userId, licitacion) {
    const conns = this.#clients.get(userId);
    if (!conns || conns.size === 0) return;

    const payload = {
      tipo:      'nueva_licitacion',
      licitacion: {
        id:                   licitacion.id,
        titulo:               licitacion.titulo,
        organismo:            licitacion.organismo,
        rubro:                licitacion.rubro,
        provincia:            licitacion.provincia,
        fecha_cierre:         licitacion.fecha_cierre,
        presupuesto_estimado: licitacion.presupuesto_estimado,
        url_original:         licitacion.url_original,
      },
      timestamp: new Date().toISOString(),
    };

    let enviadas = 0;
    for (const ws of conns) {
      if (this.#send(ws, payload)) enviadas++;
    }

    if (enviadas > 0) {
      console.log(`[WS] Notificación enviada a userId=${userId} (${enviadas} conexión/es): "${licitacion.titulo?.substring(0, 60)}..."`);
    }
  }

  /**
   * Broadcast a TODOS los usuarios conectados.
   * Útil para mensajes de sistema (mantenimiento, versión nueva, etc.)
   * @param {object} mensaje
   */
  broadcast(mensaje) {
    let total = 0;
    for (const conns of this.#clients.values()) {
      for (const ws of conns) {
        if (this.#send(ws, mensaje)) total++;
      }
    }
    console.log(`[WS] Broadcast enviado a ${total} conexión/es.`);
  }

  /**
   * Cantidad de usuarios únicos conectados en este momento.
   */
  get clientesConectados() {
    return this.#clients.size;
  }

  /**
   * Cierra el servidor WebSocket limpiamente (para shutdown graceful).
   */
  cerrar() {
    clearInterval(this.#heartbeatTimer);
    this.#wss?.close(() => console.log('[WS] Servidor cerrado.'));
  }

  // ── Helpers privados ───────────────────────────────────────────────────────

  /**
   * Envía un objeto JSON a un WebSocket específico de forma segura.
   * @returns {boolean} true si el mensaje fue enviado, false si la conexión no estaba abierta
   */
  #send(ws, payload) {
    if (ws.readyState !== 1 /* OPEN */) return false;
    try {
      ws.send(JSON.stringify(payload));
      return true;
    } catch (err) {
      console.error('[WS] Error al enviar mensaje:', err.message);
      return false;
    }
  }

  /**
   * Elimina una conexión del registro de clientes activos.
   */
  #desregistrar(ws) {
    const conns = this.#clients.get(ws.userId);
    if (!conns) return;
    conns.delete(ws);
    if (conns.size === 0) this.#clients.delete(ws.userId);
  }
}

// Singleton: una sola instancia compartida por toda la app
export const wsManager = new WebSocketManager();