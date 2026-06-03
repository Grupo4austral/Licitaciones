/**
 * LicitacionesView — renderiza la lista de licitaciones.
 *
 * ESTRATEGIA DE DATOS:
 *   1. Intenta cargar desde el backend propio (/api/licitaciones)
 *   2. Si la base local está vacía, consulta /api/licitaciones/externas
 *      para traer oportunidades actuales desde COMPR.AR.
 *   3. Si el backend no está disponible, hace fallback directo a datos.gob.ar.
 */
export class LicitacionesView {
  #api;
  #container;
  #currentPage;
  #totalPaginas;
  #favoritos;
  #favoritoIdPorExterno;
  #filters;
  #perfilEmpresa;

  // Resource ID del dataset de contrataciones ONC en datos.gob.ar
  static #CKAN_URL = 'https://datos.gob.ar/api/3/action/datastore_search';
  static #RESOURCE_ID = 'fd9a6c4c-0b47-4ca4-8f08-a2e0d75c3c63';

  constructor(apiService, containerId) {
    this.#api          = apiService;
    this.#container    = document.getElementById(containerId);
    this.#currentPage  = 1;
    this.#totalPaginas = 1;
    this.#favoritos    = new Set();
    this.#favoritoIdPorExterno = new Map();
    this.#filters      = { q: '', rubro: '', provincia: '', orden: 'match' };
    this.#perfilEmpresa = null;

    this.#renderShell();
    this.#attachEvents();
  }

  async init() {
    await this.#loadFavoritos();
    await this.#loadPerfilEmpresa();
    await this.#fetchAndRender();
  }

  async refresh() {
    await this.#fetchAndRender();
  }

  // ── Favoritos ──────────────────────────────────────────────────────────────

  async #loadFavoritos() {
    try {
      const data = await this.#api.getFavoritos();
      this.#favoritos = new Set();
      this.#favoritoIdPorExterno = new Map();

      data.forEach((fav) => {
        const lic = fav.licitaciones;
        if (!lic?.id) return;
        this.#favoritos.add(String(lic.id));

        const claves = [
          lic.numero_proceso,
          lic.datos_originales?.numero_proceso,
          lic.datos_originales?.external_id,
          lic.url_original,
        ].filter(Boolean).map(String);

        claves.forEach((clave) => {
          this.#favoritos.add(clave);
          this.#favoritoIdPorExterno.set(clave, String(lic.id));
        });
      });
    } catch {
      this.#favoritos = new Set();
      this.#favoritoIdPorExterno = new Map();
    }
  }

  async #loadPerfilEmpresa() {
    try {
      this.#perfilEmpresa = await this.#api.getPerfil();
    } catch {
      this.#perfilEmpresa = null;
    }
  }

  // ── Shell del componente ───────────────────────────────────────────────────

  #renderShell() {
    this.#container.innerHTML = `
      <div class="section-head">
        <div>
          <div class="section-title">Licitaciones</div>
          <div class="section-sub" id="lic-sub">Buscando licitaciones…</div>
        </div>
        <div id="lic-fuente-badge"></div>
      </div>

      <div class="search-bar">
        <input id="lic-keyword" class="input" type="search" placeholder="Palabra clave: alimentos, limpieza, mantenimiento, cámaras…" />
        <select id="lic-rubro" class="input" style="flex:0 1 200px">
          <option value="">Todos los rubros</option>
          <option value="limpieza">Limpieza</option>
          <option value="tecnolog">Tecnología</option>
          <option value="construccion">Construcción</option>
          <option value="transporte">Transporte</option>
          <option value="salud">Salud</option>
          <option value="alimentos">Alimentos / Catering</option>
          <option value="seguridad">Seguridad</option>
          <option value="consultoria">Consultoría</option>
        </select>
        <select id="lic-orden" class="input" style="flex:0 1 190px">
          <option value="match">Mayor puntaje IA</option>
          <option value="recientes">Más recientes</option>
        </select>
        <button id="lic-search-btn" class="btn btn-primary">Buscar</button>
        <button id="lic-clear-btn" class="btn btn-ghost">Limpiar</button>
      </div>

      <div id="lic-list"></div>
      <div id="lic-pag" class="pagination"></div>
    `;
  }

  #attachEvents() {
    this.#container.querySelector('#lic-search-btn').addEventListener('click', () => {
      this.#filters.q     = this.#buildSearchQuery();
      this.#filters.rubro = this.#container.querySelector('#lic-rubro').value;
      this.#filters.orden = this.#container.querySelector('#lic-orden').value;
      this.#currentPage   = 1;
      this.#fetchAndRender();
    });

    this.#container.querySelector('#lic-keyword').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      this.#filters.q     = this.#buildSearchQuery();
      this.#filters.rubro = this.#container.querySelector('#lic-rubro').value;
      this.#filters.orden = this.#container.querySelector('#lic-orden').value;
      this.#currentPage   = 1;
      this.#fetchAndRender();
    });

    this.#container.querySelector('#lic-rubro').addEventListener('change', (e) => {
      this.#filters.rubro = e.target.value;
      this.#currentPage   = 1;
      this.#fetchAndRender();
    });

    this.#container.querySelector('#lic-orden').addEventListener('change', (e) => {
      this.#filters.orden = e.target.value;
      this.#currentPage   = 1;
      this.#fetchAndRender();
    });

    // Delegated click en #lic-list para el botón "Reintentar"
    this.#container.addEventListener('click', e => {
      if (e.target.id === 'lic-retry-btn') this.#fetchAndRender();
    });

    this.#container.querySelector('#lic-clear-btn').addEventListener('click', () => {
      this.#filters = { q: '', rubro: '', provincia: '', orden: 'match' };
      this.#container.querySelector('#lic-keyword').value = '';
      this.#container.querySelector('#lic-rubro').value  = '';
      this.#container.querySelector('#lic-orden').value  = 'match';
      this.#currentPage = 1;
      this.#fetchAndRender();
    });
  }

  #buildSearchQuery() {
    return this.#container.querySelector('#lic-keyword')?.value.trim() || '';
  }

  // ── Carga de datos ─────────────────────────────────────────────────────────

  async #fetchAndRender() {
    const list = document.getElementById('lic-list');
    list.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div></div>';
    document.getElementById('lic-pag').innerHTML = '';

    // La pantalla principal prioriza COMPR.AR en vivo para no quedarse con
    // licitaciones antiguas o incompletas guardadas en Supabase.
    let resultado = null;
    let fuente    = 'comprar';

    try {
      resultado = await this.#fetchExternas();
    } catch (errExternas) {
      console.warn('[LicitacionesView] No se pudo consultar COMPR.AR, usando base local:', errExternas.message);
      try {
        resultado = await this.#fetchDesdeBackend();
        fuente = 'backend';
      } catch (errBackend) {
        console.warn('[LicitacionesView] Backend local no disponible, usando datos.gob.ar:', errBackend.message);
        try {
          resultado = await this.#fetchDesdeCKAN();
          fuente    = 'ckan';
        } catch (errCKAN) {
          list.innerHTML = this.#tplError(errCKAN.message);
          return;
        }
      }
    }

    const visibles = this.#ordenarLicitaciones(
      this.#enriquecerConMatch(
        this.#filtrarPorTexto(
          this.#filtrarPorPresupuesto(
            this.#filtrarVigentes(resultado.licitaciones)
          )
        )
      )
    );
    this.#totalPaginas = resultado.totalPaginas || 1;
    this.#actualizarSubtitulo(visibles.length, fuente);
    this.#renderCards(visibles, list);
    this.#renderPaginacion();
  }

  #filtrarPorPresupuesto(licitaciones) {
    const max = Number(this.#container.querySelector('#lic-presupuesto')?.value || 0);
    if (!max) return licitaciones;
    return (licitaciones || []).filter(lic => {
      if (!lic.presupuesto_estimado) return true;
      return Number(lic.presupuesto_estimado) <= max;
    });
  }

  #filtrarPorTexto(licitaciones) {
    const q = this.#normalizar(this.#filters.q);
    const rubro = this.#normalizar(this.#filters.rubro);
    return (licitaciones || []).filter((lic) => {
      const texto = this.#normalizar([
        lic.titulo,
        lic.descripcion,
        lic.rubro,
        lic.organismo,
        lic.provincia,
      ].filter(Boolean).join(' '));
      const coincideKeyword = !q || q.split(/\s+/).filter(Boolean).every((word) => texto.includes(word));
      const coincideRubro = !rubro || texto.includes(rubro);
      return coincideKeyword && coincideRubro;
    });
  }

  #filtrarVigentes(licitaciones) {
    const hoy = this.#fechaLocalISO(new Date());
    return (licitaciones || []).filter(lic => !lic.fecha_cierre || lic.fecha_cierre >= hoy);
  }

  #enriquecerConMatch(licitaciones) {
    return (licitaciones || [])
      .map((lic) => {
        const insight = this.#calcularInsight(lic);
        return {
          ...lic,
          ia_match: insight.score,
          ia_motivo: insight.motivo,
          ia_explicacion: insight.explicacion,
          ia_criterios: insight.criterios,
        };
      });
  }

  #ordenarLicitaciones(licitaciones) {
    const orden = this.#filters.orden || 'match';
    return [...(licitaciones || [])].sort((a, b) => {
      if (orden === 'recientes') {
        return this.#fechaOrdenable(b) - this.#fechaOrdenable(a);
      }
      return (b.ia_match || 0) - (a.ia_match || 0);
    });
  }

  #fechaOrdenable(lic) {
    const fecha = lic.fecha_publicacion || lic.fecha_cierre;
    const time = fecha ? new Date(`${fecha}T00:00:00`).getTime() : 0;
    return Number.isFinite(time) ? time : 0;
  }

  #favoriteKey(lic) {
    return this.#favoriteKeys(lic)[0] || '';
  }

  #favoriteKeys(lic) {
    return [
      lic?.url_original,
      lic?.numero_proceso,
      lic?.datos_originales?.numero_proceso,
      lic?.datos_originales?.external_id,
      lic?.id,
    ].filter(Boolean).map(String);
  }

  #diasRestantes(fecha) {
    if (!fecha) return null;
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const cierre = new Date(`${fecha}T00:00:00`);
    return Math.ceil((cierre - hoy) / 86_400_000);
  }

  #fechaLocalISO(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /** Llama al backend de LicitIA */
  async #fetchDesdeBackend() {
    const LIMIT = 500;
    const data  = await this.#api.getLicitaciones({
      q:        this.#filters.q,
      rubro:    this.#filters.rubro,
      provincia: this.#filters.provincia,
      page:     this.#currentPage,
      limit:    LIMIT,
    });
    return {
      licitaciones: data.licitaciones || [],
      total:        data.total || 0,
      totalPaginas: data.totalPaginas || 1,
    };
  }

  /** Llama al backend para traer oportunidades actuales desde COMPR.AR */
  async #fetchExternas() {
    const LIMIT = 500;
    const data = await this.#api.getLicitacionesExternas({
      q: this.#filters.q || this.#filters.rubro,
      limit: LIMIT,
    });

    return {
      licitaciones: (data.licitaciones || []).map((lic) => ({
        id: lic.id || lic.numero_proceso || lic.url_original,
        ...lic,
      })),
      total: data.total || 0,
      totalPaginas: 1,
    };
  }

  /** Fallback: llama directamente a la API pública de datos.gob.ar (CKAN/ONC) */
  async #fetchDesdeCKAN() {
    const LIMIT  = 500;
    const offset = (this.#currentPage - 1) * LIMIT;

    const params = new URLSearchParams({
      resource_id: LicitacionesView.#RESOURCE_ID,
      limit:       LIMIT,
      offset,
      sort:        'fecha_publicacion_convocatoria desc',
    });

    // La búsqueda libre se pasa como parámetro q a CKAN
    if (this.#filters.q)    params.set('q', this.#filters.q);
    if (this.#filters.rubro) params.set('q', this.#filters.rubro);

    const res = await fetch(`${LicitacionesView.#CKAN_URL}?${params}`);
    if (!res.ok) throw new Error(`datos.gob.ar respondió con HTTP ${res.status}`);

    const json = await res.json();
    if (!json.success) throw new Error('La API de datos.gob.ar devolvió un error');

    const records = json.result?.records || [];
    const total   = json.result?.total   || 0;

    // Transformar al mismo esquema que usa el backend
    const licitaciones = records.map(r => ({
      id:                   String(r._id),
      titulo:               r.nombre_procedimiento || r.descripcion_objeto || `Proceso de contratación #${r._id}`,
      organismo:            r.organismo_nombre || r.unidad_operativa_contrataciones_nombre || null,
      descripcion:          r.descripcion_objeto || null,
      rubro:                r.rubro_nombre || r.descripcion_tipo_procedimiento || null,
      provincia:            r.provincia_nombre || r.jurisdiccion_nombre || null,
      fecha_publicacion:    r.fecha_publicacion_convocatoria || null,
      fecha_cierre:         r.fecha_apertura_convocatoria || null,
      presupuesto_estimado: parseFloat(r.monto_total_adjudicado || 0) || null,
      url_original:         `https://comprar.gob.ar/proceso/${r._id}`,
    }));

    return {
      licitaciones,
      total,
      totalPaginas: Math.ceil(total / LIMIT),
    };
  }

  // ── Render de cards ────────────────────────────────────────────────────────

  #renderCards(licitaciones, container) {
    if (!licitaciones || licitaciones.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <div class="empty-title">No encontramos licitaciones</div>
          <p>Probá con otros términos de búsqueda o limpiá los filtros.</p>
        </div>`;
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'lic-grid';
    licitaciones.forEach(lic => grid.appendChild(this.#crearCard(lic)));

    container.innerHTML = '';
    container.appendChild(grid);
  }

  #crearCard(lic) {
    const card  = document.createElement('div');
    card.className = 'lic-card';

    const favKeys = this.#favoriteKeys(lic);
    const isFav = favKeys.some((key) => this.#favoritos.has(key));
    const insight = lic.ia_match ? {
      score: lic.ia_match,
      motivo: lic.ia_motivo,
      explicacion: lic.ia_explicacion,
      criterios: lic.ia_criterios,
    } : this.#calcularInsight(lic);
    const licConIA = {
      ...lic,
      ia_match: insight.score,
      ia_motivo: insight.motivo,
      ia_explicacion: insight.explicacion,
      ia_criterios: insight.criterios,
    };

    const diasRestantes = this.#diasRestantes(lic.fecha_cierre);

    let diasClass = 'ok', diasLabel = '';
    if (diasRestantes !== null) {
      if (diasRestantes < 0)  { diasLabel = 'Cerrada';           diasClass = 'closed'; }
      else if (diasRestantes === 0) { diasLabel = 'Hoy'; diasClass = 'urgent'; }
      else if (diasRestantes <= 3) { diasLabel = `${diasRestantes}d`; diasClass = 'urgent'; }
      else if (diasRestantes <= 7) { diasLabel = `${diasRestantes}d`; diasClass = 'warn';   }
      else                         { diasLabel = `${diasRestantes}d`; diasClass = 'ok';     }
    }

    const precio = lic.presupuesto_estimado
      ? `$${Number(lic.presupuesto_estimado).toLocaleString('es-AR')}`
      : 'A confirmar';

    card.innerHTML = `
      <div class="lic-card-top">
        <div class="lic-title">${this.#esc(lic.titulo)}</div>
        <button class="fav-btn ${isFav ? 'on' : ''}" data-id="${lic.id}" title="${isFav ? 'Quitar de favoritos' : 'Guardar'}">
          ${isFav ? '★' : '☆'}
        </button>
      </div>
      <div class="lic-org">${this.#esc(lic.organismo || '—')}</div>
      <div class="lic-tags">
        ${lic.rubro    ? `<span class="badge badge-blue">${this.#esc(lic.rubro)}</span>`       : ''}
        ${lic.provincia ? `<span class="badge badge-gray">📍 ${this.#esc(lic.provincia)}</span>` : ''}
      </div>
      <div class="match-row">
        <span class="match-score">${insight.score}% match</span>
        <span class="match-reason">${this.#esc(insight.motivo)}</span>
      </div>
      <div class="lic-tags">
        ${(insight.criterios || [])
          .filter((criterio) => criterio.puntos > 0)
          .sort((a, b) => b.puntos - a.puntos)
          .slice(0, 3)
          .map((criterio) => `<span class="badge badge-gray">${this.#esc(criterio.nombre)} +${criterio.puntos}</span>`)
          .join('')}
      </div>
      <div class="human-note">${this.#esc(insight.explicacion)}</div>
      <div class="lic-footer">
        <span class="lic-price">${precio}</span>
        ${diasLabel ? `<span class="lic-days ${diasClass}">⏱ ${diasLabel}</span>` : ''}
      </div>
    `;

    // Click en la card → modal de detalle
    card.addEventListener('click', e => {
      if (!e.target.closest('.fav-btn')) {
        document.dispatchEvent(new CustomEvent('licitia:ver-licitacion', { detail: { id: lic.id, lic: licConIA } }));
      }
    });

    // Click en estrella → toggle favorito
    card.querySelector('.fav-btn').addEventListener('click', e => {
      e.stopPropagation();
      this.#toggleFavorito(licConIA, e.currentTarget);
    });

    return card;
  }

  async #toggleFavorito(lic, btn) {
    const licId = String(lic.id);
    const favKeys = this.#favoriteKeys(lic);
    const dbId = favKeys.map((key) => this.#favoritoIdPorExterno.get(key)).find(Boolean) ||
      this.#favoritoIdPorExterno.get(licId) ||
      licId;
    const isFav = favKeys.some((key) => this.#favoritos.has(key));
    btn.disabled = true;
    try {
      if (isFav) {
        await this.#api.removeFavorito(dbId);
        favKeys.forEach((key) => this.#favoritos.delete(key));
        this.#favoritos.delete(licId);
        this.#favoritos.delete(dbId);
        favKeys.forEach((key) => this.#favoritoIdPorExterno.delete(key));
        this.#favoritoIdPorExterno.delete(licId);
        btn.textContent = '☆';
        btn.classList.remove('on');
        btn.title = 'Guardar';
        document.dispatchEvent(new CustomEvent('licitia:favoritos-actualizados'));
      } else {
        const favorito = await this.#api.addFavorito(licId, lic);
        const nuevoDbId = favorito.licitacion_id || favorito.licitaciones?.id || licId;
        favKeys.forEach((key) => this.#favoritos.add(key));
        this.#favoritos.add(licId);
        this.#favoritos.add(String(nuevoDbId));
        favKeys.forEach((key) => this.#favoritoIdPorExterno.set(key, String(nuevoDbId)));
        this.#favoritoIdPorExterno.set(licId, String(nuevoDbId));
        btn.textContent = '★';
        btn.classList.add('on');
        btn.title = 'Quitar de favoritos';
        document.dispatchEvent(new CustomEvent('licitia:favoritos-actualizados'));
      }
    } catch (err) {
      console.warn('Error al cambiar favorito:', err.message);
      btn.title = err.message || 'No se pudo guardar favorito';
    } finally {
      btn.disabled = false;
    }
  }

  // ── Paginación ─────────────────────────────────────────────────────────────

  #renderPaginacion() {
    const pag = document.getElementById('lic-pag');
    pag.innerHTML = '';
    if (this.#totalPaginas <= 1) return;

    for (let i = 1; i <= Math.min(this.#totalPaginas, 8); i++) {
      const btn = document.createElement('button');
      btn.textContent = i;
      btn.className   = `btn btn-sm ${i === this.#currentPage ? 'btn-primary' : 'btn-outline'}`;
      btn.addEventListener('click', () => {
        this.#currentPage = i;
        this.#fetchAndRender();
        this.#container.scrollIntoView({ behavior: 'smooth' });
      });
      pag.appendChild(btn);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  #actualizarSubtitulo(total, fuente) {
    const sub   = document.getElementById('lic-sub');
    const badge = document.getElementById('lic-fuente-badge');
    const orden = this.#filters.orden === 'recientes' ? 'más recientes primero' : 'mayor puntaje IA primero';
    if (sub) sub.textContent = `${total?.toLocaleString('es-AR') || '—'} licitaciones encontradas · ${orden}`;
    if (badge) {
      badge.innerHTML = fuente === 'comprar'
        ? `<span class="badge badge-blue" title="Procesos actuales publicados en COMPR.AR">COMPR.AR actual</span>`
        : fuente === 'ckan'
        ? `<span class="badge badge-blue" title="Datos traídos directamente desde datos.gob.ar">📡 datos.gob.ar en vivo</span>`
        : `<span class="badge badge-green">✓ Base de datos local</span>`;
    }
  }

  #tplError(msg) {
    return `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <div class="empty-title">No se pudieron cargar las licitaciones</div>
        <p style="color:var(--ink-3);font-size:.875rem;margin-bottom:1rem">${this.#esc(msg)}</p>
        <button class="btn btn-outline" id="lic-retry-btn">Reintentar</button>
      </div>`;
    // El listener se agrega después del render
  }

  #esc(str) {
    return String(str || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  #calcularInsight(lic) {
    const texto = this.#normalizar([
      lic.titulo,
      lic.descripcion,
      lic.rubro,
      lic.organismo,
    ].filter(Boolean).join(' '));
    const perfil = this.#perfilEmpresa || {};
    const rubroPerfil = this.#normalizar(perfil.rubro || '');
    const descripcionPerfil = this.#normalizar(perfil.descripcion || '');
    const provinciaPerfil = this.#normalizar(perfil.provincia || '');
    const ciudadPerfil = this.#normalizar(perfil.ciudad || '');
    const palabrasPerfil = Array.isArray(perfil.palabras_clave)
      ? perfil.palabras_clave.map((word) => this.#normalizar(word)).filter((word) => word.length > 2)
      : [];
    const busqueda = this.#normalizar(this.#filters.q || this.#buildSearchQuery());

    const rubros = [
      ['limpieza', ['limpieza', 'sanitizacion', 'higiene'], 'Encaja con empresas de limpieza, mantenimiento o servicios generales.'],
      ['alimentos', ['alimento', 'catering', 'viveres', 'carne', 'insumo'], 'Puede ser relevante para proveedores de alimentos, catering o abastecimiento.'],
      ['tecnología', ['software', 'sistema', 'informatica', 'equipo', 'computadora'], 'Tiene señales compatibles con proveedores tecnológicos o de equipamiento.'],
      ['mantenimiento', ['mantenimiento', 'reparacion', 'servicio', 'repuestos'], 'Tiene buen encaje para empresas de mantenimiento, reparación o provisión de repuestos.'],
      ['construcción', ['obra', 'construccion', 'edilicio', 'materiales'], 'Puede aplicar a empresas de construcción, reformas o materiales.'],
      ['salud', ['medico', 'odontologico', 'hospital', 'sanidad'], 'Puede aplicar a proveedores de salud, insumos médicos o servicios hospitalarios.'],
    ];

    const detectados = rubros.filter(([, claves]) => claves.some((clave) => texto.includes(clave)));
    const dias = this.#diasRestantes(lic.fecha_cierre) ?? 10;
    const rubroTokens = rubroPerfil.split(/\s+/).filter((word) => word.length > 3);
    const descripcionTokens = descripcionPerfil.split(/\s+/).filter((word) => word.length > 4);
    const busquedaTokens = busqueda.split(/\s+/).filter((word) => word.length > 3);
    const rubroHits = rubroTokens.filter((word) => texto.includes(word));
    const keywordHits = palabrasPerfil.filter((word) => texto.includes(word));
    const descripcionHits = descripcionTokens.filter((word) => texto.includes(word)).slice(0, 5);
    const busquedaHits = busquedaTokens.filter((word) => texto.includes(word));
    const zonaHit = Boolean((provinciaPerfil && texto.includes(provinciaPerfil)) || (ciudadPerfil && texto.includes(ciudadPerfil)));
    const ubicacionDetectada = this.#extraerUbicacion(lic);
    const tipoFuerte = /licitacion publica|licitación pública|licitacion privada|licitación privada|contratacion directa|contratación directa/.test(texto);

    const criterios = [
      {
        nombre: 'Rubro de la empresa',
        peso: 35,
        puntos: rubroHits.length ? 35 : detectados.length ? 18 : 0,
        detalle: rubroHits.length ? `Coincide con ${rubroHits.slice(0, 3).join(', ')}` : detectados.length ? `Señales de ${detectados[0][0]}` : 'Sin coincidencia fuerte',
      },
      {
        nombre: 'Palabras clave',
        peso: 25,
        puntos: Math.min(25, keywordHits.length * 7 + busquedaHits.length * 5),
        detalle: [...new Set([...keywordHits, ...busquedaHits])].slice(0, 4).join(', ') || 'Sin palabras declaradas coincidentes',
      },
      {
        nombre: 'Capacidad/servicios descriptos',
        peso: 15,
        puntos: Math.min(15, descripcionHits.length * 3),
        detalle: descripcionHits.length ? `Coinciden términos como ${descripcionHits.slice(0, 3).join(', ')}` : 'Falta completar descripción o no coincide',
      },
      {
        nombre: 'Zona u organismo',
        peso: 10,
        puntos: zonaHit ? 10 : ubicacionDetectada ? 5 : 2,
        detalle: zonaHit
          ? `Coincide con tu zona declarada${ubicacionDetectada ? ` (${ubicacionDetectada})` : ''}`
          : ubicacionDetectada
          ? `Ubicación detectada: ${ubicacionDetectada}. No coincide claramente con tu zona declarada.`
          : 'No encontramos una ubicación clara en la publicación',
      },
      {
        nombre: 'Tipo de proceso',
        peso: 5,
        puntos: tipoFuerte ? 5 : 2,
        detalle: tipoFuerte ? 'Tipo de contratación identificado' : 'Tipo poco claro',
      },
      {
        nombre: 'Tiempo disponible',
        peso: 10,
        puntos: dias <= 1 ? 1 : dias <= 3 ? 4 : dias <= 7 ? 8 : 10,
        detalle: dias <= 1 ? 'Plazo muy ajustado' : dias <= 3 ? 'Plazo corto' : dias <= 7 ? 'Plazo razonable' : 'Buen margen para preparar oferta',
      },
    ];

    const score = Math.max(35, Math.min(98, criterios.reduce((acc, item) => acc + item.puntos, 0)));
    const rubro = detectados[0]?.[0] || lic.rubro || 'servicios';
    const mejoresCriterios = criterios
      .filter((item) => item.puntos > 0)
      .sort((a, b) => b.puntos - a.puntos)
      .slice(0, 2)
      .map((item) => item.nombre.toLowerCase());
    const motivo = mejoresCriterios.length
      ? `Compatibilidad por ${mejoresCriterios.join(' y ')}.`
      : detectados[0]?.[2] || 'La IA detecta una oportunidad general; conviene revisar objeto, pliego y requisitos.';
    const explicacion = `En simple: el organismo busca ${this.#resumirObjeto(lic.titulo)}. Revisá documentación, alcance y fecha de apertura antes de decidir.`;

    return {
      score,
      rubro,
      motivo,
      explicacion,
      criterios,
    };
  }

  #resumirObjeto(titulo) {
    const limpio = String(titulo || 'un bien o servicio').toLowerCase();
    return limpio.length > 95 ? `${limpio.slice(0, 95)}…` : limpio;
  }

  #normalizar(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  #extraerUbicacion(lic) {
    const organismo = String(lic.organismo || '');
    const descripcion = String(lic.descripcion || '');
    const texto = `${organismo} ${descripcion}`;
    const entreComillas = texto.match(/"([^"]{3,80})"/);
    if (entreComillas) return entreComillas[1];

    const lugares = [
      'Ingeniero Juarez', 'Pilar', 'Buenos Aires', 'CABA', 'Rosario', 'Cordoba', 'Mendoza',
      'La Pampa', 'Formosa', 'Salta', 'Misiones', 'Neuquen', 'Rio Negro', 'Chubut',
      'Mar del Plata', 'Bahia Blanca', 'Ushuaia', 'Bariloche', 'Eldorado',
    ];
    const normalizado = this.#normalizar(texto);
    return lugares.find((lugar) => normalizado.includes(this.#normalizar(lugar))) || null;
  }
}
