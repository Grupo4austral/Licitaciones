/**
 * app.js — punto de entrada de LicitIA
 *
 * Clases ES6 instanciadas aquí:
 *   ApiService, AuthManager, WebSocketClient,
 *   LicitacionesView, FavoritosView, PerfilView, AlertasView, DetalleModal
 *
 * Seguridad: JWT enviado en cada llamada HTTP por ApiService.
 *            El backend valida el token en authMiddleware (middleware/auth.js).
 *
 * WebSocket: WebSocketClient se conecta a ws://host/ws?userId=<id>
 *            y muestra popups al recibir tipo "nueva_licitacion".
 *
 * API REST:  Al menos 1 GET (getLicitaciones) y 1 POST con body (login, register,
 *            savePerfil, addFavorito) — ver ApiService.js y routes/*.js.
 *
 * OOP:       Comunicación entre clases mediante custom events del DOM
 *            (licitia:ver-licitacion, licitia:navigate, licitia:alertas-actualizadas)
 *            y callbacks pasados como parámetros (no variables globales de window).
 */

import { ApiService }       from './ApiService.js';
import { AuthManager }      from './AuthManager.js';
import { WebSocketClient }  from './WebSocketClient.js';
import { LicitacionesView } from './LicitacionesView.js';
import { PerfilView }       from './PerfilView.js';
import { AlertasView }      from './AlertasView.js';
import { FavoritosView }    from './FavoritosView.js';
import { DetalleModal }     from './DetalleModal.js';

// ── Configuración (cambiar a URLs de producción al desplegar) ──────
const API_URL = 'http://localhost:3000/api';
const WS_URL  = 'ws://localhost:3000/ws';

// ── Instancias — scope de módulo, no window ────────────────────────
const api   = new ApiService(API_URL);
const auth  = new AuthManager(api);
const ws    = new WebSocketClient(WS_URL);
const modal = new DetalleModal(api);

// Las vistas se crean la primera vez que se necesitan (lazy init)
let licView      = null;
let favView      = null;
let perfilView   = null;
let alertasView  = null;

// ── Helpers de navegación ──────────────────────────────────────────

/** Muestra una página (landing / login / register / dashboard) */
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${pageId}`)?.classList.add('active');
}

/**
 * Muestra una sección dentro del dashboard e inicializa su vista si es la primera vez.
 * async porque FavoritosView.init() hace una llamada a la API.
 */
async function showSection(section) {
  // Ocultar todas y mostrar la pedida
  document.querySelectorAll('.dash-section').forEach(s => s.classList.add('hidden'));
  document.getElementById(`dash-${section}`)?.classList.remove('hidden');

  // Actualizar estado activo del sidebar
  document.querySelectorAll('.sidebar-item').forEach(b => {
    b.classList.toggle('active', b.dataset.section === section);
  });

  // Lazy init: inicializar la vista la primera vez que el usuario entra
  if (section === 'favoritos' && favView) {
    await favView.init();
  }
  if (section === 'alertas' && alertasView) {
    await alertasView.refresh();
  }
}

// ── Badge de alertas no leídas ─────────────────────────────────────

async function refreshBellBadge() {
  try {
    const alertas = await api.getAlertas(true); // solo no leídas
    const badge = document.getElementById('bell-badge');
    if (!badge) return;
    if (alertas.length > 0) {
      badge.textContent = alertas.length > 9 ? '9+' : String(alertas.length);
      badge.classList.add('visible');
    } else {
      badge.classList.remove('visible');
    }
  } catch {
    // Si el token expiró u otro error, no romper la UI
  }
}

// ── Inicialización del dashboard ───────────────────────────────────

async function initDashboard(user) {
  // Mostrar navbar con nombre del usuario
  document.getElementById('nav-username').textContent = user.nombre;
  document.getElementById('navbar').style.display = '';

  showPage('dashboard');
  await showSection('licitaciones');

  // Crear vistas (solo la primera vez)
  if (!licView) {
    licView = new LicitacionesView(api, 'dash-licitaciones');
    await licView.init();
  }

  if (!favView) {
    favView = new FavoritosView(api, 'favoritos-list');
    // NO llamamos init() acá; se llama lazy en showSection('favoritos')
  }

  if (!perfilView) {
    perfilView = new PerfilView(api, 'dash-perfil');
    await perfilView.init();
  }

  if (!alertasView) {
    alertasView = new AlertasView(api, 'dash-alertas');
    await alertasView.init();
  }

  // Conectar WebSocket con el userId del usuario autenticado
  ws.connect(user.id, auth.getToken(), async (_licitacion) => {
    // Callback: se ejecuta cuando llega una nueva licitación por WS
    // Refrescar lista y alertas para que el usuario las vea sin recargar
    await licView.refresh();
    await alertasView.refresh();
    await refreshBellBadge();
  });

  await refreshBellBadge();
}

// ── Setup formulario Login ─────────────────────────────────────────

function setupLoginForm() {
  const form    = document.getElementById('login-form');
  const errorEl = document.getElementById('login-error');
  const btn     = document.getElementById('login-btn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.classList.remove('visible');
    btn.disabled = true;
    btn.textContent = 'Ingresando…';

    try {
      const user = await auth.login(
        document.getElementById('login-email').value.trim(),
        document.getElementById('login-password').value
      );
      await initDashboard(user);
    } catch (err) {
      errorEl.textContent = err.message || 'Email o contraseña incorrectos';
      errorEl.classList.add('visible');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Ingresar';
    }
  });
}

// ── Setup formulario Registro ──────────────────────────────────────

function setupRegisterForm() {
  const form    = document.getElementById('register-form');
  const errorEl = document.getElementById('register-error');
  const btn     = document.getElementById('register-btn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.classList.remove('visible');
    btn.disabled = true;
    btn.textContent = 'Creando cuenta…';

    try {
      const user = await auth.register(
        document.getElementById('reg-nombre').value.trim(),
        document.getElementById('reg-email').value.trim(),
        document.getElementById('reg-password').value
      );
      await initDashboard(user);
    } catch (err) {
      errorEl.textContent = err.message || 'Error al crear la cuenta';
      errorEl.classList.add('visible');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Crear cuenta';
    }
  });
}

// ── Setup navegación ───────────────────────────────────────────────

function setupNavigation() {
  // Landing → Login / Register
  document.getElementById('btn-go-login')?.addEventListener('click', () => showPage('login'));
  document.getElementById('btn-go-register')?.addEventListener('click', () => showPage('register'));
  document.getElementById('btn-go-login-hero')?.addEventListener('click', () => showPage('login'));
  document.getElementById('btn-go-register-hero')?.addEventListener('click', () => showPage('register'));

  // Auth pages → cambio entre login / register / landing
  document.getElementById('link-go-register')?.addEventListener('click', (e) => { e.preventDefault(); showPage('register'); });
  document.getElementById('link-go-login')?.addEventListener('click', (e) => { e.preventDefault(); showPage('login'); });
  document.getElementById('link-go-landing-from-login')?.addEventListener('click', (e) => { e.preventDefault(); showPage('landing'); });
  document.getElementById('link-go-landing-from-register')?.addEventListener('click', (e) => { e.preventDefault(); showPage('landing'); });

  // Sidebar del dashboard
  document.querySelectorAll('.sidebar-item').forEach(btn => {
    btn.addEventListener('click', () => showSection(btn.dataset.section));
  });

  // Campana de alertas → ir a la sección de alertas
  document.getElementById('bell-btn')?.addEventListener('click', async () => {
    await showSection('alertas');
    document.getElementById('bell-badge')?.classList.remove('visible');
  });

  // Logout
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    auth.logout();
    ws.disconnect();
    // Resetear vistas para que la próxima sesión arranque limpia
    licView = favView = perfilView = alertasView = null;
    document.getElementById('navbar').style.display = 'none';
    showPage('landing');
  });

  // Evento custom: abrir modal de detalle de una licitación
  // Disparado desde LicitacionesView, FavoritosView y WebSocketClient
  document.addEventListener('licitia:ver-licitacion', async (e) => {
    await modal.open(e.detail.id);
  });

  // Evento custom: navegar a una sección o abrir detalle
  document.addEventListener('licitia:navigate', async (e) => {
    const { page, id } = e.detail;
    if (page === 'detalle' && id) {
      await modal.open(id);
    } else if (page) {
      await showSection(page);
    }
  });

  // Evento custom: refrescar badge cuando se leen alertas
  document.addEventListener('licitia:alertas-actualizadas', refreshBellBadge);
}

// ── Bootstrap ──────────────────────────────────────────────────────

async function bootstrap() {
  setupLoginForm();
  setupRegisterForm();
  setupNavigation();

  if (auth.isLoggedIn()) {
    // Restaurar sesión desde localStorage (token + user)
    await initDashboard(auth.getCurrentUser());
  } else {
    showPage('landing');
  }
}

// Punto de entrada: esperar a que el DOM esté listo
document.addEventListener('DOMContentLoaded', bootstrap);