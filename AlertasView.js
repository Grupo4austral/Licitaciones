/**
 * AlertasView — panel de notificaciones/alertas del usuario
 */
export class AlertasView {
  #api;
  #container;

  constructor(apiService, containerId) {
    this.#api = apiService;
    this.#container = document.getElementById(containerId);
    this.#render();
  }

  async init() {
    await this.#loadAlertas();
  }

  #render() {
    this.#container.innerHTML = `
      <div class="section-header">
        <div>
          <h2 class="section-title">Alertas</h2>
          <p class="section-sub">Notificaciones de licitaciones que coinciden con tu perfil</p>
        </div>
        <button id="marcar-todas-btn" class="btn btn-ghost btn-sm">Marcar todas como leídas</button>
      </div>

      <div style="display:flex;gap:0.75rem;margin-bottom:1.5rem">
        <button id="filter-todas" class="btn btn-primary btn-sm">Todas</button>
        <button id="filter-no-leidas" class="btn btn-outline btn-sm">Sin leer</button>
      </div>

      <div id="alertas-list">
        <div class="spinner-wrap"><div class="spinner"></div></div>
      </div>
    `;

    document.getElementById('marcar-todas-btn').addEventListener('click', async () => {
      await this.#api.marcarTodasLeidas();
      this.#loadAlertas();
      document.dispatchEvent(new CustomEvent('licitia:alertas-actualizadas'));
    });

    document.getElementById('filter-todas').addEventListener('click', () => {
      this.#loadAlertas(false);
      document.getElementById('filter-todas').className = 'btn btn-primary btn-sm';
      document.getElementById('filter-no-leidas').className = 'btn btn-outline btn-sm';
    });

    document.getElementById('filter-no-leidas').addEventListener('click', () => {
      this.#loadAlertas(true);
      document.getElementById('filter-todas').className = 'btn btn-outline btn-sm';
      document.getElementById('filter-no-leidas').className = 'btn btn-primary btn-sm';
    });
  }

  async #loadAlertas(soloNoLeidas = false) {
    const list = document.getElementById('alertas-list');
    list.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div></div>';

    try {
      const alertas = await this.#api.getAlertas(soloNoLeidas);
      this.#renderAlertas(alertas, list);
    } catch (err) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔔</div>
          <div class="empty-title">No pudimos cargar alertas</div>
          <p>${err.message}</p>
        </div>`;
    }
  }

  #renderAlertas(alertas, container) {
    if (!alertas.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔔</div>
          <div class="empty-title">Sin alertas por ahora</div>
          <p>Cuando aparezca una licitación compatible con tu perfil, te avisamos acá</p>
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    alertas.forEach(alerta => {
      const item = document.createElement('div');
      item.className = `alerta-item ${alerta.leida ? 'leida' : 'no-leida'}`;

      const fecha = new Date(alerta.creado_en).toLocaleDateString('es-AR', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });

      item.innerHTML = `
        <div class="alerta-item-dot"></div>
        <div style="flex:1">
          <div style="font-size:0.9rem;font-weight:${alerta.leida ? '400' : '600'};margin-bottom:0.25rem">
            ${alerta.mensaje}
          </div>
          ${alerta.licitaciones ? `
            <div style="font-size:0.8rem;color:var(--color-muted)">
              ${alerta.licitaciones.organismo || ''} · 
              ${alerta.licitaciones.rubro || ''} · 
              Cierra: ${alerta.licitaciones.fecha_cierre || '—'}
            </div>
          ` : ''}
          <div style="font-size:0.75rem;color:var(--color-muted);margin-top:0.25rem">${fecha}</div>
        </div>
        <div style="display:flex;gap:0.5rem;align-items:flex-start;flex-shrink:0">
          ${!alerta.leida ? `<button class="btn btn-ghost btn-sm marcar-leida-btn" data-id="${alerta.id}">Marcar leída</button>` : ''}
          ${alerta.licitaciones ? `<button class="btn btn-outline btn-sm ver-lic-btn" data-id="${alerta.licitaciones.id}">Ver</button>` : ''}
        </div>
      `;

      item.querySelector('.marcar-leida-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.#api.marcarLeida(alerta.id);
        this.#loadAlertas();
        document.dispatchEvent(new CustomEvent('licitia:alertas-actualizadas'));
      });

      item.querySelector('.ver-lic-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        document.dispatchEvent(new CustomEvent('licitia:navigate', {
          detail: { page: 'detalle', id: alerta.licitaciones.id }
        }));
      });

      container.appendChild(item);
    });
  }

  // Método público para refrescar cuando llega WS
  async refresh() {
    await this.#loadAlertas();
  }
}
