/**
 * WebSocketClient — gestiona la conexión WS con el backend
 * Muestra popups emergentes cuando llega una nueva licitación
 */
export class WebSocketClient {
  #ws;
  #userId;
  #wsUrl;
  #onNuevaLicitacion;
  #reconnectTimer;
  #maxRetries;
  #retries;

  constructor(wsUrl = 'ws://localhost:3000/ws', maxRetries = 5) {
    this.#wsUrl = wsUrl;
    this.#maxRetries = maxRetries;
    this.#retries = 0;
    this.#ws = null;
    this.#userId = null;
    this.#onNuevaLicitacion = null;

    // Crear contenedor de popups en el DOM
    this.#ensureContainer();
  }

  /**
   * Conecta al servidor WebSocket con el userId del usuario logueado
   * @param {string} userId
   * @param {Function} onNuevaLicitacion - callback cuando llega nueva licitación
   */
  connect(userId, onNuevaLicitacion = null) {
    this.#userId = userId;
    this.#onNuevaLicitacion = onNuevaLicitacion;
    this.#retries = 0;
    this.#doConnect();
  }

  disconnect() {
    clearTimeout(this.#reconnectTimer);
    if (this.#ws) {
      this.#ws.close();
      this.#ws = null;
    }
  }

  #doConnect() {
    if (!this.#userId) return;
    const url = `${this.#wsUrl}?userId=${this.#userId}`;
    this.#ws = new WebSocket(url);

    this.#ws.addEventListener('open', () => {
      console.log('[WS] Conectado al servidor de alertas');
      this.#retries = 0;
    });

    this.#ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.#handleMessage(msg);
      } catch (e) {
        console.warn('[WS] Mensaje no parseable:', event.data);
      }
    });

    this.#ws.addEventListener('close', () => {
      console.log('[WS] Conexión cerrada');
      this.#scheduleReconnect();
    });

    this.#ws.addEventListener('error', (err) => {
      console.warn('[WS] Error de conexión:', err);
    });
  }

  #scheduleReconnect() {
    if (this.#retries >= this.#maxRetries) return;
    this.#retries++;
    const delay = Math.min(1000 * 2 ** this.#retries, 30000);
    console.log(`[WS] Reconectando en ${delay / 1000}s... (intento ${this.#retries})`);
    this.#reconnectTimer = setTimeout(() => this.#doConnect(), delay);
  }

  #handleMessage(msg) {
    switch (msg.tipo) {
      case 'nueva_licitacion':
        this.#mostrarPopup(msg.licitacion);
        if (this.#onNuevaLicitacion) this.#onNuevaLicitacion(msg.licitacion);
        break;
      case 'conexion_ok':
        console.log('[WS]', msg.mensaje);
        break;
      default:
        console.log('[WS] Mensaje recibido:', msg);
    }
  }

  /**
   * Muestra un popup emergente con los datos de la nueva licitación
   */
  #mostrarPopup(licitacion) {
    const container = document.getElementById('ws-popup-container');
    if (!container) return;

    const popup = document.createElement('div');
    popup.className = 'ws-popup';
    popup.id = `popup-${licitacion.id}`;

    const diasRestantes = licitacion.fecha_cierre
      ? Math.ceil((new Date(licitacion.fecha_cierre) - new Date()) / 86400000)
      : null;

    const presupuesto = licitacion.presupuesto_estimado
      ? `$${Number(licitacion.presupuesto_estimado).toLocaleString('es-AR')}`
      : null;

    popup.innerHTML = `
      <button class="ws-popup-close" aria-label="Cerrar">✕</button>
      <div class="ws-popup-header">
        <span class="ws-popup-icon">🔔</span>
        <span class="ws-popup-label">Nueva licitación compatible</span>
      </div>
      <div class="ws-popup-title">${licitacion.titulo || 'Sin título'}</div>
      <div class="ws-popup-meta">
        ${licitacion.organismo ? `<strong>${licitacion.organismo}</strong> · ` : ''}
        ${licitacion.rubro ? `${licitacion.rubro} · ` : ''}
        ${diasRestantes !== null ? `${diasRestantes} días para cerrar` : ''}
        ${presupuesto ? ` · ${presupuesto}` : ''}
      </div>
      <div class="ws-popup-actions">
        <button class="btn btn-primary btn-sm" id="popup-ver-${licitacion.id}">Ver licitación</button>
        <button class="btn btn-ghost btn-sm" id="popup-cerrar-${licitacion.id}">Descartar</button>
      </div>
    `;

    container.appendChild(popup);

    // Cerrar con botones
    const cerrar = () => {
      popup.style.animation = 'popupOut 0.25s ease both';
      popup.addEventListener('animationend', () => popup.remove(), { once: true });
    };

    popup.querySelector('.ws-popup-close').addEventListener('click', cerrar);
    document.getElementById(`popup-cerrar-${licitacion.id}`)?.addEventListener('click', cerrar);
    document.getElementById(`popup-ver-${licitacion.id}`)?.addEventListener('click', () => {
      cerrar();
      // Emitir evento personalizado para que la app navegue a la licitación
      document.dispatchEvent(new CustomEvent('licitia:ver-licitacion', {
        detail: { id: licitacion.id }
      }));
    });

    // Auto-cerrar luego de 12 segundos
    setTimeout(cerrar, 12000);
  }

  #ensureContainer() {
    if (!document.getElementById('ws-popup-container')) {
      const container = document.createElement('div');
      container.id = 'ws-popup-container';
      document.body.appendChild(container);
    }

    // Agregar animación de salida al stylesheet
    if (!document.getElementById('ws-popup-styles')) {
      const style = document.createElement('style');
      style.id = 'ws-popup-styles';
      style.textContent = `
        @keyframes popupOut {
          from { opacity: 1; transform: translateX(0); }
          to   { opacity: 0; transform: translateX(60px); }
        }
      `;
      document.head.appendChild(style);
    }
  }
}
