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
      <div class="section-header">
        <div>
          <h2 class="section-title">Perfil de empresa</h2>
          <p class="section-subtitle">Tu perfil determina qué licitaciones te recomendamos</p>
        </div>
      </div>

      <div id="perfil-success-msg" class="error-msg" style="background:rgba(34,197,94,0.1);border-color:rgba(34,197,94,0.3);color:#86efac;margin-bottom:1rem;"></div>
      <div id="perfil-error-msg" class="error-msg"></div>

      <form class="perfil-form" id="perfil-form" novalidate>
        <div class="form-group">
          <label for="p-nombre">Nombre de la empresa</label>
          <input id="p-nombre" class="form-control" type="text" placeholder="Ej: Limpieza Total SRL" />
        </div>

        <div class="form-group">
          <label for="p-rubro">Rubro principal</label>
          <input id="p-rubro" class="form-control" type="text" placeholder="Ej: Servicios de limpieza" />
        </div>

        <div class="form-group">
          <label for="p-descripcion">Descripción de la empresa</label>
          <textarea id="p-descripcion" class="form-control" placeholder="Contanos qué hace tu empresa, qué productos o servicios ofrecen…"></textarea>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
          <div class="form-group">
            <label for="p-provincia">Provincia</label>
            <select id="p-provincia" class="form-control">
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
          <div class="form-group">
            <label for="p-ciudad">Ciudad</label>
            <input id="p-ciudad" class="form-control" type="text" placeholder="Ej: Pilar" />
          </div>
        </div>

        <div class="form-group">
          <label>Palabras clave <span style="font-weight:400;text-transform:none;letter-spacing:0">(presioná Enter para agregar)</span></label>
          <div class="tags-input-wrapper" id="tags-wrapper">
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
          <span id="perfil-saving" style="color:var(--color-muted);font-size:0.85rem;display:none">Guardando…</span>
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
    } catch {
      // No tiene perfil aún — formulario vacío
    }
  }

  async #save() {
    const successMsg = document.getElementById('perfil-success-msg');
    const errorMsg   = document.getElementById('perfil-error-msg');
    const savingEl   = document.getElementById('perfil-saving');
    const saveBtn    = document.getElementById('perfil-save-btn');

    successMsg.classList.remove('visible');
    errorMsg.classList.remove('visible');

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
      errorMsg.classList.add('visible');
      return;
    }

    savingEl.style.display = 'inline';
    saveBtn.disabled = true;

    try {
      await this.#api.savePerfil(datos);
      successMsg.textContent = '✓ Perfil guardado correctamente';
      successMsg.classList.add('visible');
      setTimeout(() => successMsg.classList.remove('visible'), 4000);
    } catch (err) {
      errorMsg.textContent = err.message || 'Error al guardar el perfil';
      errorMsg.classList.add('visible');
    } finally {
      savingEl.style.display = 'none';
      saveBtn.disabled = false;
    }
  }
}
