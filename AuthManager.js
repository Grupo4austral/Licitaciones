/**
 * AuthManager — maneja login, registro, sesión y persistencia en localStorage.
 *
 * El token JWT se guarda en localStorage para restaurar sesiones entre recargas.
 * Se expone con getToken() para que WebSocketClient pueda usarlo al conectar.
 */
export class AuthManager {
  #api;
  #currentUser;
  #token;
  #onLoginCallback;
  #onLogoutCallback;

  constructor(apiService) {
    this.#api              = apiService;
    this.#currentUser      = null;
    this.#token            = null;
    this.#onLoginCallback  = null;
    this.#onLogoutCallback = null;

    this.#restaurarSesion();
  }

  // ── Restaurar sesión desde localStorage ──────────────────────────────────────

  #restaurarSesion() {
    const token    = localStorage.getItem('licitia_token');
    const userData = localStorage.getItem('licitia_user');
    if (token && userData) {
      try {
        this.#token       = token;
        this.#currentUser = JSON.parse(userData);
        this.#api.setToken(token);
      } catch {
        this.#limpiarStorage();
      }
    }
  }

  // ── Callbacks ────────────────────────────────────────────────────────────────

  onLogin(cb)  { this.#onLoginCallback  = cb; }
  onLogout(cb) { this.#onLogoutCallback = cb; }

  // ── Estado ───────────────────────────────────────────────────────────────────

  isLoggedIn()     { return this.#currentUser !== null && this.#token !== null; }
  getCurrentUser() { return this.#currentUser; }

  /** Retorna el JWT actual. Usado por WebSocketClient para autenticar la conexión WS. */
  getToken()       { return this.#token; }

  // ── Acciones ─────────────────────────────────────────────────────────────────

  async login(cuit, password) {
    const data = await this.#api.login(cuit, password);
    this.#guardarSesion(data.usuario, data.token);
    if (this.#onLoginCallback) this.#onLoginCallback(data.usuario);
    return data.usuario;
  }

  async register(nombre, cuit, email, password) {
    const data = await this.#api.register(nombre, cuit, email, password);
    this.#guardarSesion(data.usuario, data.token);
    if (this.#onLoginCallback) this.#onLoginCallback(data.usuario);
    return data.usuario;
  }

  logout() {
    this.#limpiarStorage();
    this.#currentUser = null;
    this.#token       = null;
    if (this.#onLogoutCallback) this.#onLogoutCallback();
  }

  // ── Helpers privados ──────────────────────────────────────────────────────────

  #guardarSesion(usuario, token) {
    this.#currentUser = usuario;
    this.#token       = token;
    this.#api.setToken(token);
    localStorage.setItem('licitia_token', token);
    localStorage.setItem('licitia_user', JSON.stringify(usuario));
  }

  #limpiarStorage() {
    this.#api.setToken(null);
    localStorage.removeItem('licitia_token');
    localStorage.removeItem('licitia_user');
  }
}
