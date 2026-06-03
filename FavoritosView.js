/**
 * FavoritosView — muestra la lista de licitaciones guardadas como favoritas
 * Se carga de forma lazy cuando el usuario entra a la sección de favoritos
 */
export class FavoritosView {
  #api;
  #container;

  constructor(apiService, containerId) {
    this.#api = apiService;
    this.#container = document.getElementById(containerId);
  }

  async init() {
    await this.#loadFavoritos();
  }

  async #loadFavoritos() {
    this.#container.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div></div>';

    try {
      const favoritos = await this.#api.getFavoritos();
      this.#render(favoritos);
    } catch (err) {
      this.#container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">★</div>
          <div class="empty-title">No pudimos cargar favoritos</div>
          <p>${err.message}</p>
        </div>`;
    }
  }

  #render(favoritos) {
    if (!favoritos.length) {
      this.#container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">★</div>
          <div class="empty-title">No tenés favoritos aún</div>
          <p>Guardá licitaciones con el ícono de estrella para encontrarlas acá fácilmente</p>
        </div>
      `;
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'lic-grid';

    favoritos.forEach(fav => {
      const lic = fav.licitaciones;
      if (!lic) return;

      const card = document.createElement('div');
      card.className = 'lic-card';

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
          <div class="lic-title">${this.#esc(lic.titulo)}</div>
          <button class="lic-fav-btn active" data-id="${lic.id}" title="Quitar de favoritos">★</button>
        </div>
        <div class="lic-organismo">${this.#esc(lic.organismo || '—')}</div>
        <div class="lic-meta" style="margin-top:0.5rem">
          ${lic.rubro ? `<span class="card-tag">${this.#esc(lic.rubro)}</span>` : ''}
          ${lic.provincia ? `<span class="card-tag">📍 ${this.#esc(lic.provincia)}</span>` : ''}
        </div>
        <div class="lic-footer">
          <span class="lic-presupuesto">${presupuesto}</span>
          ${diasLabel ? `<span class="lic-dias ${diasClass}">⏱ ${diasLabel}</span>` : ''}
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.lic-fav-btn')) return;
        document.dispatchEvent(new CustomEvent('licitia:ver-licitacion', {
          detail: { id: lic.id, lic },
        }));
      });

      // Quitar favorito
      card.querySelector('.lic-fav-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await this.#api.removeFavorito(lic.id);
          card.remove();
          // Si no quedan más, mostrar empty state
          if (!grid.children.length) {
            this.#container.innerHTML = `
              <div class="empty-state">
                <div class="empty-icon">★</div>
                <div class="empty-title">No tenés favoritos aún</div>
                <p>Guardá licitaciones con el ícono de estrella para encontrarlas acá</p>
              </div>
            `;
          }
        } catch (err) {
          console.error('Error al quitar favorito:', err);
        }
      });

      grid.appendChild(card);
    });

    this.#container.innerHTML = `<p class="section-sub" style="margin-bottom:1rem">${favoritos.length} licitación${favoritos.length !== 1 ? 'es' : ''} guardada${favoritos.length !== 1 ? 's' : ''}</p>`;
    this.#container.appendChild(grid);
  }

  #esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async refresh() {
    await this.#loadFavoritos();
  }
}
