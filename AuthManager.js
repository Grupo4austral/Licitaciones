/**
 * AuthManager — maneja login, registro y sesión del usuario
 */
export class AuthManager {
  #api;
  #currentUser;
  #onLoginCallback;
  #onLogoutCallback;

  constructor(apiService) {
    this.#api = apiService;
    this.#currentUser = null;
    this.#onLoginCallback = null;
    this.#onLogoutCallback = null;

    // Intentar restaurar sesión desde localStorage
    this.#restoreSession();
  }

  #restoreSession() {
    const token = localStorage.getItem('licitia_token');
    const userData = localStorage.getItem('licitia_user');
    if (token && userData) {
      try {
        this.#currentUser = JSON.parse(userData);
        this.#api.setToken(token);
      } catch {
        this.logout();
      }
    }
  }

  onLogin(callback)  { this.#onLoginCallback = callback; }
  onLogout(callback) { this.#onLogoutCallback = callback; }

  isLoggedIn() {
    return this.#currentUser !== null && this.#api.getToken() !== null;
  }

  getCurrentUser() {
    return this.#currentUser;
  }

  async login(email, password) {
    const data = await this.#api.login(email, password);
    this.#currentUser = data.usuario;
    this.#api.setToken(data.token);
    localStorage.setItem('licitia_user', JSON.stringify(data.usuario));
    if (this.#onLoginCallback) this.#onLoginCallback(data.usuario);
    return data.usuario;
  }

  async register(nombre, email, password) {
    const data = await this.#api.register(nombre, email, password);
    this.#currentUser = data.usuario;
    this.#api.setToken(data.token);
    localStorage.setItem('licitia_user', JSON.stringify(data.usuario));
    if (this.#onLoginCallback) this.#onLoginCallback(data.usuario);
    return data.usuario;
  }

  logout() {
    this.#currentUser = null;
    this.#api.setToken(null);
    localStorage.removeItem('licitia_user');
    if (this.#onLogoutCallback) this.#onLogoutCallback();
  }
}
