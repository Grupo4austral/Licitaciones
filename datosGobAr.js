/**
 * datosGobAr.js — Servicio de ingesta de licitaciones nacionales.
 *
 * Fuente actual:
 *   COMPR.AR (https://comprar.gob.ar), portal publico oficial de contrataciones
 *   de bienes y servicios de la Administracion Publica Nacional.
 *
 * Fuente de datos abiertos historica:
 *   datos.gob.ar publica el dataset "Sistema de Contrataciones Electronicas"
 *   de la ONC mediante CKAN. Ese catalogo es util como respaldo/documentacion,
 *   pero no esta actualizado con la frecuencia necesaria para alertas en vivo.
 *
 * Estrategia:
 *   - Polling periodico sobre la pagina publica de COMPR.AR.
 *   - Transformacion al esquema de LicitIA.
 *   - Deduplicacion por url_original.
 *   - Persistencia en Supabase.
 *   - Notificacion por WebSocket + alerta persistente cuando aparece algo nuevo.
 */

import { supabase } from './supabase.js';
import { wsManager } from './websocket.js';

const COMPRAR_BASE_URL = 'https://comprar.gob.ar';
const COMPRAR_HOME_URL = `${COMPRAR_BASE_URL}/`;
const COMPRAR_APERTURA_PROXIMA_URL = `${COMPRAR_BASE_URL}/Compras.aspx?qs=W1HXHGHtH10=`;
const COMPRAR_APERTURA_PROXIMA_POST_URL = `${COMPRAR_BASE_URL}/Compras.aspx?qs=W1HXHGHtH10%3d&AspxAutoDetectCookieSupport=1`;
const POLL_INTERVAL_MS = parseInt(process.env.LICITACIONES_POLL_MS || '', 10) || 5 * 60 * 1000;
const DEFAULT_LIMIT = 500;

class DatosGobArService {
  #timer;
  #corriendo;

  constructor() {
    this.#timer = null;
    this.#corriendo = false;
  }

  start() {
    if (this.#corriendo) return;
    this.#corriendo = true;

    console.log(`[COMPR.AR] Servicio de ingesta iniciado. Poll cada ${Math.round(POLL_INTERVAL_MS / 1000)}s.`);
    this.#poll();
    this.#timer = setInterval(() => this.#poll(), POLL_INTERVAL_MS);
  }

  stop() {
    if (this.#timer) clearInterval(this.#timer);
    this.#corriendo = false;
    console.log('[COMPR.AR] Servicio de ingesta detenido.');
  }

  async fetchOportunidadesActuales({ q = '', limit = DEFAULT_LIMIT } = {}) {
    const licitaciones = await this.#fetchAperturaProxima({ limit });
    const normalizada = this.#normalizarTexto(q);

    return licitaciones
      .filter((lic) => this.#esVigente(lic))
      .filter((lic) => {
        if (!normalizada) return true;
        const haystack = this.#normalizarTexto([
          lic.numero_proceso,
          lic.titulo,
          lic.descripcion,
          lic.organismo,
          lic.rubro,
        ].filter(Boolean).join(' '));
        return haystack.includes(normalizada);
      })
      .slice(0, limit);
  }

  async #poll() {
    try {
      const licitaciones = await this.fetchOportunidadesActuales({ limit: DEFAULT_LIMIT });
      if (licitaciones.length === 0) {
        console.log('[COMPR.AR] No se detectaron procesos en la fuente publica.');
        return;
      }

      const nuevas = await this.#filtrarNuevas(licitaciones);
      if (nuevas.length === 0) {
        console.log('[COMPR.AR] Sin licitaciones nuevas.');
        return;
      }

      const insertadas = await this.#persistir(nuevas);
      for (const licitacion of insertadas) {
        await this.#notificar(licitacion);
      }

      console.log(`[COMPR.AR] ${insertadas.length} licitacion/es nuevas ingresadas.`);
    } catch (err) {
      console.error('[COMPR.AR] Error durante la ingesta:', err.message);
    }
  }

  async #fetchComprarHome() {
    const response = await fetch(COMPRAR_HOME_URL, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'LicitIA/1.0 (+https://licitia.local)',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`COMPR.AR respondio con HTTP ${response.status}`);
    }

    return response.text();
  }

  async #fetchAperturaProxima({ limit = DEFAULT_LIMIT } = {}) {
    const jar = new Map();
    let html = await this.#fetchComprarHtml(COMPRAR_APERTURA_PROXIMA_URL, { jar });
    let licitaciones = this.#parseComprarAperturaProxima(html);
    const visitadas = new Set(['Page$1']);
    const pendientes = this.#extraerLinksPaginador(html)
      .filter((eventArg) => !visitadas.has(eventArg))
      .map((eventArg) => ({ eventArg, htmlOrigen: html }));

    while (pendientes.length > 0 && licitaciones.length < limit) {
      const { eventArg, htmlOrigen } = pendientes.shift();
      if (visitadas.has(eventArg)) continue;
      visitadas.add(eventArg);

      const fields = this.#extraerHiddenInputs(htmlOrigen);
      fields.set('__EVENTTARGET', 'ctl00$CPH1$GridListaPliegosAperturaProxima');
      fields.set('__EVENTARGUMENT', eventArg);

      html = await this.#fetchComprarHtml(COMPRAR_APERTURA_PROXIMA_POST_URL, {
        jar,
        method: 'POST',
        body: fields,
      });

      licitaciones = licitaciones.concat(this.#parseComprarAperturaProxima(html));
      for (const nuevoEventArg of this.#extraerLinksPaginador(html)) {
        if (visitadas.has(nuevoEventArg)) continue;
        if (pendientes.some((item) => item.eventArg === nuevoEventArg)) continue;
        pendientes.push({ eventArg: nuevoEventArg, htmlOrigen: html });
      }
    }

    return this.#dedupe(licitaciones).slice(0, limit);
  }

  async #fetchComprarHtml(url, { jar, method = 'GET', body = null } = {}) {
    const headers = {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'LicitIA/1.0 (+https://licitia.local)',
    };

    if (jar?.size) headers.Cookie = this.#cookieHeader(jar);
    if (method === 'POST') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers.Origin = COMPRAR_BASE_URL;
      headers.Referer = COMPRAR_APERTURA_PROXIMA_URL;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? body.toString() : null,
      signal: AbortSignal.timeout(15000),
    });

    this.#guardarCookies(response, jar);

    if (!response.ok) {
      throw new Error(`COMPR.AR respondio con HTTP ${response.status}`);
    }

    return response.text();
  }

  #guardarCookies(response, jar) {
    if (!jar) return;
    const setCookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);

    for (const rawCookie of setCookies) {
      for (const cookie of String(rawCookie).split(/,(?=[^;,]+=)/)) {
        const pair = cookie.split(';')[0];
        const idx = pair.indexOf('=');
        if (idx <= 0) continue;
        jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
      }
    }
  }

  #cookieHeader(jar) {
    return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
  }

  #parseComprarHome(html) {
    const text = this.#htmlToText(html);
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const licitaciones = this.#parseFilasConSeparadores(text);
    const procesoRegex = /^\d{1,5}\/\d{1,4}-\d{3,5}-[A-Z]{2,5}\d{2}$/;

    for (let i = 0; i < lines.length; i++) {
      const numeroProceso = lines[i];
      if (!procesoRegex.test(numeroProceso)) continue;

      const titulo = lines[i + 1];
      const tipo = lines[i + 2];
      const fechaCierreTexto = lines[i + 3];

      if (!titulo || !tipo || !this.#pareceFechaArgentina(fechaCierreTexto)) continue;

      licitaciones.push(this.#crearLicitacionDesdeComprar({
        numeroProceso,
        titulo,
        tipo,
        fechaCierreTexto,
      }));
    }

    return this.#dedupe(licitaciones);
  }

  #parseComprarAperturaProxima(html) {
    const licitaciones = [];
    const tableMatch = html.match(/<table[^>]+id="ctl00_CPH1_GridListaPliegosAperturaProxima"[\s\S]*?<\/table>/i);
    if (!tableMatch) return licitaciones;

    const rowRegex = /<tr(?![^>]*class="pagination-gv")[^>]*>([\s\S]*?)<\/tr>/gi;
    for (const rowMatch of tableMatch[0].matchAll(rowRegex)) {
      const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
        .map((cell) => this.#htmlToText(cell[1]).trim())
        .filter(Boolean);

      if (cells.length < 7) continue;
      const [numeroProceso, titulo, tipo, fechaCierreTexto, estado, unidadEjecutora, servicioAdministrativo] = cells;
      if (!/^\d{1,5}\/\d{1,4}-\d{3,5}-[A-Z]{2,5}\d{2}$/.test(numeroProceso)) continue;

      licitaciones.push(this.#crearLicitacionDesdeComprar({
        numeroProceso,
        titulo,
        tipo,
        fechaCierreTexto,
        organismo: unidadEjecutora,
        estado,
        servicioAdministrativo,
        urlOriginal: COMPRAR_APERTURA_PROXIMA_URL,
      }));
    }

    return licitaciones;
  }

  #parseFilasConSeparadores(text) {
    const licitaciones = [];
    const rowRegex = /(\d{1,5}\/\d{1,4}-\d{3,5}-[A-Z]{2,5}\d{2})\s*\|\s*([^|\n]+?)\s*\|\s*([^|\n]+?)\s*\|\s*(\d{2}\/\d{2}\/\d{4}[^\n|]*)/g;

    for (const match of text.matchAll(rowRegex)) {
      const [, numeroProceso, titulo, tipo, fechaCierreTexto] = match;
      licitaciones.push(this.#crearLicitacionDesdeComprar({
        numeroProceso,
        titulo,
        tipo,
        fechaCierreTexto,
      }));
    }

    return licitaciones;
  }

  #crearLicitacionDesdeComprar({
    numeroProceso,
    titulo,
    tipo,
    fechaCierreTexto,
    organismo = null,
    estado = null,
    servicioAdministrativo = null,
    urlOriginal = `${COMPRAR_BASE_URL}/BuscarAvanzado.aspx`,
  }) {
    return {
      id: numeroProceso,
      fuente: 'COMPR.AR',
      numero_proceso: numeroProceso,
      titulo: this.#limpiar(titulo),
      organismo: this.#limpiar(organismo),
      descripcion: this.#limpiar(`${tipo}. Estado: ${estado || 'Publicado'}. Apertura/cierre ${fechaCierreTexto}. ${servicioAdministrativo || ''}`),
      rubro: this.#limpiar(tipo),
      provincia: null,
      fecha_publicacion: new Date().toISOString().split('T')[0],
      fecha_cierre: this.#parseFechaArgentina(fechaCierreTexto),
      presupuesto_estimado: null,
      url_original: `${urlOriginal}${urlOriginal.includes('?') ? '&' : '?'}proceso=${encodeURIComponent(numeroProceso)}`,
      datos_originales: {
        fuente: 'COMPR.AR',
        numero_proceso: numeroProceso,
        tipo,
        estado,
        unidad_ejecutora: organismo,
        servicio_administrativo: servicioAdministrativo,
        fecha_cierre_texto: fechaCierreTexto,
        capturado_en: new Date().toISOString(),
      },
    };
  }

  #esVigente(licitacion) {
    if (!licitacion.fecha_cierre) return true;
    const hoy = new Date().toISOString().split('T')[0];
    return licitacion.fecha_cierre >= hoy;
  }

  async #filtrarNuevas(licitaciones) {
    const urls = licitaciones.map((lic) => lic.url_original).filter(Boolean);
    if (urls.length === 0) return [];

    const data = [];
    const batchSize = 80;
    for (let i = 0; i < urls.length; i += batchSize) {
      const batch = urls.slice(i, i + batchSize);
      const { data: rows, error } = await supabase
        .from('licitaciones')
        .select('url_original')
        .in('url_original', batch);

      if (error) throw error;
      data.push(...(rows || []));
    }

    const existentes = new Set((data || []).map((row) => row.url_original));
    return licitaciones.filter((lic) => !existentes.has(lic.url_original));
  }

  async #persistir(licitaciones) {
    const filas = licitaciones.map((lic) => ({
      fuente: lic.fuente,
      titulo: lic.titulo,
      organismo: lic.organismo,
      descripcion: lic.descripcion,
      rubro: lic.rubro,
      provincia: lic.provincia,
      fecha_publicacion: lic.fecha_publicacion,
      fecha_cierre: lic.fecha_cierre,
      presupuesto_estimado: lic.presupuesto_estimado,
      url_original: lic.url_original,
      datos_originales: lic.datos_originales,
    }));

    const { data, error } = await supabase
      .from('licitaciones')
      .insert(filas)
      .select();

    if (error) {
      console.error('[COMPR.AR] Error al insertar en Supabase:', error.message);
      return [];
    }

    return data || [];
  }

  async #notificar(licitacion) {
    try {
      const { data: perfiles, error } = await supabase
        .from('perfiles_empresa')
        .select('usuario_id, rubro, provincia, palabras_clave');

      if (error || !perfiles) return;

      for (const perfil of perfiles) {
        if (!this.#esCompatible(licitacion, perfil)) continue;

        wsManager.notificarNuevaLicitacion(perfil.usuario_id, licitacion);

        await supabase.from('alertas').insert({
          usuario_id: perfil.usuario_id,
          licitacion_id: licitacion.id,
          mensaje: `Nueva licitacion nacional: "${licitacion.titulo}"`,
        });
      }
    } catch (err) {
      console.error('[COMPR.AR] Error al notificar:', err.message);
    }
  }

  #esCompatible(licitacion, perfil) {
    const textoLicitacion = this.#normalizarTexto([
      licitacion.titulo,
      licitacion.descripcion,
      licitacion.rubro,
      licitacion.provincia,
    ].filter(Boolean).join(' '));

    const rubro = this.#normalizarTexto(perfil.rubro || '');
    const provincia = this.#normalizarTexto(perfil.provincia || '');
    const palabrasClave = Array.isArray(perfil.palabras_clave) ? perfil.palabras_clave : [];

    const rubroOk = rubro && rubro.split(/\s+/).some((word) => word.length > 3 && textoLicitacion.includes(word));
    const provinciaOk = provincia && textoLicitacion.includes(provincia);
    const keywordsOk = palabrasClave.some((word) => {
      const normalizada = this.#normalizarTexto(word);
      return normalizada.length > 3 && textoLicitacion.includes(normalizada);
    });

    return rubroOk || provinciaOk || keywordsOk;
  }

  #htmlToText(html) {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '\n')
      .replace(/<style[\s\S]*?<\/style>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|td|th|span|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\r/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s+/g, '\n');
  }

  #pareceFechaArgentina(value) {
    return /^\d{2}\/\d{2}\/\d{4}/.test(String(value || ''));
  }

  #parseFechaArgentina(value) {
    const match = String(value || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (!match) return null;
    const [, day, month, year] = match;
    return `${year}-${month}-${day}`;
  }

  #extraerTotalResultados(html) {
    const match = String(html || '').match(/Se han encontrado\s*\((\d+)\)/i);
    return match ? Number(match[1]) : null;
  }

  #extraerHiddenInputs(html) {
    const fields = new URLSearchParams();
    const inputRegex = /<input\b[^>]*type="hidden"[^>]*>/gi;

    for (const match of String(html || '').matchAll(inputRegex)) {
      const tag = match[0];
      const name = this.#extraerAtributo(tag, 'name');
      if (!name) continue;
      fields.set(name, this.#decodeHtml(this.#extraerAtributo(tag, 'value') || ''));
    }

    if (!fields.has('__EVENTTARGET')) fields.set('__EVENTTARGET', '');
    if (!fields.has('__EVENTARGUMENT')) fields.set('__EVENTARGUMENT', '');
    return fields;
  }

  #extraerLinksPaginador(html) {
    const links = [];
    const regex = /__doPostBack\(&#39;ctl00\$CPH1\$GridListaPliegosAperturaProxima&#39;,&#39;(Page\$\d+)&#39;\)/g;

    for (const match of String(html || '').matchAll(regex)) {
      links.push(match[1]);
    }

    return [...new Set(links)].sort((a, b) => {
      const pageA = Number(a.split('$')[1]);
      const pageB = Number(b.split('$')[1]);
      return pageA - pageB;
    });
  }

  #extraerAtributo(tag, attr) {
    const match = String(tag || '').match(new RegExp(`${attr}="([^"]*)"`, 'i'));
    return match ? match[1] : null;
  }

  #normalizarTexto(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  #limpiar(value) {
    if (!value || typeof value !== 'string') return null;
    const limpio = this.#decodeHtml(value)
      .replace(/\s+/g, ' ')
      .trim();
    return limpio || null;
  }

  #decodeHtml(value) {
    return String(value || '')
      .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
      .replace(/&#x([a-f0-9]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)))
      .replace(/&aacute;/gi, 'á')
      .replace(/&eacute;/gi, 'é')
      .replace(/&iacute;/gi, 'í')
      .replace(/&oacute;/gi, 'ó')
      .replace(/&uacute;/gi, 'ú')
      .replace(/&ntilde;/gi, 'ñ')
      .replace(/&Aacute;/g, 'Á')
      .replace(/&Eacute;/g, 'É')
      .replace(/&Iacute;/g, 'Í')
      .replace(/&Oacute;/g, 'Ó')
      .replace(/&Uacute;/g, 'Ú')
      .replace(/&Ntilde;/g, 'Ñ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  #dedupe(licitaciones) {
    const vistas = new Set();
    return licitaciones.filter((lic) => {
      if (vistas.has(lic.url_original)) return false;
      vistas.add(lic.url_original);
      return true;
    });
  }
}

export const datosGobArService = new DatosGobArService();
