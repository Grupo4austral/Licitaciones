/**
 * datosGobAr.js — Servicio de ingesta de licitaciones desde la API pública argentina
 *
 * Fuente oficial: datos.gob.ar — API CKAN de la Oficina Nacional de Contrataciones (ONC)
 * Dataset: Sistema de Contrataciones Electrónicas (Argentina Compra / COMPR.AR)
 * URL dataset: https://datos.gob.ar/dataset/jgm-sistema-contrataciones-electronicas-argentina-compra
 *
 * La API CKAN es pública, gratuita y no requiere autenticación.
 * Endpoint base: https://datos.gob.ar/api/3/action/datastore_search
 *
 * Campos que usa el endpoint (los que existen en los recursos de la ONC):
 *   - orden_compra_id_externo          → nuestro campo url_original (construido)
 *   - organismo_nombre                 → organismo
 *   - nombre_sucursal                  → título complementario
 *   - descripcion_tipo_procedimiento   → tipo de licitación (rubro aproximado)
 *   - descripcion_unidad_operativa     → organismo secundario
 *   - fecha_publicacion_convocatoria   → fecha_publicacion
 *   - fecha_apertura_convocatoria      → fecha_cierre
 *   - moneda_descripcion               → moneda
 *   - monto_total_adjudicado           → presupuesto_estimado
 *   - descripcion_clase                → descripción de la clase de contratación
 *   - rubro_nombre                     → rubro
 *
 * Resource IDs conocidos del dataset de la ONC en datos.gob.ar:
 *   fa3603b3-0af7-43cc-9da9-90a512217d8a  → convocatorias 2015
 *   fd9a6c4c-0b47-4ca4-8f08-a2e0d75c3c63  → contrataciones 2022–2024 (más reciente disponible)
 *
 * ESTRATEGIA DE POLLING:
 *   - El servicio corre cada POLL_INTERVAL_MS (configurable, default 5 minutos)
 *   - Trae los últimos BATCH_SIZE registros ordenados por fecha_publicacion DESC
 *   - Compara con los ya guardados en Supabase usando url_original como deduplicación
 *   - Los nuevos se insertan en la tabla `licitaciones` y se dispara WebSocket
 */

import { supabase } from '../config/supabase.js';
import { wsManager } from './websocket.js';

// ── Configuración ──────────────────────────────────────────────────────────────

const CKAN_BASE = 'https://datos.gob.ar/api/3/action/datastore_search';

/**
 * Resource IDs del dataset de contrataciones de la ONC.
 * Se consultan en orden; si uno falla se intenta el siguiente.
 *
 * Para encontrar otros: https://datos.gob.ar/dataset/jgm-sistema-contrataciones-electronicas-argentina-compra
 */
const RESOURCE_IDS = [
  'fd9a6c4c-0b47-4ca4-8f08-a2e0d75c3c63', // contrataciones 2022-2024
  'fa3603b3-0af7-43cc-9da9-90a512217d8a', // convocatorias abiertas 2015 (fallback)
];

const BATCH_SIZE        = 50;    // registros a traer por ciclo
const POLL_INTERVAL_MS  = 5 * 60 * 1000;  // 5 minutos entre polls
const COMPRAR_BASE_URL  = 'https://comprar.gob.ar';

// ── Clase principal ────────────────────────────────────────────────────────────

class DatosGobArService {
  #timer;
  #corriendo;

  constructor() {
    this.#timer     = null;
    this.#corriendo = false;
  }

  /**
   * Arranca el polling periódico.
   * Se llama una sola vez desde server.js al inicializar la app.
   */
  start() {
    if (this.#corriendo) return;
    this.#corriendo = true;
    console.log(`[API-ONC] Servicio de ingesta iniciado. Poll cada ${POLL_INTERVAL_MS / 60000} min.`);

    // Primera ingesta al arrancar (sin esperar el intervalo)
    this.#poll();

    // Siguientes ingestas periódicas
    this.#timer = setInterval(() => this.#poll(), POLL_INTERVAL_MS);
  }

  /**
   * Detiene el polling (útil para tests o shutdown graceful).
   */
  stop() {
    if (this.#timer) clearInterval(this.#timer);
    this.#corriendo = false;
    console.log('[API-ONC] Servicio de ingesta detenido.');
  }

  // ── Lógica interna ───────────────────────────────────────────────────────────

  async #poll() {
    console.log('[API-ONC] Iniciando ciclo de ingesta...');
    let ingestadas = 0;

    for (const resourceId of RESOURCE_IDS) {
      try {
        const registros = await this.#fetchDesdeAPI(resourceId);
        if (!registros || registros.length === 0) continue;

        const nuevas = await this.#filtrarNuevas(registros);
        if (nuevas.length === 0) {
          console.log(`[API-ONC] Sin licitaciones nuevas en recurso ${resourceId}`);
          continue;
        }

        const insertadas = await this.#persistir(nuevas);
        ingestadas += insertadas.length;

        // Notificar por WebSocket a usuarios compatibles
        for (const lic of insertadas) {
          await this.#notificar(lic);
        }

        console.log(`[API-ONC] ${insertadas.length} licitaciones nuevas ingresadas del recurso ${resourceId}`);
        break; // Si el primer recurso funcionó, no consultar el fallback
      } catch (err) {
        console.error(`[API-ONC] Error con recurso ${resourceId}:`, err.message);
        // Continuar con el siguiente resource_id
      }
    }

    if (ingestadas === 0) {
      console.log('[API-ONC] Ciclo completado sin novedades.');
    }
  }

  /**
   * Llama a la API CKAN de datos.gob.ar y retorna los registros crudos.
   * Documentación CKAN: https://www.datos.gob.ar/acerca/ckan
   */
  async #fetchDesdeAPI(resourceId) {
    const params = new URLSearchParams({
      resource_id: resourceId,
      limit:       BATCH_SIZE,
      // Ordenar por fecha de publicación descendente para traer las más recientes
      // CKAN acepta el parámetro sort con formato "campo asc|desc"
      sort:        'fecha_publicacion_convocatoria desc',
    });

    const url = `${CKAN_BASE}?${params}`;
    console.log(`[API-ONC] GET ${url}`);

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal:  AbortSignal.timeout(15000), // 15s timeout
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} al consultar datos.gob.ar`);
    }

    const json = await response.json();

    if (!json.success) {
      throw new Error(`CKAN error: ${json.error?.message || 'respuesta fallida'}`);
    }

    return json.result?.records || [];
  }

  /**
   * Filtra los registros que ya están en nuestra base de datos.
   * Usa url_original como campo de deduplicación.
   */
  async #filtrarNuevas(registros) {
    // Construir las URLs identificadoras de todos los registros recibidos
    const urls = registros
      .map(r => this.#construirUrl(r))
      .filter(Boolean);

    if (urls.length === 0) return [];

    // Consultar cuáles de esas URLs ya existen en Supabase
    const { data: existentes } = await supabase
      .from('licitaciones')
      .select('url_original')
      .in('url_original', urls);

    const urlsExistentes = new Set((existentes || []).map(e => e.url_original));

    // Retornar solo los que no existen aún
    return registros.filter(r => {
      const url = this.#construirUrl(r);
      return url && !urlsExistentes.has(url);
    });
  }

  /**
   * Inserta las licitaciones nuevas en Supabase.
   * Retorna los registros efectivamente insertados (con su UUID asignado).
   */
  async #persistir(registros) {
    const filas = registros.map(r => this.#transformar(r));

    const { data, error } = await supabase
      .from('licitaciones')
      .insert(filas)
      .select();

    if (error) {
      console.error('[API-ONC] Error al insertar en Supabase:', error.message);
      return [];
    }

    return data || [];
  }

  /**
   * Notifica por WebSocket a todos los usuarios con perfiles compatibles.
   * Compatibilidad simple: coincidencia de rubro o provincia.
   * También persiste la alerta en la tabla `alertas`.
   */
  async #notificar(licitacion) {
    try {
      let query = supabase
        .from('perfiles_empresa')
        .select('usuario_id, rubro, provincia');

      const { data: perfiles, error } = await query;
      if (error || !perfiles) return;

      for (const perfil of perfiles) {
        const rubroMatch = licitacion.rubro && perfil.rubro &&
          licitacion.rubro.toLowerCase().includes(perfil.rubro.toLowerCase().split(' ')[0]);

        const provinciaMatch = !licitacion.provincia ||
          !perfil.provincia ||
          licitacion.provincia.toLowerCase().includes(perfil.provincia.toLowerCase().split(' ')[0]);

        if (!rubroMatch && !provinciaMatch) continue;

        // Enviar por WebSocket (si el usuario está conectado en este momento)
        wsManager.notificarNuevaLicitacion(perfil.usuario_id, licitacion);

        // Guardar en tabla alertas para cuando el usuario no esté conectado
        await supabase.from('alertas').insert({
          usuario_id:    perfil.usuario_id,
          licitacion_id: licitacion.id,
          mensaje:       `Nueva licitación: "${licitacion.titulo}" — ${licitacion.organismo || 'Organismo público'}`,
        });
      }
    } catch (err) {
      console.error('[API-ONC] Error al notificar:', err.message);
    }
  }

  // ── Helpers de transformación ────────────────────────────────────────────────

  /**
   * Construye la URL identificadora de un registro de la ONC.
   * Se usa como clave de deduplicación en url_original.
   */
  #construirUrl(r) {
    const id = r._id || r.orden_compra_id_externo || r.proceso_compra_id_externo;
    if (!id) return null;
    return `${COMPRAR_BASE_URL}/proceso/${id}`;
  }

  /**
   * Transforma un registro crudo de la API CKAN al esquema de la tabla `licitaciones`.
   *
   * Los campos de la API de la ONC varían según el recurso consultado.
   * Esta función intenta mapear los campos más comunes con fallbacks.
   */
  #transformar(r) {
    // Título: combinar nombre del procedimiento + organismo si está disponible
    const titulo = this.#limpiar(
      r.nombre_procedimiento ||
      r.descripcion_objeto ||
      r.objeto_contratacion ||
      r.descripcion ||
      `Proceso de contratación ${r._id || ''}`
    );

    const organismo = this.#limpiar(
      r.organismo_nombre ||
      r.unidad_operativa_contrataciones_nombre ||
      r.organismo ||
      null
    );

    const rubro = this.#limpiar(
      r.rubro_nombre ||
      r.rubro ||
      r.descripcion_tipo_procedimiento ||
      r.descripcion_clase ||
      null
    );

    const provincia = this.#limpiar(
      r.provincia_nombre ||
      r.jurisdiccion_nombre ||
      null
    );

    // Fechas: la API puede traerlas en distintos formatos
    const fechaPub   = this.#parseFecha(r.fecha_publicacion_convocatoria || r.fecha_publicacion);
    const fechaCierre = this.#parseFecha(r.fecha_apertura_convocatoria   || r.fecha_cierre || r.fecha_limite_presentacion);

    // Presupuesto
    const presupuesto = parseFloat(
      r.monto_total_adjudicado || r.presupuesto_oficial || r.monto_estimado || 0
    ) || null;

    // URL original para deduplicación y enlace al portal oficial
    const urlOriginal = this.#construirUrl(r);

    return {
      fuente:                'datos.gob.ar / ONC — Argentina Compra',
      titulo,
      organismo,
      descripcion:           this.#limpiar(r.descripcion_objeto || r.fundamento || null),
      rubro,
      provincia,
      fecha_publicacion:     fechaPub,
      fecha_cierre:          fechaCierre,
      presupuesto_estimado:  presupuesto,
      url_original:          urlOriginal,
      datos_originales:      r,      // guardamos el registro completo en JSONB por si se necesita
    };
  }

  /** Limpia strings vacíos o con solo espacios */
  #limpiar(val) {
    if (!val || typeof val !== 'string') return null;
    const s = val.trim();
    return s.length > 0 ? s : null;
  }

  /**
   * Parsea una fecha que puede venir en formatos ISO, DD/MM/YYYY o similares.
   * Retorna string 'YYYY-MM-DD' o null.
   */
  #parseFecha(val) {
    if (!val) return null;
    try {
      // Formato argentino DD/MM/YYYY o DD-MM-YYYY
      const arMatch = String(val).match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
      if (arMatch) {
        const [, d, m, y] = arMatch;
        return `${y}-${m}-${d}`;
      }
      // ISO o cualquier otro formato que Date entienda
      const date = new Date(val);
      if (isNaN(date.getTime())) return null;
      return date.toISOString().split('T')[0];
    } catch {
      return null;
    }
  }
}

// ── Singleton exportado ────────────────────────────────────────────────────────
export const datosGobArService = new DatosGobArService();