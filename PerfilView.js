/**
 * PerfilView — formulario de perfil de empresa con tags interactivos
 */
export class PerfilView {
  #api;
  #container;
  #tags;

  constructor(apiService, containerId) {
    this.#api = apiService;
    this.#container = document.getElementById(containerId);
    this.#tags = [];
    this.#render();
  }

  async init() {
    await this.#loadPerfil();
  }

  #render() {
    this.#container.innerHTML = `
      <div class="section-head">
        <div>
          <div class="section-title">Mi empresa</div>
          <div class="section-sub">Onboarding conversacional para construir el perfil de matching</div>
        </div>
      </div>

      <div class="onboarding-panel">
        <div class="field">
          <label for="p-conversacion">Contale a LicitIA qué hace tu empresa</label>
          <textarea id="p-conversacion" class="input" placeholder="Ej: Somos una pyme de limpieza de Pilar. Hacemos limpieza integral, mantenimiento, sanitización y provisión de insumos. Podemos trabajar en Buenos Aires y CABA con equipos de hasta 20 personas. Buscamos contratos mensuales o trimestrales con organismos públicos."></textarea>
        </div>
        <div class="onboarding-actions">
          <button type="button" class="btn btn-primary" id="perfil-ai-btn">Construir perfil con IA</button>
          <span class="onboarding-hint">MVP: interpreta rubro, zona y palabras clave desde tu descripción.</span>
        </div>
      </div>

      <div class="profile-summary">
        <div class="profile-pill"><span>Rubro detectado</span><strong id="profile-rubro-preview">A completar</strong></div>
        <div class="profile-pill"><span>Zona</span><strong id="profile-zona-preview">A completar</strong></div>
        <div class="profile-pill"><span>Palabras clave</span><strong id="profile-keywords-preview">A completar</strong></div>
      </div>

      <div id="perfil-success-msg" class="banner banner-success"></div>
      <div id="perfil-error-msg" class="banner banner-error"></div>

      <form class="perfil-form" id="perfil-form" novalidate>
        <div class="field">
          <label for="p-nombre">Nombre de la empresa</label>
          <input id="p-nombre" class="input" type="text" placeholder="Ej: Limpieza Total SRL" />
        </div>

        <div class="field">
          <label for="p-rubro">Rubro principal</label>
          <input id="p-rubro" class="input" type="text" placeholder="Ej: Servicios de limpieza" />
        </div>

        <div class="field">
          <label for="p-descripcion">Descripción de la empresa</label>
          <textarea id="p-descripcion" class="input" placeholder="Contanos qué hace tu empresa, qué productos o servicios ofrecen…"></textarea>
        </div>

        <div class="form-row">
          <div class="field">
            <label for="p-provincia">Provincia</label>
            <select id="p-provincia" class="input">
              <option value="">Seleccioná una provincia</option>
              <option value="Buenos Aires">Buenos Aires</option>
              <option value="CABA">CABA</option>
              <option value="Córdoba">Córdoba</option>
              <option value="Santa Fe">Santa Fe</option>
              <option value="Mendoza">Mendoza</option>
              <option value="Tucumán">Tucumán</option>
              <option value="Entre Ríos">Entre Ríos</option>
              <option value="Salta">Salta</option>
              <option value="Misiones">Misiones</option>
              <option value="Chaco">Chaco</option>
              <option value="Corrientes">Corrientes</option>
              <option value="Santiago del Estero">Santiago del Estero</option>
              <option value="San Juan">San Juan</option>
              <option value="Jujuy">Jujuy</option>
              <option value="Río Negro">Río Negro</option>
              <option value="Neuquén">Neuquén</option>
              <option value="Formosa">Formosa</option>
              <option value="Chubut">Chubut</option>
              <option value="San Luis">San Luis</option>
              <option value="Catamarca">Catamarca</option>
              <option value="La Rioja">La Rioja</option>
              <option value="La Pampa">La Pampa</option>
              <option value="Santa Cruz">Santa Cruz</option>
              <option value="Tierra del Fuego">Tierra del Fuego</option>
            </select>
          </div>
          <div class="field">
            <label for="p-ciudad">Ciudad</label>
            <input id="p-ciudad" class="input" type="text" placeholder="Ej: Pilar" />
          </div>
        </div>

        <div class="field">
          <label>Palabras clave <span style="font-weight:400;text-transform:none;letter-spacing:0">(presioná Enter para agregar)</span></label>
          <div class="tags-wrap" id="tags-wrapper">
            <input 
              class="tags-input" 
              id="tags-input" 
              type="text" 
              placeholder="Ej: limpieza, sanitización, mantenimiento…"
            />
          </div>
        </div>

        <div style="display:flex;gap:1rem;align-items:center">
          <button type="submit" class="btn btn-primary" id="perfil-save-btn">Guardar perfil</button>
          <span id="perfil-saving" style="color:var(--ink-3);font-size:0.85rem;display:none">Guardando…</span>
        </div>
      </form>
    `;

    this.#attachEvents();
  }

  #attachEvents() {
    const tagsInput = document.getElementById('tags-input');
    const tagsWrapper = document.getElementById('tags-wrapper');

    tagsInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const val = tagsInput.value.trim().replace(/,/g, '');
        if (val && !this.#tags.includes(val)) {
          this.#tags.push(val);
          this.#renderTags();
        }
        tagsInput.value = '';
      } else if (e.key === 'Backspace' && !tagsInput.value && this.#tags.length) {
        this.#tags.pop();
        this.#renderTags();
      }
    });

    tagsWrapper.addEventListener('click', () => tagsInput.focus());

    document.getElementById('perfil-ai-btn').addEventListener('click', () => {
      this.#inferirPerfil();
    });

    ['p-rubro', 'p-provincia', 'p-ciudad'].forEach((id) => {
      document.getElementById(id).addEventListener('input', () => this.#actualizarPreview());
      document.getElementById(id).addEventListener('change', () => this.#actualizarPreview());
    });

    document.getElementById('perfil-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.#save();
    });
  }

  #renderTags() {
    const wrapper = document.getElementById('tags-wrapper');
    // Eliminar chips anteriores (no el input)
    wrapper.querySelectorAll('.tag-chip').forEach(el => el.remove());

    this.#tags.forEach((tag, i) => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.innerHTML = `${tag} <button type="button" data-i="${i}" aria-label="Eliminar ${tag}">×</button>`;
      chip.querySelector('button').addEventListener('click', () => {
        this.#tags.splice(i, 1);
        this.#renderTags();
      });
      wrapper.insertBefore(chip, wrapper.querySelector('.tags-input'));
    });
  }

  async #loadPerfil() {
    try {
      const perfil = await this.#api.getPerfil();
      document.getElementById('p-nombre').value    = perfil.nombre_empresa || '';
      document.getElementById('p-rubro').value     = perfil.rubro || '';
      document.getElementById('p-descripcion').value = perfil.descripcion || '';
      document.getElementById('p-provincia').value = perfil.provincia || '';
      document.getElementById('p-ciudad').value    = perfil.ciudad || '';
      this.#tags = perfil.palabras_clave || [];
      this.#renderTags();
      this.#actualizarPreview();
    } catch {
      // No tiene perfil aún — formulario vacío
    }
  }

  async #save() {
    const successMsg = document.getElementById('perfil-success-msg');
    const errorMsg   = document.getElementById('perfil-error-msg');
    const savingEl   = document.getElementById('perfil-saving');
    const saveBtn    = document.getElementById('perfil-save-btn');

    successMsg.classList.remove('show');
    errorMsg.classList.remove('show');

    const datos = {
      nombre_empresa: document.getElementById('p-nombre').value.trim(),
      rubro:          document.getElementById('p-rubro').value.trim(),
      descripcion:    document.getElementById('p-descripcion').value.trim(),
      provincia:      document.getElementById('p-provincia').value,
      ciudad:         document.getElementById('p-ciudad').value.trim(),
      palabras_clave: this.#tags,
    };

    if (!datos.nombre_empresa || !datos.rubro) {
      errorMsg.textContent = 'El nombre de la empresa y el rubro son requeridos';
      errorMsg.classList.add('show');
      return;
    }

    savingEl.style.display = 'inline';
    saveBtn.disabled = true;

    try {
      await this.#api.savePerfil(datos);
      successMsg.textContent = '✓ Perfil guardado correctamente';
      successMsg.classList.add('show');
      this.#actualizarPreview();
      setTimeout(() => successMsg.classList.remove('show'), 4000);
    } catch (err) {
      errorMsg.textContent = err.message || 'Error al guardar el perfil';
      errorMsg.classList.add('show');
    } finally {
      savingEl.style.display = 'none';
      saveBtn.disabled = false;
    }
  }

  #inferirPerfil() {
    const texto = document.getElementById('p-conversacion').value.trim();
    if (!texto) return;

    const normalizado = this.#normalizar(texto);
    const rubros = [
      ['limpieza', 'Servicios de limpieza'],
      ['sanitizacion', 'Servicios de limpieza y sanitización'],
      ['catering', 'Catering y alimentos'],
      ['alimento', 'Catering y alimentos'],
      ['software', 'Tecnología y software'],
      ['sistema', 'Tecnología y software'],
      ['mantenimiento', 'Mantenimiento y servicios generales'],
      ['construccion', 'Construcción y obras menores'],
      ['seguridad', 'Seguridad privada'],
      ['transporte', 'Transporte y logística'],
      ['insumo medico', 'Salud e insumos médicos'],
    ];

    const provincias = ['Buenos Aires', 'CABA', 'Córdoba', 'Santa Fe', 'Mendoza', 'Tucumán', 'Entre Ríos', 'Salta', 'Misiones', 'Chaco', 'Corrientes', 'Neuquén', 'Río Negro', 'Chubut', 'San Luis'];
    const ciudades = ['Pilar', 'Rosario', 'Mendoza', 'Córdoba', 'La Plata', 'Mar del Plata', 'Bahía Blanca', 'Neuquén', 'Salta', 'Tucumán'];

    const rubroDetectado = rubros.find(([clave]) => normalizado.includes(clave))?.[1] || 'Servicios generales';
    const provinciaDetectada = provincias.find((prov) => normalizado.includes(this.#normalizar(prov))) || '';
    const ciudadDetectada = ciudades.find((ciudad) => normalizado.includes(this.#normalizar(ciudad))) || '';
    const keywordsBase = ['limpieza', 'mantenimiento', 'alimentos', 'insumos', 'software', 'seguridad', 'transporte', 'sanitización', 'repuestos', 'construcción', 'catering'];
    const keywords = keywordsBase.filter((word) => normalizado.includes(this.#normalizar(word)));

    document.getElementById('p-rubro').value = rubroDetectado;
    document.getElementById('p-descripcion').value = texto;
    if (provinciaDetectada) document.getElementById('p-provincia').value = provinciaDetectada;
    if (ciudadDetectada) document.getElementById('p-ciudad').value = ciudadDetectada;
    this.#tags = [...new Set([...keywords, ...rubroDetectado.toLowerCase().split(/\s+/).filter((w) => w.length > 4)])].slice(0, 10);
    this.#renderTags();
    this.#actualizarPreview();
  }

  #actualizarPreview() {
    const rubro = document.getElementById('p-rubro')?.value || 'A completar';
    const provincia = document.getElementById('p-provincia')?.value || '';
    const ciudad = document.getElementById('p-ciudad')?.value || '';
    document.getElementById('profile-rubro-preview').textContent = rubro || 'A completar';
    document.getElementById('profile-zona-preview').textContent = [ciudad, provincia].filter(Boolean).join(', ') || 'A completar';
    document.getElementById('profile-keywords-preview').textContent = this.#tags.slice(0, 3).join(', ') || 'A completar';
  }

  #normalizar(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }
}
