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

// ── Configuración ─────────────────────────────────────────────────
// Local con python http.server usa frontend en :5500 y backend en :3000.
// En Render el backend sirve también el frontend, entonces usamos mismo origen.
const LOCAL_STATIC_FRONTEND = ['localhost', '127.0.0.1'].includes(window.location.hostname) &&
  window.location.port !== '3000';
const API_ORIGIN = LOCAL_STATIC_FRONTEND ? 'http://localhost:3000' : window.location.origin;
const WS_ORIGIN = LOCAL_STATIC_FRONTEND
  ? 'ws://localhost:3000'
  : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`;
const API_URL = `${API_ORIGIN}/api`;
const WS_URL  = `${WS_ORIGIN}/ws`;

// ── Instancias — scope de módulo, no window ────────────────────────
const api   = new ApiService(API_URL);
const auth  = new AuthManager(api);
const ws    = new WebSocketClient(WS_URL);
const modal = new DetalleModal(api);

window.addEventListener('error', (event) => {
  console.error('[App] Error global:', event.error || event.message);
  renderPanelError('sec-lic-inner', 'Error de JavaScript', event.error || new Error(event.message));
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[App] Promesa rechazada:', event.reason);
  renderPanelError('sec-lic-inner', 'Error cargando datos', event.reason);
});

// Las vistas se crean la primera vez que se necesitan (lazy init)
let licView      = null;
let favView      = null;
let perfilView   = null;
let alertasView  = null;

function renderPanelError(containerId, titulo, err) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">⚠️</div>
      <div class="empty-title">${titulo}</div>
      <p>${err?.message || 'Revisá que el backend esté corriendo y volvé a intentar.'}</p>
    </div>
  `;
}

function safeCreateView(containerId, titulo, factory) {
  try {
    return factory();
  } catch (err) {
    console.error(`[App] ${titulo}:`, err);
    renderPanelError(containerId, titulo, err);
    return null;
  }
}

function loadView(view, containerId, titulo) {
  if (!view?.init) return;
  view.init().catch(err => {
    console.error(`[App] ${titulo}:`, err);
    renderPanelError(containerId, titulo, err);
  });
}

function dashboardNeedsMount() {
  return document.getElementById('page-dashboard')?.classList.contains('active') &&
    !document.getElementById('lic-list');
}

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
  document.querySelectorAll('.dash-section').forEach(s => s.classList.remove('visible'));
  document.getElementById(`sec-${section}`)?.classList.add('visible');

  // Actualizar estado activo del sidebar
  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.sec === section);
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
    const badge = document.getElementById('bell-count');
    const sidebarBadge = document.getElementById('sidebar-alert-badge');
    if (!badge) return;
    if (alertas.length > 0) {
      const count = alertas.length > 9 ? '9+' : String(alertas.length);
      badge.textContent = count;
      badge.classList.add('show');
      if (sidebarBadge) {
        sidebarBadge.textContent = count;
        sidebarBadge.classList.add('show');
      }
    } else {
      badge.classList.remove('show');
      if (sidebarBadge) sidebarBadge.classList.remove('show');
    }
  } catch {
    // Si el token expiró u otro error, no romper la UI
  }
}

// ── Inicialización del dashboard ───────────────────────────────────

async function initDashboard(user) {
  // Mostrar navbar con nombre del usuario
  const username = document.getElementById('topbar-name');
  if (username) username.textContent = user.nombre;

  showPage('dashboard');
  setupAssistantDemo();

  // Crear las vistas sin esperar APIs: así los placeholders se reemplazan al instante.
  if (!licView) {
    licView = safeCreateView(
      'sec-lic-inner',
      'No pudimos montar licitaciones',
      () => new LicitacionesView(api, 'sec-lic-inner')
    );
  }

  if (!favView) {
    favView = safeCreateView(
      'sec-fav-inner',
      'No pudimos montar favoritos',
      () => new FavoritosView(api, 'sec-fav-inner')
    );
  }

  if (!perfilView) {
    perfilView = safeCreateView(
      'sec-perfil-inner',
      'No pudimos montar el perfil',
      () => new PerfilView(api, 'sec-perfil-inner')
    );
  }

  if (!alertasView) {
    alertasView = safeCreateView(
      'sec-alerta-inner',
      'No pudimos montar alertas',
      () => new AlertasView(api, 'sec-alerta-inner')
    );
  }

  await showSection('licitaciones');

  loadView(licView, 'sec-lic-inner', 'No pudimos cargar licitaciones');
  loadView(perfilView, 'sec-perfil-inner', 'No pudimos cargar el perfil');
  loadView(alertasView, 'sec-alerta-inner', 'No pudimos cargar alertas');

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

function setupAssistantDemo() {
  const chat = document.getElementById('assistant-chat');
  if (!chat || chat.dataset.ready === '1') return;
  chat.dataset.ready = '1';
  const mode = document.getElementById('assistant-mode');
  const form = document.getElementById('assistant-form');
  const input = document.getElementById('assistant-question');
  const send = document.getElementById('assistant-send');

  async function preguntarIA(pregunta) {
    if (!pregunta) return;
    chat.insertAdjacentHTML('beforeend', `<div class="assistant-msg user">${escapeHtml(pregunta)}</div>`);
    const pending = document.createElement('div');
    pending.className = 'assistant-msg ai';
    pending.textContent = 'Consultando a la IA...';
    chat.appendChild(pending);
    pending.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    if (send) send.disabled = true;
    try {
      const data = await api.preguntarAsistenteGeneral(pregunta);
      pending.textContent = data.respuesta || 'No se recibió respuesta.';
      if (mode) {
        mode.textContent = data.modo === 'ia' ? 'Generado con IA' : data.modo === 'demo' ? 'Modo demo sin API key' : 'Análisis local de respaldo';
        mode.className = `assistant-mode ${data.modo || 'ia'}`;
      }
    } catch (err) {
      pending.textContent = `No pude consultar el asistente: ${err.message}`;
      if (mode) {
        mode.textContent = 'Sin conexión con IA';
        mode.className = 'assistant-mode fallback';
      }
    } finally {
      if (send) send.disabled = false;
      pending.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  document.querySelectorAll('[data-ai-question]').forEach((btn) => {
    btn.addEventListener('click', () => {
      preguntarIA(btn.dataset.aiQuestion || btn.textContent.trim());
    });
  });

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const pregunta = input?.value.trim();
    if (!pregunta) return;
    input.value = '';
    preguntarIA(pregunta);
  });
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

// ── Setup formulario Login ─────────────────────────────────────────

function setupLoginForm() {
  const form    = document.getElementById('login-form');
  const errorEl = document.getElementById('login-err');
  const btn     = document.getElementById('login-btn');
  if (!form || !errorEl || !btn) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.classList.remove('show');
    btn.disabled = true;
    btn.textContent = 'Ingresando…';

    try {
      const user = await auth.login(
        document.getElementById('login-cuit').value.trim(),
        document.getElementById('login-pass').value
      );
      await initDashboard(user);
    } catch (err) {
      errorEl.textContent = err.message || 'Email o contraseña incorrectos';
      errorEl.classList.add('show');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Ingresar';
    }
  });
}

// ── Setup formulario Registro ──────────────────────────────────────

function setupRegisterForm() {
  const form    = document.getElementById('reg-form');
  const errorEl = document.getElementById('reg-err');
  const btn     = document.getElementById('reg-btn');
  if (!form || !errorEl || !btn) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.classList.remove('show');
    btn.disabled = true;
    btn.textContent = 'Creando cuenta…';

    try {
      const user = await auth.register(
        document.getElementById('reg-nombre').value.trim(),
        document.getElementById('reg-cuit').value.trim(),
        document.getElementById('reg-email').value.trim(),
        document.getElementById('reg-pass').value
      );
      await initDashboard(user);
    } catch (err) {
      errorEl.textContent = err.message || 'Error al crear la cuenta';
      errorEl.classList.add('show');
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
  document.getElementById('lnk-to-register')?.addEventListener('click', (e) => { e.preventDefault(); showPage('register'); });
  document.getElementById('lnk-to-login')?.addEventListener('click', (e) => { e.preventDefault(); showPage('login'); });
  document.getElementById('lnk-login-to-landing')?.addEventListener('click', (e) => { e.preventDefault(); showPage('landing'); });
  document.getElementById('lnk-reg-to-landing')?.addEventListener('click', (e) => { e.preventDefault(); showPage('landing'); });

  // Sidebar del dashboard
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => showSection(btn.dataset.sec));
  });

  // Campana de alertas → ir a la sección de alertas
  document.getElementById('bell-btn')?.addEventListener('click', async () => {
    await showSection('alertas');
    document.getElementById('bell-count')?.classList.remove('show');
  });

  // Logout
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    auth.logout();
    ws.disconnect();
    // Resetear vistas para que la próxima sesión arranque limpia
    licView = favView = perfilView = alertasView = null;
    showPage('landing');
  });

  // Evento custom: abrir modal de detalle de una licitación
  // Disparado desde LicitacionesView, FavoritosView y WebSocketClient
  document.addEventListener('licitia:ver-licitacion', async (e) => {
    await modal.open(e.detail.lic || e.detail.id);
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

  document.addEventListener('licitia:favoritos-actualizados', async () => {
    if (favView) await favView.refresh();
  });
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

  // Si el navegador quedó con una sesión previa y alguna excepción interrumpió
  // el montaje, evitamos el spinner eterno reintentando una vez.
  setTimeout(() => {
    if (auth.isLoggedIn() && dashboardNeedsMount()) {
      initDashboard(auth.getCurrentUser());
    }
  }, 800);
}

// Punto de entrada: esperar a que el DOM esté listo
document.addEventListener('DOMContentLoaded', bootstrap);
