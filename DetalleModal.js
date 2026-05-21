/**
 * DetalleModal — modal de detalle completo de una licitación
 * Se abre al hacer click en cualquier card o desde un popup WebSocket
 */
export class DetalleModal {
  #api;
  #overlay;
  #panel;
  #favoritoActivo;
  #licitacionActual;

  constructor(apiService) {
    this.#api = apiService;
    this.#favoritoActivo = false;
    this.#licitacionActual = null;
    this.#buildDOM();
  }

  #buildDOM() {
    // Overlay con panel lateral deslizante
    this.#overlay = document.createElement('div');
    this.#overlay.id = 'detalle-overlay';
    this.#overlay.setAttribute('role', 'dialog');
    this.#overlay.setAttribute('aria-modal', 'true');
    this.#overlay.setAttribute('aria-label', 'Detalle de licitación');
    this.#overlay.innerHTML = `
      <div id="detalle-panel">
        <div id="detalle-content">
          <div class="loader"><div class="spinner"></div></div>
        </div>
      </div>
    `;

    document.body.appendChild(this.#overlay);
    this.#panel = document.getElementById('detalle-panel');

    // Cerrar al hacer click fuera del panel
    this.#overlay.addEventListener('click', (e) => {
      if (e.target === this.#overlay) this.close();
    });

    // Cerrar con Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });

    // Insertar estilos del modal
    this.#injectStyles();
  }

  async open(licitacionId) {
    this.#overlay.classList.add('visible');
    document.body.style.overflow = 'hidden';
    document.getElementById('detalle-content').innerHTML = `
      <div class="loader" style="padding:4rem"><div class="spinner"></div></div>
    `;

    try {
      const lic = await this.#api.getLicitacion(licitacionId);
      this.#licitacionActual = lic;
      await this.#checkFavorito(licitacionId);
      this.#renderDetalle(lic);
    } catch (err) {
      document.getElementById('detalle-content').innerHTML = `
        <div style="padding:2rem;text-align:center;color:var(--color-muted)">
          <div style="font-size:2.5rem;margin-bottom:1rem">⚠️</div>
          <p>No se pudo cargar la licitación.</p>
          <p style="font-size:0.85rem;margin-top:0.5rem">${err.message}</p>
        </div>
      `;
    }
  }

  close() {
    this.#overlay.classList.remove('visible');
    document.body.style.overflow = '';
    this.#licitacionActual = null;
  }

  async #checkFavorito(id) {
    try {
      const favs = await this.#api.getFavoritos();
      this.#favoritoActivo = favs.some(f => f.licitaciones?.id === id);
    } catch {
      this.#favoritoActivo = false;
    }
  }

  #renderDetalle(lic) {
    const diasRestantes = lic.fecha_cierre
      ? Math.ceil((new Date(lic.fecha_cierre) - new Date()) / 86400000)
      : null;

    let diasColor = 'var(--color-success)', diasLabel = '—';
    if (diasRestantes !== null) {
      if (diasRestantes <= 0) { diasLabel = 'Cerrada'; diasColor = 'var(--color-muted)'; }
      else if (diasRestantes <= 3) { diasLabel = `${diasRestantes} días`; diasColor = 'var(--color-danger)'; }
      else if (diasRestantes <= 7) { diasLabel = `${diasRestantes} días`; diasColor = 'var(--color-warning)'; }
      else { diasLabel = `${diasRestantes} días`; }
    }

    const presupuesto = lic.presupuesto_estimado
      ? `$${Number(lic.presupuesto_estimado).toLocaleString('es-AR')}`
      : 'A confirmar';

    const pub = lic.fecha_publicacion
      ? new Date(lic.fecha_publicacion + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })
      : '—';
    const cierre = lic.fecha_cierre
      ? new Date(lic.fecha_cierre + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })
      : '—';

    document.getElementById('detalle-content').innerHTML = `
      <!-- Encabezado -->
      <div id="detalle-header">
        <button id="detalle-close-btn" aria-label="Cerrar">✕</button>
        <div id="detalle-fuente">${lic.fuente || 'Fuente oficial'}</div>
        <h2 id="detalle-titulo">${lic.titulo}</h2>
        <div id="detalle-organismo">🏛 ${lic.organismo || 'Organismo no especificado'}</div>

        <div id="detalle-tags" style="margin-top:1rem;display:flex;flex-wrap:wrap;gap:0.5rem">
          ${lic.rubro ? `<span class="card-tag">${lic.rubro}</span>` : ''}
          ${lic.provincia ? `<span class="card-tag">📍 ${lic.provincia}</span>` : ''}
        </div>
      </div>

      <!-- Métricas -->
      <div id="detalle-metricas">
        <div class="detalle-metrica">
          <div class="detalle-metrica-valor" style="color:var(--color-gold)">${presupuesto}</div>
          <div class="detalle-metrica-label">Presupuesto estimado</div>
        </div>
        <div class="detalle-metrica">
          <div class="detalle-metrica-valor" style="color:${diasColor}">${diasLabel}</div>
          <div class="detalle-metrica-label">Para el cierre</div>
        </div>
        <div class="detalle-metrica">
          <div class="detalle-metrica-valor">${pub}</div>
          <div class="detalle-metrica-label">Publicada</div>
        </div>
        <div class="detalle-metrica">
          <div class="detalle-metrica-valor">${cierre}</div>
          <div class="detalle-metrica-label">Fecha de cierre</div>
        </div>
      </div>

      <!-- Descripción -->
      ${lic.descripcion ? `
        <div class="detalle-seccion">
          <h3 class="detalle-seccion-titulo">Descripción</h3>
          <p class="detalle-seccion-texto">${lic.descripcion}</p>
        </div>
      ` : ''}

      <!-- Acciones -->
      <div id="detalle-acciones">
        <button id="detalle-fav-btn" class="btn ${this.#favoritoActivo ? 'btn-primary' : 'btn-outline'}">
          ${this.#favoritoActivo ? '★ En favoritos' : '☆ Guardar en favoritos'}
        </button>
        ${lic.url_original ? `
          <a href="${lic.url_original}" target="_blank" rel="noopener noreferrer" class="btn btn-outline">
            Ver pliego oficial ↗
          </a>
        ` : ''}
      </div>
    `;

    // Cerrar
    document.getElementById('detalle-close-btn').addEventListener('click', () => this.close());

    // Toggle favorito
    document.getElementById('detalle-fav-btn').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        if (this.#favoritoActivo) {
          await this.#api.removeFavorito(lic.id);
          this.#favoritoActivo = false;
          btn.className = 'btn btn-outline';
          btn.textContent = '☆ Guardar en favoritos';
        } else {
          await this.#api.addFavorito(lic.id);
          this.#favoritoActivo = true;
          btn.className = 'btn btn-primary';
          btn.textContent = '★ En favoritos';
        }
      } catch (err) {
        console.error('Error al toggling favorito:', err);
      } finally {
        btn.disabled = false;
      }
    });
  }

  #injectStyles() {
    if (document.getElementById('detalle-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'detalle-modal-styles';
    style.textContent = `
      #detalle-overlay {
        position: fixed;
        inset: 0;
        z-index: 500;
        background: rgba(0,0,0,0.65);
        backdrop-filter: blur(4px);
        display: flex;
        justify-content: flex-end;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.25s ease;
      }
      #detalle-overlay.visible {
        opacity: 1;
        pointer-events: all;
      }
      #detalle-panel {
        width: min(580px, 100vw);
        height: 100%;
        background: var(--color-surface);
        border-left: 1px solid var(--color-border);
        overflow-y: auto;
        transform: translateX(100%);
        transition: transform 0.3s cubic-bezier(0.4,0,0.2,1);
        display: flex;
        flex-direction: column;
      }
      #detalle-overlay.visible #detalle-panel {
        transform: translateX(0);
      }
      #detalle-content {
        flex: 1;
        display: flex;
        flex-direction: column;
      }
      #detalle-header {
        padding: 2rem 2rem 1.5rem;
        border-bottom: 1px solid var(--color-border);
        position: relative;
      }
      #detalle-close-btn {
        position: absolute;
        top: 1.25rem;
        right: 1.25rem;
        background: var(--color-surface2);
        border: 1px solid var(--color-border);
        color: var(--color-muted);
        width: 32px; height: 32px;
        border-radius: 50%;
        cursor: pointer;
        font-size: 0.9rem;
        display: flex; align-items: center; justify-content: center;
        transition: all 0.15s ease;
      }
      #detalle-close-btn:hover {
        color: var(--color-text);
        border-color: var(--color-text);
      }
      #detalle-fuente {
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--color-gold);
        font-weight: 700;
        margin-bottom: 0.75rem;
      }
      #detalle-titulo {
        font-size: 1.3rem;
        line-height: 1.35;
        margin-bottom: 0.5rem;
        padding-right: 2.5rem;
      }
      #detalle-organismo {
        font-size: 0.875rem;
        color: var(--color-muted);
      }
      #detalle-metricas {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1px;
        background: var(--color-border);
        border-top: 1px solid var(--color-border);
        border-bottom: 1px solid var(--color-border);
      }
      .detalle-metrica {
        padding: 1.25rem 1.5rem;
        background: var(--color-surface2);
      }
      .detalle-metrica-valor {
        font-family: var(--font-display);
        font-size: 1.15rem;
        font-weight: 700;
        margin-bottom: 0.25rem;
        color: var(--color-text);
      }
      .detalle-metrica-label {
        font-size: 0.75rem;
        color: var(--color-muted);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        font-weight: 600;
      }
      .detalle-seccion {
        padding: 1.5rem 2rem;
        border-bottom: 1px solid var(--color-border);
      }
      .detalle-seccion-titulo {
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--color-muted);
        font-weight: 700;
        margin-bottom: 0.75rem;
        font-family: var(--font-body);
      }
      .detalle-seccion-texto {
        font-size: 0.9rem;
        line-height: 1.7;
        color: var(--color-text);
        white-space: pre-wrap;
      }
      #detalle-acciones {
        padding: 1.5rem 2rem;
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
        margin-top: auto;
        border-top: 1px solid var(--color-border);
        background: var(--color-surface);
        position: sticky;
        bottom: 0;
      }
      @media (max-width: 600px) {
        #detalle-metricas { grid-template-columns: 1fr 1fr; }
        #detalle-acciones { flex-direction: column; }
        #detalle-acciones .btn { width: 100%; justify-content: center; }
      }
    `;
    document.head.appendChild(style);
  }
}
