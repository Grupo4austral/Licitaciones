/**
 * DetalleModal — modal de detalle completo de una licitación
 * Se abre al hacer click en cualquier card o desde un popup WebSocket
 */
export class DetalleModal {
  #api;
  #overlay;
  #panel;
  #favoritoActivo;
  #favoritoDbId;
  #licitacionActual;

  constructor(apiService) {
    this.#api = apiService;
    this.#favoritoActivo = false;
    this.#favoritoDbId = null;
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

  async open(licitacionOrId) {
    this.#overlay.classList.add('visible');
    document.body.style.overflow = 'hidden';
    document.getElementById('detalle-content').innerHTML = `
      <div class="loader" style="padding:4rem"><div class="spinner"></div></div>
    `;

    try {
      const lic = typeof licitacionOrId === 'object' && licitacionOrId
        ? licitacionOrId
        : await this.#api.getLicitacion(licitacionOrId);
      this.#licitacionActual = lic;
      await this.#checkFavorito(lic.id || licitacionOrId, lic);
      this.#renderDetalle(lic);
    } catch (err) {
      document.getElementById('detalle-content').innerHTML = `
        <div class="detalle-error">
          <div class="detalle-error-icon">⚠️</div>
          <h3>No se pudo cargar la licitación</h3>
          <p>${this.#esc(err.message)}</p>
          <button class="btn btn-outline" id="detalle-error-close">Cerrar</button>
        </div>
      `;
      document.getElementById('detalle-error-close')?.addEventListener('click', () => this.close());
    }
  }

  close() {
    this.#overlay.classList.remove('visible');
    document.body.style.overflow = '';
    this.#licitacionActual = null;
  }

  async #checkFavorito(id, lic = null) {
    try {
      const favs = await this.#api.getFavoritos();
      const keys = new Set([
        String(id || ''),
        String(lic?.id || ''),
        String(lic?.numero_proceso || ''),
        String(lic?.url_original || ''),
      ].filter(Boolean));
      const encontrado = favs.find((f) => {
        const favLic = f.licitaciones;
        return [
          favLic?.id,
          favLic?.numero_proceso,
          favLic?.url_original,
          favLic?.datos_originales?.numero_proceso,
          favLic?.datos_originales?.external_id,
        ].filter(Boolean).some((value) => keys.has(String(value)));
      });
      this.#favoritoActivo = Boolean(encontrado);
      this.#favoritoDbId = encontrado?.licitaciones?.id || encontrado?.licitacion_id || null;
    } catch {
      this.#favoritoActivo = false;
      this.#favoritoDbId = null;
    }
  }

  #renderDetalle(lic) {
    const diasRestantes = this.#diasRestantes(lic.fecha_cierre);

    let diasClass = 'ok', diasLabel = '—';
    if (diasRestantes !== null) {
      if (diasRestantes < 0) { diasLabel = 'Cerrada'; diasClass = 'closed'; }
      else if (diasRestantes === 0) { diasLabel = 'Hoy'; diasClass = 'urgent'; }
      else if (diasRestantes <= 3) { diasLabel = `${diasRestantes} días`; diasClass = 'urgent'; }
      else if (diasRestantes <= 7) { diasLabel = `${diasRestantes} días`; diasClass = 'warn'; }
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

    const original = lic.datos_originales || {};
    const estado = original.estado || 'Publicado';
    const servicioAdministrativo = original.servicio_administrativo || this.#extraerServicioDesdeDescripcion(lic.descripcion);
    const numeroProceso = lic.numero_proceso || lic.id || '—';
    const match = lic.ia_match || this.#calcularMatchFallback(lic);
    const explicacion = lic.ia_explicacion || this.#resumenHumano(lic, diasLabel, estado);
    const diagnostico = this.#diagnosticoCompatibilidad(lic, match, diasRestantes);
    const checklist = this.#checklistDinamico(lic);
    const borrador = this.#borradorPresentacion(lic, match);

    document.getElementById('detalle-content').innerHTML = `
      <div id="detalle-header">
        <button id="detalle-close-btn" aria-label="Cerrar">✕</button>
        <div id="detalle-fuente">${this.#esc(lic.fuente || 'Fuente oficial')}</div>
        <h2 id="detalle-titulo">${this.#esc(lic.titulo)}</h2>
        <div id="detalle-organismo">${this.#esc(lic.organismo || 'Organismo no especificado')}</div>

        <div id="detalle-tags">
          <span class="detalle-tag">${this.#esc(numeroProceso)}</span>
          ${lic.rubro ? `<span class="detalle-tag">${this.#esc(lic.rubro)}</span>` : ''}
          ${estado ? `<span class="detalle-tag ok">${this.#esc(estado)}</span>` : ''}
          <span class="detalle-tag ai">${match}% match IA</span>
        </div>
      </div>

      <div id="detalle-metricas">
        <div class="detalle-metrica">
          <div class="detalle-metrica-valor">${presupuesto}</div>
          <div class="detalle-metrica-label">Presupuesto estimado</div>
        </div>
        <div class="detalle-metrica">
          <div class="detalle-metrica-valor ${diasClass}">${diasLabel}</div>
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

      <div class="detalle-seccion">
        <h3 class="detalle-seccion-titulo">Resumen para presentarte</h3>
        <p class="detalle-seccion-texto">${this.#esc(explicacion)}</p>
      </div>

      <div class="detalle-seccion">
        <h3 class="detalle-seccion-titulo">Diagnóstico rápido</h3>
        <div class="detalle-semaforo">
          ${diagnostico.map((item) => `
            <div class="semaforo-item ${this.#esc(item.estado)}">
              <strong>${this.#esc(item.titulo)}</strong>
              <span>${this.#esc(item.texto)}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="detalle-seccion">
        <h3 class="detalle-seccion-titulo">Consulting previo de compatibilidad</h3>
        <div class="detalle-criterios">
          ${this.#renderCriterios(lic.ia_criterios)}
        </div>
      </div>

      <div class="detalle-grid-info">
        <div>
          <span>Número de proceso</span>
          <strong>${this.#esc(numeroProceso)}</strong>
        </div>
        <div>
          <span>Tipo</span>
          <strong>${this.#esc(lic.rubro || 'No informado')}</strong>
        </div>
        <div>
          <span>Unidad ejecutora</span>
          <strong>${this.#esc(lic.organismo || 'No informada')}</strong>
        </div>
        <div>
          <span>Servicio administrativo</span>
          <strong>${this.#esc(servicioAdministrativo || 'No informado')}</strong>
        </div>
      </div>

      ${lic.descripcion ? `
        <div class="detalle-seccion">
          <h3 class="detalle-seccion-titulo">Descripción</h3>
          <p class="detalle-seccion-texto">${this.#esc(lic.descripcion)}</p>
        </div>
      ` : ''}

      <div class="detalle-seccion">
        <h3 class="detalle-seccion-titulo">Informe IA automático</h3>
        <div class="detalle-ai-box" id="detalle-ai-report">
          <div>
            <strong>Generá una primera consultoría sobre esta licitación.</strong>
            <p>La IA cruza la oportunidad con tu perfil de empresa y devuelve plazos, riesgos, documentación, checklist y borrador de propuesta.</p>
          </div>
          <button class="btn btn-primary btn-sm" id="detalle-ai-report-btn">Generar informe IA</button>
        </div>
      </div>

      <div class="detalle-seccion">
        <h3 class="detalle-seccion-titulo">Asistente contextual de requisitos</h3>
        <div class="detalle-qa" id="detalle-qa">
          <div class="detalle-qa-answer">Elegí una pregunta rápida para ver una orientación sobre esta licitación.</div>
          <div class="detalle-qa-buttons">
            <button class="btn btn-outline btn-sm" data-answer="${this.#escAttr(this.#respuestaMatch(lic, match))}">¿Por qué matchea?</button>
            <button class="btn btn-outline btn-sm" data-answer="${this.#escAttr(this.#respuestaRiesgos(lic, diasLabel))}">¿Qué riesgos revisar?</button>
            <button class="btn btn-outline btn-sm" data-answer="${this.#escAttr(this.#respuestaRequisitos(lic))}">¿Qué documentación?</button>
            <button class="btn btn-outline btn-sm" data-answer="${this.#escAttr(this.#respuestaPartesCriticas(lic))}">¿Qué partes del pliego?</button>
            <button class="btn btn-outline btn-sm" data-answer="${this.#escAttr(this.#respuestaConveniencia(lic, match))}">¿Conviene presentarme?</button>
            <button class="btn btn-outline btn-sm" data-answer="${this.#escAttr(this.#respuestaCostos(lic))}">¿Qué costos miro?</button>
            <button class="btn btn-outline btn-sm" data-answer="${this.#escAttr(this.#respuestaTiempo(lic, diasLabel))}">¿Cuánto tiempo tengo?</button>
          </div>
          <form class="detalle-ai-chat" id="detalle-ai-chat">
            <input class="input" id="detalle-ai-question" placeholder="Preguntale a la IA sobre esta licitación..." />
            <button class="btn btn-primary btn-sm" id="detalle-ai-question-btn">Preguntar</button>
          </form>
        </div>
      </div>

      <div class="detalle-seccion">
        <h3 class="detalle-seccion-titulo">Checklist dinámico de presentación</h3>
        <ul class="detalle-checklist">
          ${checklist.map((item) => `<li><input type="checkbox" /> <span>${this.#esc(item)}</span></li>`).join('')}
        </ul>
      </div>

      <div class="detalle-seccion">
        <h3 class="detalle-seccion-titulo">Borrador para preparar propuesta</h3>
        <div class="proposal-draft">${this.#esc(borrador)}</div>
      </div>

      <div id="detalle-acciones">
        <button id="detalle-fav-btn" class="btn ${this.#favoritoActivo ? 'btn-primary' : 'btn-outline'}">
          ${this.#favoritoActivo ? '★ En favoritos' : '☆ Guardar en favoritos'}
        </button>
        ${lic.url_original ? `
          <a href="${this.#esc(lic.url_original)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline">
            Ver pliego oficial ↗
          </a>
        ` : ''}
      </div>
    `;

    // Cerrar
    document.getElementById('detalle-close-btn').addEventListener('click', () => this.close());
    document.querySelectorAll('#detalle-qa [data-answer]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelector('#detalle-qa .detalle-qa-answer').textContent = btn.dataset.answer;
      });
    });

    document.getElementById('detalle-ai-report-btn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const box = document.getElementById('detalle-ai-report');
      btn.disabled = true;
      btn.textContent = 'Generando...';
      box?.classList.add('loading');
      try {
        const informe = await this.#api.generarInformeIA(lic);
        box.innerHTML = this.#renderInformeIA(informe);
      } catch (err) {
        box.innerHTML = `
          <div class="detalle-ai-error">
            <strong>No se pudo generar el informe IA.</strong>
            <p>${this.#esc(err.message || 'Revisá que el backend esté corriendo y que la API key esté configurada.')}</p>
          </div>
        `;
      }
    });

    document.getElementById('detalle-ai-chat')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('detalle-ai-question');
      const answer = document.querySelector('#detalle-qa .detalle-qa-answer');
      const btn = document.getElementById('detalle-ai-question-btn');
      const pregunta = input?.value.trim();
      if (!pregunta || !answer || !btn) return;

      answer.textContent = 'Consultando a la IA sobre esta licitación...';
      btn.disabled = true;
      try {
        const data = await this.#api.preguntarAsistente(lic, pregunta);
        answer.textContent = data.respuesta || 'No se recibió respuesta.';
        input.value = '';
      } catch (err) {
        answer.textContent = `No se pudo consultar la IA: ${err.message}`;
      } finally {
        btn.disabled = false;
      }
    });

    // Toggle favorito
    document.getElementById('detalle-fav-btn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        if (this.#favoritoActivo) {
          await this.#api.removeFavorito(this.#favoritoDbId || lic.id);
          this.#favoritoActivo = false;
          this.#favoritoDbId = null;
          btn.className = 'btn btn-outline';
          btn.textContent = '☆ Guardar en favoritos';
        } else {
          const favorito = await this.#api.addFavorito(lic.id, lic);
          this.#favoritoActivo = true;
          this.#favoritoDbId = favorito.licitacion_id || favorito.licitaciones?.id || lic.id;
          btn.className = 'btn btn-primary';
          btn.textContent = '★ En favoritos';
          document.dispatchEvent(new CustomEvent('licitia:favoritos-actualizados'));
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
        background: rgba(10,15,30,0.58);
        backdrop-filter: blur(6px);
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
        width: min(680px, 100vw);
        height: 100%;
        background: var(--surface);
        border-left: 1px solid var(--line);
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
        border-bottom: 1px solid var(--line);
        position: relative;
        background: linear-gradient(180deg, #fff 0%, var(--surface-2) 100%);
      }
      #detalle-close-btn {
        position: absolute;
        top: 1.25rem;
        right: 1.25rem;
        background: var(--surface);
        border: 1px solid var(--line);
        color: var(--ink-3);
        width: 32px; height: 32px;
        border-radius: 999px;
        cursor: pointer;
        font-size: 0.9rem;
        display: flex; align-items: center; justify-content: center;
        transition: all var(--t);
      }
      #detalle-close-btn:hover {
        color: var(--ink);
        border-color: var(--line-2);
        background: var(--surface-3);
      }
      #detalle-fuente {
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--blue-lt);
        font-weight: 700;
        margin-bottom: 0.75rem;
      }
      #detalle-titulo {
        font-family: var(--ff-body);
        font-size: 1.35rem;
        line-height: 1.35;
        margin-bottom: 0.6rem;
        padding-right: 2.5rem;
        color: var(--ink);
        letter-spacing: 0;
      }
      #detalle-organismo {
        font-size: 0.875rem;
        color: var(--ink-2);
        line-height: 1.5;
      }
      #detalle-tags {
        margin-top: 1rem;
        display: flex;
        flex-wrap: wrap;
        gap: .5rem;
      }
      .detalle-tag {
        display: inline-flex;
        align-items: center;
        min-height: 28px;
        padding: .32rem .6rem;
        border-radius: var(--r);
        background: var(--blue-ll);
        color: var(--blue);
        font-size: .76rem;
        font-weight: 700;
      }
      .detalle-tag.ok {
        background: var(--green-lt);
        color: var(--green);
      }
      .detalle-tag.ai {
        background: var(--gold-lt);
        color: #7a5a10;
      }
      #detalle-metricas {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1px;
        background: var(--line);
        border-top: 1px solid var(--line);
        border-bottom: 1px solid var(--line);
      }
      .detalle-metrica {
        padding: 1.25rem 1.5rem;
        background: var(--surface);
      }
      .detalle-metrica-valor {
        font-family: var(--ff-display);
        font-size: 1.1rem;
        font-weight: 700;
        margin-bottom: 0.25rem;
        color: var(--ink);
      }
      .detalle-metrica-valor.urgent { color: var(--red); }
      .detalle-metrica-valor.warn { color: var(--amber); }
      .detalle-metrica-valor.ok { color: var(--green); }
      .detalle-metrica-valor.closed { color: var(--ink-3); }
      .detalle-metrica-valor:first-child { word-break: break-word; }
      .detalle-grid-info {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1px;
        background: var(--line);
        border-bottom: 1px solid var(--line);
      }
      .detalle-grid-info > div {
        padding: 1rem 1.5rem;
        background: var(--surface-2);
      }
      .detalle-grid-info span {
        display: block;
        font-size: .72rem;
        color: var(--ink-3);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: .06em;
        margin-bottom: .35rem;
      }
      .detalle-grid-info strong {
        display: block;
        color: var(--ink);
        font-size: .9rem;
        line-height: 1.45;
      }
      .detalle-metrica-label {
        font-size: 0.75rem;
        color: var(--ink-3);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        font-weight: 600;
      }
      .detalle-seccion {
        padding: 1.5rem 2rem;
        border-bottom: 1px solid var(--line);
      }
      .detalle-seccion-titulo {
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--ink-3);
        font-weight: 700;
        margin-bottom: 0.75rem;
        font-family: var(--ff-body);
      }
      .detalle-seccion-texto {
        font-size: 0.9rem;
        line-height: 1.7;
        color: var(--ink-2);
        white-space: pre-wrap;
      }
      .detalle-qa {
        display: flex;
        flex-direction: column;
        gap: .8rem;
      }
      .detalle-qa-answer {
        border: 1px solid var(--line);
        border-radius: var(--r);
        background: var(--surface-2);
        color: var(--ink-2);
        padding: .9rem 1rem;
        font-size: .88rem;
        line-height: 1.65;
      }
      .detalle-qa-buttons {
        display: flex;
        flex-wrap: wrap;
        gap: .5rem;
      }
      .detalle-ai-box {
        border: 1px solid var(--line);
        border-radius: var(--r);
        background: var(--surface-2);
        padding: 1rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
      }
      .detalle-ai-box strong {
        display: block;
        color: var(--ink);
        font-size: .92rem;
        margin-bottom: .25rem;
      }
      .detalle-ai-box p {
        color: var(--ink-2);
        font-size: .84rem;
        line-height: 1.55;
      }
      .detalle-ai-box.loading {
        opacity: .72;
      }
      .detalle-ai-report {
        display: flex;
        flex-direction: column;
        gap: .85rem;
        width: 100%;
      }
      .detalle-ai-mode {
        align-self: flex-start;
        border-radius: 999px;
        background: var(--green-lt);
        color: var(--green);
        font-size: .72rem;
        font-weight: 800;
        padding: .25rem .55rem;
      }
      .detalle-ai-mode.demo,
      .detalle-ai-mode.fallback {
        background: var(--gold-lt);
        color: #7a5a10;
      }
      .detalle-ai-block {
        border: 1px solid var(--line);
        border-radius: var(--r);
        background: var(--surface);
        padding: .85rem .95rem;
      }
      .detalle-ai-block h4 {
        font-family: var(--ff-body);
        font-size: .82rem;
        color: var(--ink);
        margin-bottom: .45rem;
        letter-spacing: 0;
      }
      .detalle-ai-block p,
      .detalle-ai-block li {
        color: var(--ink-2);
        font-size: .84rem;
        line-height: 1.55;
      }
      .detalle-ai-block ul {
        margin: 0;
        padding-left: 1.1rem;
      }
      .detalle-ai-chat {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: .55rem;
      }
      .detalle-ai-error {
        color: var(--red);
      }
      .detalle-checklist {
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: .65rem;
      }
      .detalle-checklist li {
        display: flex;
        gap: .65rem;
        align-items: flex-start;
        font-size: .88rem;
        color: var(--ink-2);
        line-height: 1.5;
      }
      .detalle-checklist input {
        margin-top: .2rem;
        accent-color: var(--blue);
      }
      .detalle-semaforo {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: .65rem;
      }
      .semaforo-item {
        border: 1px solid var(--line);
        border-radius: var(--r);
        padding: .8rem .9rem;
        background: var(--surface-2);
      }
      .semaforo-item strong {
        display: block;
        font-size: .82rem;
        margin-bottom: .3rem;
        color: var(--ink);
      }
      .semaforo-item span {
        display: block;
        font-size: .76rem;
        line-height: 1.45;
        color: var(--ink-2);
      }
      .semaforo-item.verde { border-left: 4px solid var(--green); }
      .semaforo-item.amarillo { border-left: 4px solid var(--amber); }
      .semaforo-item.rojo { border-left: 4px solid var(--red); }
      .proposal-draft {
        white-space: pre-wrap;
        border: 1px solid var(--line);
        border-radius: var(--r);
        background: var(--surface-2);
        padding: 1rem;
        color: var(--ink-2);
        font-size: .86rem;
        line-height: 1.65;
      }
      .detalle-criterios {
        display: flex;
        flex-direction: column;
        gap: .65rem;
      }
      .detalle-criterio {
        border: 1px solid var(--line);
        border-radius: var(--r);
        background: var(--surface-2);
        padding: .8rem .9rem;
      }
      .detalle-criterio-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: .75rem;
        margin-bottom: .45rem;
      }
      .detalle-criterio-head strong {
        font-size: .86rem;
        color: var(--ink);
      }
      .detalle-criterio-head span {
        font-size: .75rem;
        font-weight: 800;
        color: var(--blue);
      }
      .detalle-criterio-bar {
        height: 6px;
        border-radius: 999px;
        background: var(--line);
        overflow: hidden;
        margin-bottom: .45rem;
      }
      .detalle-criterio-bar div {
        height: 100%;
        background: var(--blue-lt);
      }
      .detalle-criterio p {
        color: var(--ink-2);
        font-size: .78rem;
        line-height: 1.45;
      }
      #detalle-acciones {
        padding: 1.5rem 2rem;
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
        margin-top: auto;
        border-top: 1px solid var(--line);
        background: var(--surface);
        position: sticky;
        bottom: 0;
      }
      .detalle-error {
        margin: auto;
        padding: 2rem;
        text-align: center;
        color: var(--ink-2);
      }
      .detalle-error-icon {
        font-size: 2.5rem;
        margin-bottom: 1rem;
      }
      .detalle-error h3 {
        font-size: 1.15rem;
        margin-bottom: .5rem;
        color: var(--ink);
      }
      .detalle-error p {
        font-size: .9rem;
        margin-bottom: 1rem;
      }
      @media (max-width: 600px) {
        #detalle-metricas { grid-template-columns: 1fr 1fr; }
        .detalle-semaforo { grid-template-columns: 1fr; }
        .detalle-grid-info { grid-template-columns: 1fr; }
        .detalle-ai-box { align-items: stretch; flex-direction: column; }
        .detalle-ai-chat { grid-template-columns: 1fr; }
        #detalle-acciones { flex-direction: column; }
        #detalle-acciones .btn { width: 100%; justify-content: center; }
      }
    `;
    document.head.appendChild(style);
  }

  #renderInformeIA(informe) {
    const modo = informe.modo || 'ia';
    const etiqueta = modo === 'ia'
      ? 'Generado con IA'
      : modo === 'demo'
      ? 'Modo demo sin API key'
      : 'Análisis local de respaldo';
    const propuesta = informe.propuesta || {};

    return `
      <div class="detalle-ai-report">
        <span class="detalle-ai-mode ${this.#esc(modo)}">${this.#esc(etiqueta)}</span>
        ${informe.aviso ? `<div class="detalle-ai-block"><p>${this.#esc(informe.aviso)}</p></div>` : ''}
        <div class="detalle-ai-block">
          <h4>Resumen simple</h4>
          <p>${this.#esc(informe.resumen)}</p>
        </div>
        <div class="detalle-ai-block">
          <h4>Plazos</h4>
          <p>${this.#esc(informe.plazos)}</p>
        </div>
        <div class="detalle-ai-block">
          <h4>Compatibilidad y recomendación</h4>
          <p>${this.#esc(informe.compatibilidad)}</p>
          <p>${this.#esc(informe.recomendacion)}</p>
        </div>
        <div class="detalle-ai-block">
          <h4>Riesgos a revisar</h4>
          ${this.#renderListaIA(informe.riesgos)}
        </div>
        <div class="detalle-ai-block">
          <h4>Documentación probable</h4>
          ${this.#renderListaIA(informe.documentos)}
        </div>
        <div class="detalle-ai-block">
          <h4>Checklist dinámico</h4>
          ${this.#renderListaIA(informe.checklist)}
        </div>
        <div class="detalle-ai-block">
          <h4>Preparador de propuesta</h4>
          <p><strong>Resumen:</strong> ${this.#esc(propuesta.resumen_empresa)}</p>
          <p><strong>Experiencia:</strong> ${this.#esc(propuesta.experiencia_relevante)}</p>
          <p><strong>Capacidades:</strong> ${this.#esc(propuesta.capacidades_operativas)}</p>
          <p><strong>Documentos faltantes:</strong></p>
          ${this.#renderListaIA(propuesta.documentos_faltantes)}
          <p><strong>Próximos pasos:</strong></p>
          ${this.#renderListaIA(propuesta.proximos_pasos)}
        </div>
      </div>
    `;
  }

  #renderListaIA(items = []) {
    const lista = Array.isArray(items) ? items : [];
    if (!lista.length) return '<p>No informado.</p>';
    return `<ul>${lista.map((item) => `<li>${this.#esc(item)}</li>`).join('')}</ul>`;
  }

  #resumenHumano(lic, diasLabel, estado) {
    const tipo = lic.rubro || 'proceso de contratación';
    const organismo = lic.organismo || 'el organismo comprador';
    const cierre = lic.fecha_cierre
      ? new Date(lic.fecha_cierre + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })
      : 'fecha a confirmar';

    return `Es un ${tipo} publicado por ${organismo}. Estado actual: ${estado}. La apertura/cierre figura para el ${cierre}${diasLabel !== '—' ? `, con ${diasLabel} restantes` : ''}. Revisá el pliego oficial antes de avanzar para confirmar documentación, requisitos técnicos y condiciones de presentación.`;
  }

  #extraerServicioDesdeDescripcion(descripcion) {
    const match = String(descripcion || '').match(/\.\s*([^.]*(?:Ejercito|Armada|Gendarmeria|Vialidad|Energía Atómica|Parques Nacionales)[^.]*)$/i);
    return match ? match[1].trim() : null;
  }

  #pareceUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
  }

  #diasRestantes(fecha) {
    if (!fecha) return null;
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const cierre = new Date(`${fecha}T00:00:00`);
    return Math.ceil((cierre - hoy) / 86400000);
  }

  #esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  #escAttr(str) {
    return this.#esc(str).replace(/`/g, '&#96;');
  }

  #calcularMatchFallback(lic) {
    const texto = String([lic.titulo, lic.descripcion, lic.rubro].filter(Boolean).join(' ')).toLowerCase();
    let score = 64;
    if (/limpieza|mantenimiento|reparaci[oó]n|alimento|insumo|software|servicio/.test(texto)) score += 18;
    if (lic.fecha_cierre) score += 6;
    return Math.min(94, score);
  }

  #respuestaRequisitos(lic) {
    const esAlimentos = this.#esAlimentos(lic);
    if (esAlimentos) {
      return `Para esta licitación de alimentos revisá documentación administrativa, habilitaciones sanitarias/bromatológicas, trazabilidad, cadena de frío si aplica, capacidad de entrega, vehículos habilitados, garantías y condiciones de recepción. El pliego oficial manda.`;
    }
    return `Para esta licitación tenés que revisar el pliego oficial y confirmar: documentación administrativa, requisitos técnicos del objeto "${lic.titulo || 'licitación'}", forma de presentación, garantías si corresponden y condiciones de entrega o prestación.`;
  }

  #respuestaConveniencia(lic, match) {
    const esAlimentos = this.#esAlimentos(lic);
    const base = match >= 75
      ? 'Tiene sentido presentarte porque el objeto parece alineado con tu rubro y capacidades.'
      : match >= 55
      ? 'Puede tener sentido presentarte, pero solo después de validar requisitos excluyentes.'
      : 'No parece prioridad salvo que el pliego tenga condiciones muy favorables para tu empresa.';
    const extra = esAlimentos
      ? ' Para una empresa frigorífica, confirmá especialmente habilitaciones, cadena de frío, vehículos aptos y lugar de entrega.'
      : ' Confirmá que puedas cumplir plazo, alcance, documentación y precio.';
    return `${base} Compatibilidad estimada: ${match}%.${extra}`;
  }

  #respuestaMatch(lic, match) {
    const tipo = lic.rubro || 'proceso';
    const objeto = lic.titulo || 'esta licitación';
    const criterios = Array.isArray(lic.ia_criterios)
      ? lic.ia_criterios.filter((c) => c.puntos > 0).sort((a, b) => b.puntos - a.puntos).slice(0, 3)
      : [];
    const detalle = criterios.length
      ? criterios.map((c) => `${c.nombre}: ${c.detalle}`).join(' | ')
      : 'El match se basa en rubro, palabras clave, zona, tipo de proceso y tiempo disponible.';
    return `Matchea ${match}% porque el objeto "${objeto}" se cruza con señales del perfil y del proceso (${tipo}). ${detalle}`;
  }

  #respuestaRiesgos(lic, diasLabel) {
    const riesgos = [
      'confirmar requisitos excluyentes del pliego',
      'verificar garantías y documentación fiscal',
      'validar lugar y forma de entrega/prestación',
      'calcular costos reales antes de ofertar',
    ];
    if (this.#esAlimentos(lic)) {
      riesgos.unshift('verificar habilitaciones sanitarias, cadena de frío y trazabilidad');
    }
    return `Riesgos a revisar: ${riesgos.join('; ')}. Tiempo disponible: ${diasLabel}.`;
  }

  #respuestaPartesCriticas(lic) {
    const partes = [
      'objeto y alcance de la contratación',
      'requisitos técnicos obligatorios',
      'documentación administrativa excluyente',
      'garantías y anexos',
      'lugar, plazo y forma de entrega/prestación',
      'criterios de evaluación de ofertas',
    ];
    if (this.#esAlimentos(lic)) {
      partes.splice(2, 0, 'condiciones sanitarias, bromatológicas y cadena de frío');
    }
    return `Partes críticas del pliego: ${partes.join('; ')}. Si alguna de estas partes no se puede cumplir, conviene descartar o pedir aclaración antes de ofertar.`;
  }

  #respuestaCostos(lic) {
    const costos = [
      'costo directo del producto/servicio',
      'mano de obra',
      'logística y combustible',
      'seguros, garantías y gastos administrativos',
      'impuestos y margen',
      'riesgo por demora o cambios de precios',
    ];
    if (this.#esAlimentos(lic)) {
      costos.splice(2, 0, 'refrigeración, conservación, merma y cadena de frío');
    }
    return `Costos a tener en cuenta: ${costos.join('; ')}. Para decidir precio, no mires solo el producto: calculá cumplimiento completo del contrato.`;
  }

  #respuestaTiempo(lic, diasLabel) {
    const cierre = lic.fecha_cierre
      ? new Date(lic.fecha_cierre + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })
      : 'fecha no informada';
    return `La fecha de apertura/cierre registrada es ${cierre}. Quedan ${diasLabel}. Te conviene descargar el pliego hoy y separar documentación antes de presupuestar.`;
  }

  #renderCriterios(criterios = []) {
    if (!Array.isArray(criterios) || criterios.length === 0) {
      return `
        <div class="detalle-criterio">
          <div class="detalle-criterio-head"><strong>Evaluación general</strong><span>Sin perfil completo</span></div>
          <p>Completá el onboarding de Mi empresa para que LicitIA pueda explicar el match por rubro, zona, palabras clave y capacidad operativa.</p>
        </div>
      `;
    }

    return criterios.map((criterio) => {
      const pct = Math.round((criterio.puntos / criterio.peso) * 100);
      return `
        <div class="detalle-criterio">
          <div class="detalle-criterio-head">
            <strong>${this.#esc(criterio.nombre)}</strong>
            <span>${criterio.puntos}/${criterio.peso}</span>
          </div>
          <div class="detalle-criterio-bar"><div style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>
          <p>${this.#esc(criterio.detalle)}</p>
        </div>
      `;
    }).join('');
  }

  #diagnosticoCompatibilidad(lic, match, diasRestantes) {
    const esAlimentos = this.#esAlimentos(lic);
    return [
      {
        estado: match >= 75 ? 'verde' : match >= 55 ? 'amarillo' : 'rojo',
        titulo: match >= 75 ? 'Buen encaje' : match >= 55 ? 'Encaje a revisar' : 'Encaje bajo',
        texto: match >= 75 ? 'El rubro y el objeto parecen alineados.' : match >= 55 ? 'Hay señales útiles, pero requiere revisar requisitos.' : 'No parece prioridad salvo que tengas capacidad específica.',
      },
      {
        estado: diasRestantes == null || diasRestantes > 5 ? 'verde' : diasRestantes > 2 ? 'amarillo' : 'rojo',
        titulo: 'Plazo',
        texto: diasRestantes == null ? 'Fecha no informada.' : diasRestantes > 5 ? 'Hay margen para preparar documentación.' : diasRestantes > 2 ? 'Plazo corto: avanzar solo con documentación lista.' : 'Muy poco tiempo para armar una oferta desde cero.',
      },
      {
        estado: esAlimentos ? 'amarillo' : 'verde',
        titulo: esAlimentos ? 'Requisitos sanitarios' : 'Documentación',
        texto: esAlimentos ? 'Revisar habilitaciones, cadena de frío y entrega.' : 'Revisar condiciones administrativas y técnicas del pliego.',
      },
    ];
  }

  #checklistDinamico(lic) {
    const base = [
      'Confirmar objeto, alcance y unidad ejecutora.',
      'Descargar y leer el pliego oficial completo.',
      'Verificar documentación legal, fiscal y técnica requerida.',
      'Calcular oferta económica y costos de cumplimiento.',
      'Revisar garantías, anexos y formato de presentación.',
    ];

    if (this.#esAlimentos(lic)) {
      return [
        'Confirmar tipo de alimento solicitado, cantidades y presentación.',
        'Verificar habilitación sanitaria/bromatológica de la empresa.',
        'Validar cadena de frío, cámaras, vehículos y trazabilidad.',
        'Revisar lugar de entrega, frecuencia, horarios y recepción.',
        'Calcular costos de compra, refrigeración, merma, combustible y distribución.',
        'Preparar antecedentes de provisión a supermercados, almacenes u organismos.',
        ...base.slice(1),
      ];
    }

    return base;
  }

  #borradorPresentacion(lic, match) {
    const rubro = this.#esAlimentos(lic) ? 'provisión y logística de alimentos' : (lic.rubro || 'servicios requeridos');
    const documentos = this.#esAlimentos(lic)
      ? 'habilitación sanitaria/bromatológica, constancia fiscal, documentación societaria, antecedentes de provisión, detalle de cámaras/vehículos y documentación de cadena de frío.'
      : 'constancia fiscal, documentación societaria, antecedentes, propuesta técnica, oferta económica y garantías/anexos solicitados.';

    return `Borrador base:

Nuestra empresa manifiesta interés en participar del proceso ${lic.numero_proceso || lic.id || ''}, referido a "${lic.titulo || 'la contratación publicada'}".

1. Resumen de empresa
Somos una empresa con capacidad operativa vinculada a ${rubro}, disponibilidad para coordinar entregas/prestaciones y experiencia para cumplir condiciones técnicas y administrativas.

2. Experiencia relevante
Agregar antecedentes similares: clientes atendidos, zonas de cobertura, volúmenes, continuidad de servicio y cumplimiento de entregas.

3. Capacidades operativas
Describir recursos disponibles, personal, infraestructura, vehículos, equipamiento, cámaras, controles de calidad y cobertura geográfica.

4. Documentos faltantes a verificar
${documentos}

5. Próximos pasos
Descargar pliego oficial, confirmar requisitos excluyentes, calcular costos completos, preparar propuesta técnica/económica y revisar garantías/anexos.

Compatibilidad preliminar LicitIA: ${match}%. Esta evaluación no reemplaza la lectura del pliego oficial.`;
  }

  #esAlimentos(lic) {
    return /alimento|carne|pollo|viveres|víveres|frigor|canes|equinos|carnico|cárnico|refriger/i.test([
      lic.titulo,
      lic.descripcion,
      lic.rubro,
      lic.organismo,
    ].filter(Boolean).join(' '));
  }
}
