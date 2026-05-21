/**
 * ApiService — clase ES6 que centraliza todas las llamadas HTTP al backend
 * Maneja autenticación con JWT automáticamente
 */
export class ApiService {
  #baseUrl;
  #token;

  constructor(baseUrl = 'http://localhost:3000/api') {
    this.#baseUrl = baseUrl;
    this.#token = localStorage.getItem('licitia_token') || null;
  }

  setToken(token) {
    this.#token = token;
    if (token) {
      localStorage.setItem('licitia_token', token);
    } else {
      localStorage.removeItem('licitia_token');
    }
  }

  getToken() {
    return this.#token;
  }

  #getHeaders(extra = {}) {
    const headers = { 'Content-Type': 'application/json', ...extra };
    if (this.#token) headers['Authorization'] = `Bearer ${this.#token}`;
    return headers;
  }

  async #request(method, path, body = null) {
    const opts = {
      method,
      headers: this.#getHeaders(),
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${this.#baseUrl}${path}`, opts);
    const data = await res.json();

    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.detalle = data.detalle;
      throw err;
    }
    return data;
  }

  // ── Auth ─────────────────────────────────────────────────────────
  async register(nombre, email, password) {
    return this.#request('POST', '/auth/register', { nombre, email, password });
  }

  async login(email, password) {
    return this.#request('POST', '/auth/login', { email, password });
  }

  // ── Licitaciones ─────────────────────────────────────────────────
  async getLicitaciones({ rubro, provincia, q, page = 1, limit = 20 } = {}) {
    const params = new URLSearchParams();
    if (rubro)    params.set('rubro', rubro);
    if (provincia) params.set('provincia', provincia);
    if (q)        params.set('q', q);
    params.set('page', page);
    params.set('limit', limit);
    return this.#request('GET', `/licitaciones?${params}`);
  }

  async getLicitacion(id) {
    return this.#request('GET', `/licitaciones/${id}`);
  }

  // ── Perfil ────────────────────────────────────────────────────────
  async getPerfil() {
    return this.#request('GET', '/perfil');
  }

  async savePerfil(datos) {
    return this.#request('POST', '/perfil', datos);
  }

  // ── Favoritos ─────────────────────────────────────────────────────
  async getFavoritos() {
    return this.#request('GET', '/favoritos');
  }

  async addFavorito(licitacion_id) {
    return this.#request('POST', '/favoritos', { licitacion_id });
  }

  async removeFavorito(licitacion_id) {
    return this.#request('DELETE', `/favoritos/${licitacion_id}`);
  }

  // ── Alertas ───────────────────────────────────────────────────────
  async getAlertas(soloNoLeidas = false) {
    return this.#request('GET', `/alertas?soloNoLeidas=${soloNoLeidas}`);
  }

  async marcarLeida(id) {
    return this.#request('POST', `/alertas/${id}/leer`);
  }

  async marcarTodasLeidas() {
    return this.#request('POST', '/alertas/leer-todas');
  }
}
