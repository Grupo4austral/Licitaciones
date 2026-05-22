/**
 * WebSocketClient.js — Cliente WebSocket para notificaciones en tiempo real
 *
 * CONEXIÓN:
 *   ws://host/ws?userId=<uuid>&token=<jwt>
 *   El servidor valida el JWT al conectar. Si es inválido, cierra con código 4001.
 *
 * HEARTBEAT:
 *   El servidor envía { tipo: "ping" } cada 30s.
 *   Este cliente responde { tipo: "pong" } para mantener la conexión viva.
 *
 * RECONEXIÓN AUTOMÁTICA:
 *   Si la conexión se pierde (timeout de red, reinicio del servidor, etc.),
 *   el cliente reintenta con backoff exponencial (1s, 2s, 4s… hasta 30s máx).
 *
 * POPUPS:
 *   Cuando llega un mensaje tipo "nueva_licitacion", se muestra un popup emergente
 *   en la esquina inferior derecha. Se auto-cierra a los 12 segundos.
 *   El usuario puede hacer click en "Ver" para abrir el detalle de la licitación,
 *   lo que dispara el evento custom `licitia:ver-licitacion` que captura app.js.
 */

export class WebSocketClient {
  #wsUrl;
  #ws;
  #userId;
  #token;
  #onNuevaLicitacion;
  #reconectTimer;
  #intentos;
  #maxIntentos;
  #detenido;

  /**
   * @param {string} wsUrl  — URL base del servidor WS (ej: 'ws://localhost:3000/ws')
   * @param {number} maxIntentos — máx. intentos de reconexión antes de darse por vencido
   */
  constructor(wsUrl = 'ws://localhost:3000/ws', maxIntentos = 8) {
    this.#wsUrl            = wsUrl;
    this.#ws               = null;
    this.#userId           = null;
    this.#token            = null;
    this.#onNuevaLicitacion = null;
    this.#reconectTimer    = null;
    this.#intentos         = 0;
    this.#maxIntentos      = maxIntentos;
    this.#detenido         = false;

    this.#crearContenedor();
  }

  // ── API pública ──────────────────────────────────────────────────────────────

  /**
   * Conecta al servidor WebSocket con las credenciales del usuario autenticado.
   * @param {string} userId — UUID del usuario (del JWT)
   * @param {string} token  — JWT obtenido en el login
   * @param {Function} [onNuevaLicitacion] — callback opcional cuando llega una nueva licitación
   */
  connect(userId, token, onNuevaLicitacion = null) {
    this.#userId             = userId;
    this.#token              = token;
    this.#onNuevaLicitacion  = onNuevaLicitacion;
    this.#detenido           = false;
    this.#intentos           = 0;
    this.#conectar();
  }

  /**
   * Cierra la conexión y cancela reconexiones pendientes.
   * Llamar al hacer logout.
   */
  disconnect() {
    this.#detenido = true;
    clearTimeout(this.#reconectTimer);
    if (this.#ws) {
      this.#ws.close(1000, 'Logout del usuario');
      this.#ws = null;
    }
    console.log('[WS] Desconectado por logout.');
  }

  // ── Conexión interna ─────────────────────────────────────────────────────────

  #conectar() {
    if (this.#detenido || !this.#userId || !this.#token) return;

    const url = `${this.#wsUrl}?userId=${encodeURIComponent(this.#userId)}&token=${encodeURIComponent(this.#token)}`;

    try {
      this.#ws = new WebSocket(url);
    } catch (err) {
      console.error('[WS] No se pudo crear WebSocket:', err.message);
      this.#scheduleReconexion();
      return;
    }

    this.#ws.addEventListener('open', () => {
      console.log('[WS] Conexión establecida.');
      this.#intentos = 0; // resetear contador de reintentos al conectar exitosamente
    });

    this.#ws.addEventListener('message', (event) => {
      this.#handleMensaje(event.data);
    });

    this.#ws.addEventListener('close', (event) => {
      console.log(`[WS] Conexión cerrada. Código: ${event.code}, Razón: ${event.reason || 'sin razón'}`);

      // Código 4001 = token inválido → NO reconectar (haría un loop infinito)
      if (event.code === 4001) {
        console.warn('[WS] Token rechazado por el servidor. No se reintentará.');
        return;
      }

      if (!this.#detenido) this.#scheduleReconexion();
    });

    this.#ws.addEventListener('error', (err) => {
      // Los errores de WS en el browser no tienen .message útil,
      // el cierre se maneja en el listener 'close'
      console.warn('[WS] Error de conexión.');
    });
  }

  #scheduleReconexion() {
    if (this.#detenido || this.#intentos >= this.#maxIntentos) {
      if (this.#intentos >= this.#maxIntentos) {
        console.warn(`[WS] Se alcanzó el límite de ${this.#maxIntentos} reconexiones. Deteniendo.`);
      }
      return;
    }

    // Backoff exponencial: 1s, 2s, 4s, 8s… hasta 30s máx
    const delay = Math.min(1000 * Math.pow(2, this.#intentos), 30_000);
    this.#intentos++;
    console.log(`[WS] Reconectando en ${delay / 1000}s (intento ${this.#intentos}/${this.#maxIntentos})…`);
    this.#reconectTimer = setTimeout(() => this.#conectar(), delay);
  }

  // ── Manejo de mensajes entrantes ─────────────────────────────────────────────

  #handleMensaje(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      console.warn('[WS] Mensaje no parseable:', raw);
      return;
    }

    switch (msg.tipo) {
      case 'conexion_ok':
        console.log('[WS]', msg.mensaje);
        break;

      case 'nueva_licitacion':
        this.#mostrarPopup(msg.licitacion);
        if (this.#onNuevaLicitacion) this.#onNuevaLicitacion(msg.licitacion);
        break;

      case 'ping':
        // Responder pong para que el servidor sepa que seguimos activos
        if (this.#ws?.readyState === WebSocket.OPEN) {
          this.#ws.send(JSON.stringify({ tipo: 'pong' }));
        }
        break;

      default:
        console.log('[WS] Mensaje no reconocido:', msg);
    }
  }

  // ── Popups ───────────────────────────────────────────────────────────────────

  /**
   * Muestra un popup emergente con los datos de la nueva licitación.
   * El popup se auto-elimina del DOM luego de 12 segundos o si el usuario lo cierra.
   */
  #mostrarPopup(lic) {
    const container = document.getElementById('ws-popup-container') ||
                      document.getElementById('ws-container');
    if (!container) return;

    // Formatear datos para mostrar
    const diasRestantes = lic.fecha_cierre
      ? Math.ceil((new Date(lic.fecha_cierre) - Date.now()) / 86_400_000)
      : null;

    const diasStr = diasRestantes !== null
      ? (diasRestantes <= 0 ? 'Cierre vencido' : `${diasRestantes} días para cerrar`)
      : null;

    const presupuesto = lic.presupuesto_estimado
      ? `$${Number(lic.presupuesto_estimado).toLocaleString('es-AR')}`
      : null;

    const meta = [
      lic.organismo,
      lic.rubro,
      diasStr,
      presupuesto,
    ].filter(Boolean).join(' · ');

    // Crear el nodo del popup
    const popup = document.createElement('div');
    popup.className = 'ws-popup';
    popup.dataset.licId = lic.id;
    popup.innerHTML = `
      <button class="ws-dismiss" aria-label="Cerrar notificación">✕</button>
      <div class="ws-kicker">
        <span class="live-dot" aria-hidden="true"></span>
        Nueva licitación compatible
      </div>
      <div class="ws-title">${this.#escapar(lic.titulo || 'Sin título')}</div>
      ${meta ? `<div class="ws-meta">${this.#escapar(meta)}</div>` : ''}
      <div class="ws-btns">
        <button class="btn btn-primary btn-xs ws-ver-btn">Ver licitación</button>
        <button class="btn btn-ghost btn-xs ws-cerrar-btn">Descartar</button>
      </div>
    `;

    container.appendChild(popup);

    // Función que cierra y elimina el popup con animación
    const cerrar = () => {
      popup.style.transition = 'opacity .2s ease, transform .2s ease';
      popup.style.opacity    = '0';
      popup.style.transform  = 'translateX(40px)';
      setTimeout(() => popup.remove(), 220);
    };

    // Botones
    popup.querySelector('.ws-dismiss').addEventListener('click', cerrar);
    popup.querySelector('.ws-cerrar-btn').addEventListener('click', cerrar);
    popup.querySelector('.ws-ver-btn').addEventListener('click', () => {
      cerrar();
      // Disparar evento custom que app.js escucha para abrir el modal de detalle
      document.dispatchEvent(new CustomEvent('licitia:ver-licitacion', {
        detail: { id: lic.id },
      }));
    });

    // Auto-cerrar después de 12 segundos
    const autoClose = setTimeout(cerrar, 12_000);

    // Cancelar auto-cierre si el usuario interactúa con el popup
    popup.addEventListener('mouseenter', () => clearTimeout(autoClose));
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /**
   * Crea el contenedor de popups en el DOM si no existe.
   * Se ubica en la esquina inferior derecha (fijo via CSS).
   */
  #crearContenedor() {
    // Puede que el HTML ya tenga el contenedor creado
    if (document.getElementById('ws-popup-container') ||
        document.getElementById('ws-container')) return;

    const div = document.createElement('div');
    div.id = 'ws-popup-container';
    div.setAttribute('role', 'region');
    div.setAttribute('aria-live', 'polite');
    div.setAttribute('aria-label', 'Alertas de nuevas licitaciones');
    document.body.appendChild(div);

    // Estilos del contenedor (si no vienen del CSS principal)
    const style = document.createElement('style');
    style.textContent = `
      #ws-popup-container {
        position: fixed;
        bottom: 1.5rem;
        right:  1.5rem;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        gap: .65rem;
        width: min(360px, calc(100vw - 2rem));
        pointer-events: none;
      }
      #ws-popup-container > * { pointer-events: all; }
    `;
    document.head.appendChild(style);
  }

  /** Escapar HTML para evitar XSS en datos que vienen del servidor */
  #escapar(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}