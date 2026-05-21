/**
 * LicitacionesView — renderiza y gestiona la lista de licitaciones
 * con búsqueda, filtros, paginación y favoritos
 */
export class LicitacionesView {
  #api;
  #container;
  #currentPage;
  #totalPaginas;
  #favoritos;
  #filters;

  constructor(apiService, containerId) {
    this.#api = apiService;
    this.#container = document.getElementById(containerId);
    this.#currentPage = 1;
    this.#totalPaginas = 1;
    this.#favoritos = new Set();
    this.#filters = { q: '', rubro: '', provincia: '' };

    this.#render();
    this.#attachEvents();
  }

  async init() {
    await this.#loadFavoritos();
    await this.#fetchAndRender();
  }

  async #loadFavoritos() {
    try {
      const data = await this.#api.getFavoritos();
      this.#favoritos = new Set(data.map(f => f.licitaciones?.id).filter(Boolean));
    } catch {
      this.#favoritos = new Set();
    }
  }

  #render() {
    this.#container.innerHTML = `
      <div class="section-header">
        <div>
          <h2 class="section-title">Licitaciones</h2>
          <p class="section-subtitle">Oportunidades activas compatibles con tu perfil</p>
        </div>
      </div>

      <div class="search-bar">
        <input id="lic-search" class="form-control" type="search" placeholder="Buscar por título o descripción…" />
        <button id="lic-search-btn" class="btn btn-primary">Buscar</button>
      </div>

      <div class="filters-row">
        <select id="lic-filter-rubro" class="form-control">
          <option value="">Todos los rubros</option>
          <option value="limpieza">Limpieza</option>
          <option value="catering">Catering y alimentos</option>
          <option value="tecnología">Tecnología e informática</option>
          <option value="construcción">Construcción y obras</option>
          <option value="transporte">Transporte y logística</option>
          <option value="salud">Salud e insumos médicos</option>
          <option value="seguridad">Seguridad</option>
          <option value="consultoría">Consultoría y servicios profesionales</option>
        </select>
        <select id="lic-filter-provincia" class="form-control">
          <option value="">Todas las provincias</option>
          <option value="Buenos Aires">Buenos Aires</option>
          <option value="CABA">CABA</option>
          <option value="Córdoba">Córdoba</option>
          <option value="Santa Fe">Santa Fe</option>
          <option value="Mendoza">Mendoza</option>
          <option value="Tucumán">Tucumán</option>
          <option value="Rosario">Rosario</option>
        </select>
        <button id="lic-clear-filters" class="btn btn-ghost btn-sm">Limpiar filtros</button>
      </div>

      <div id="lic-list-container">
        <div class="loader"><div class="spinner"></div></div>
      </div>

      <div id="lic-pagination" class="pagination"></div>
    `;
  }

  #attachEvents() {
    this.#container.querySelector('#lic-search-btn').addEventListener('click', () => {
      this.#filters.q = this.#container.querySelector('#lic-search').value.trim();
      this.#currentPage = 1;
      this.#fetchAndRender();
    });

    this.#container.querySelector('#lic-search').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.#filters.q = e.target.value.trim();
        this.#currentPage = 1;
        this.#fetchAndRender();
      }
    });

    this.#container.querySelector('#lic-filter-rubro').addEventListener('change', (e) => {
      this.#filters.rubro = e.target.value;
      this.#currentPage = 1;
      this.#fetchAndRender();
    });

    this.#container.querySelector('#lic-filter-provincia').addEventListener('change', (e) => {
      this.#filters.provincia = e.target.value;
      this.#currentPage = 1;
      this.#fetchAndRender();
    });

    this.#container.querySelector('#lic-clear-filters').addEventListener('click', () => {
      this.#filters = { q: '', rubro: '', provincia: '' };
      this.#container.querySelector('#lic-search').value = '';
      this.#container.querySelector('#lic-filter-rubro').value = '';
      this.#container.querySelector('#lic-filter-provincia').value = '';
      this.#currentPage = 1;
      this.#fetchAndRender();
    });

    // Escuchar evento de navegación desde popup WebSocket
    document.addEventListener('licitia:ver-licitacion', (e) => {
      const { id } = e.detail;
      this.#showDetail(id);
    });
  }

  async #fetchAndRender() {
    const listContainer = document.getElementById('lic-list-container');
    listContainer.innerHTML = '<div class="loader"><div class="spinner"></div></div>';

    try {
      const data = await this.#api.getLicitaciones({
        ...this.#filters,
        page: this.#currentPage,
        limit: 12,
      });

      this.#totalPaginas = data.totalPaginas;
      this.#renderCards(data.licitaciones, listContainer, data.total);
      this.#renderPaginacion();
    } catch (err) {
      listContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⚠️</div>
          <h3>Error al cargar licitaciones</h3>
          <p>${err.message}</p>
          <button class="btn btn-outline" id="retry-btn" style="margin-top:1rem">Reintentar</button>
        </div>
      `;
      document.getElementById('retry-btn')?.addEventListener('click', () => this.#fetchAndRender());
    }
  }

  #renderCards(licitaciones, container, total) {
    if (!licitaciones || licitaciones.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🔍</div>
          <h3>No encontramos licitaciones</h3>
          <p>Probá con otros filtros o actualizá tu perfil de empresa</p>
        </div>
      `;
      return;
    }

    const totalEl = `<p class="section-subtitle" style="margin-bottom:1rem">${total} resultado${total !== 1 ? 's' : ''} encontrado${total !== 1 ? 's' : ''}</p>`;
    const grid = document.createElement('div');
    grid.className = 'licitacion-grid';

    licitaciones.forEach(lic => {
      const card = this.#createCard(lic);
      grid.appendChild(card);
    });

    container.innerHTML = totalEl;
    container.appendChild(grid);
  }

  #createCard(lic) {
    const card = document.createElement('div');
    card.className = 'lic-card';
    card.dataset.id = lic.id;

    const isFav = this.#favoritos.has(lic.id);
    const diasRestantes = lic.fecha_cierre
      ? Math.ceil((new Date(lic.fecha_cierre) - new Date()) / 86400000)
      : null;

    let diasClass = 'ok', diasLabel = '';
    if (diasRestantes !== null) {
      diasLabel = diasRestantes <= 0 ? 'Cerrada' : `${diasRestantes}d`;
      if (diasRestantes <= 3) diasClass = 'urgente';
      else if (diasRestantes <= 7) diasClass = 'pronto';
    }

    const presupuesto = lic.presupuesto_estimado
      ? `$${Number(lic.presupuesto_estimado).toLocaleString('es-AR')}`
      : 'A confirmar';

    card.innerHTML = `
      <div class="lic-card-top">
        <div class="lic-title">${lic.titulo}</div>
        <button class="lic-fav-btn ${isFav ? 'active' : ''}" 
                data-id="${lic.id}" 
                title="${isFav ? 'Quitar de favoritos' : 'Agregar a favoritos'}">
          ${isFav ? '★' : '☆'}
        </button>
      </div>
      <div class="lic-organismo">${lic.organismo || '—'}</div>
      <div class="lic-meta" style="margin-top:0.5rem">
        ${lic.rubro ? `<span class="card-tag">${lic.rubro}</span>` : ''}
        ${lic.provincia ? `<span class="card-tag">📍 ${lic.provincia}</span>` : ''}
      </div>
      <div class="lic-footer">
        <span class="lic-presupuesto">${presupuesto}</span>
        ${diasLabel ? `<span class="lic-dias ${diasClass}">⏱ ${diasLabel}</span>` : ''}
      </div>
    `;

    // Click en la card → detalle
    card.addEventListener('click', (e) => {
      if (!e.target.classList.contains('lic-fav-btn')) {
        this.#showDetail(lic.id);
      }
    });

    // Click en favorito
    card.querySelector('.lic-fav-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.#toggleFavorito(lic.id, card.querySelector('.lic-fav-btn'));
    });

    return card;
  }

  async #toggleFavorito(licitacionId, btn) {
    const isFav = this.#favoritos.has(licitacionId);
    try {
      if (isFav) {
        await this.#api.removeFavorito(licitacionId);
        this.#favoritos.delete(licitacionId);
        btn.textContent = '☆';
        btn.classList.remove('active');
        btn.title = 'Agregar a favoritos';
      } else {
        await this.#api.addFavorito(licitacionId);
        this.#favoritos.add(licitacionId);
        btn.textContent = '★';
        btn.classList.add('active');
        btn.title = 'Quitar de favoritos';
      }
    } catch (err) {
      console.error('Error al toggling favorito:', err);
    }
  }

  #showDetail(id) {
    document.dispatchEvent(new CustomEvent('licitia:navigate', { detail: { page: 'detalle', id } }));
  }

  #renderPaginacion() {
    const pag = document.getElementById('lic-pagination');
    pag.innerHTML = '';
    if (this.#totalPaginas <= 1) return;

    for (let i = 1; i <= this.#totalPaginas; i++) {
      const btn = document.createElement('button');
      btn.textContent = i;
      btn.className = `btn btn-sm ${i === this.#currentPage ? 'btn-primary' : 'btn-outline'}`;
      btn.addEventListener('click', () => {
        this.#currentPage = i;
        this.#fetchAndRender();
        document.getElementById('lic-list-container')?.scrollIntoView({ behavior: 'smooth' });
      });
      pag.appendChild(btn);
    }
  }

  // Método público para refrescar cuando llega una alerta WS
  refresh() {
    this.#fetchAndRender();
  }
}
