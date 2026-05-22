/**
 * routes/licitaciones.js
 *
 * GET  /api/licitaciones          — lista desde Supabase (ya ingresadas)
 * GET  /api/licitaciones/externas — consulta en tiempo real a datos.gob.ar
 * GET  /api/licitaciones/:id      — detalle de una licitación por UUID
 * POST /api/licitaciones          — crear manualmente + disparar WebSocket
 */

import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import { wsManager } from '../services/websocket.js';

export const licitacionesRouter = Router();

// Parámetros de la API pública de datos.gob.ar (ONC — Argentina Compra)
const CKAN_BASE  = 'https://datos.gob.ar/api/3/action/datastore_search';
// Resource ID principal: dataset de contrataciones ONC 2022-2024
const RESOURCE_ID = 'fd9a6c4c-0b47-4ca4-8f08-a2e0d75c3c63';

// ─────────────────────────────────────────────────────────────────────────────
/**
 * @swagger
 * /licitaciones:
 *   get:
 *     summary: Listar licitaciones almacenadas en la base de datos
 *     description: Retorna las licitaciones ya ingresadas desde datos.gob.ar con filtros y paginación.
 *     tags: [Licitaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: rubro
 *         schema: { type: string }
 *         description: Filtrar por rubro (búsqueda parcial, case-insensitive)
 *       - in: query
 *         name: provincia
 *         schema: { type: string }
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Búsqueda libre en título y descripción
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *     responses:
 *       200:
 *         description: Lista paginada de licitaciones
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 licitaciones:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Licitacion' }
 *                 total: { type: integer }
 *                 page: { type: integer }
 *                 totalPaginas: { type: integer }
 */
licitacionesRouter.get('/', authMiddleware, async (req, res) => {
  const { rubro, provincia, q, page = 1, limit = 20 } = req.query;
  const pageNum  = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset   = (pageNum - 1) * limitNum;

  try {
    let query = supabase
      .from('licitaciones')
      .select('*', { count: 'exact' })
      .order('fecha_publicacion', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (rubro)    query = query.ilike('rubro', `%${rubro}%`);
    if (provincia) query = query.ilike('provincia', `%${provincia}%`);
    if (q)        query = query.or(`titulo.ilike.%${q}%,descripcion.ilike.%${q}%`);

    const { data, error, count } = await query;
    if (error) throw error;

    return res.json({
      licitaciones: data,
      total:        count,
      page:         pageNum,
      totalPaginas: Math.ceil((count || 0) / limitNum),
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al obtener licitaciones', detalle: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * @swagger
 * /licitaciones/externas:
 *   get:
 *     summary: Consulta en tiempo real a datos.gob.ar (API CKAN de la ONC)
 *     description: |
 *       Hace un GET directo a https://datos.gob.ar/api/3/action/datastore_search
 *       con el resource_id del dataset de contrataciones de la Oficina Nacional de
 *       Contrataciones (ONC). No requiere clave de API. Retorna los registros crudos
 *       transformados al esquema de LicitIA.
 *     tags: [Licitaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Búsqueda libre (se pasa como parámetro q a la API CKAN)
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *     responses:
 *       200:
 *         description: Registros crudos de datos.gob.ar transformados
 *       502:
 *         description: Error al conectar con datos.gob.ar
 */
licitacionesRouter.get('/externas', authMiddleware, async (req, res) => {
  const { q, limit = 20, offset = 0 } = req.query;
  const limitNum  = Math.min(100, Math.max(1, parseInt(limit)));
  const offsetNum = Math.max(0, parseInt(offset));

  try {
    const params = new URLSearchParams({
      resource_id: RESOURCE_ID,
      limit:       limitNum,
      offset:      offsetNum,
      sort:        'fecha_publicacion_convocatoria desc',
    });
    if (q) params.set('q', q);

    const url      = `${CKAN_BASE}?${params}`;
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal:  AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      return res.status(502).json({
        error: `datos.gob.ar respondió con HTTP ${response.status}`,
      });
    }

    const json = await response.json();
    if (!json.success) {
      return res.status(502).json({ error: 'La API de datos.gob.ar reportó un error', detalle: json.error });
    }

    const records = json.result?.records || [];

    // Transformar al esquema de LicitIA para que el frontend lo entienda igual
    const licitaciones = records.map(r => ({
      id:                   r._id,
      fuente:               'datos.gob.ar / ONC',
      titulo:               r.nombre_procedimiento || r.descripcion_objeto || `Proceso ${r._id}`,
      organismo:            r.organismo_nombre || r.unidad_operativa_contrataciones_nombre || null,
      descripcion:          r.descripcion_objeto || r.fundamento || null,
      rubro:                r.rubro_nombre || r.descripcion_tipo_procedimiento || null,
      provincia:            r.provincia_nombre || r.jurisdiccion_nombre || null,
      fecha_publicacion:    r.fecha_publicacion_convocatoria || null,
      fecha_cierre:         r.fecha_apertura_convocatoria || null,
      presupuesto_estimado: parseFloat(r.monto_total_adjudicado || 0) || null,
      url_original:         `https://comprar.gob.ar/proceso/${r._id}`,
      _raw:                 r,
    }));

    return res.json({
      licitaciones,
      total:   json.result?.total || records.length,
      fuente:  'datos.gob.ar',
      recurso: RESOURCE_ID,
    });
  } catch (err) {
    if (err.name === 'TimeoutError') {
      return res.status(504).json({ error: 'Timeout al consultar datos.gob.ar' });
    }
    return res.status(502).json({ error: 'Error al consultar datos.gob.ar', detalle: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * @swagger
 * /licitaciones/{id}:
 *   get:
 *     summary: Obtener detalle de una licitación por UUID (desde Supabase)
 *     tags: [Licitaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Detalle de la licitación
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Licitacion' }
 *       404:
 *         description: No encontrada
 */
licitacionesRouter.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('licitaciones')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Licitación no encontrada' });
    }
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Error interno', detalle: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * @swagger
 * /licitaciones:
 *   post:
 *     summary: Crear una licitación manualmente y notificar por WebSocket
 *     description: |
 *       Crea una licitación en la base de datos y dispara notificaciones WebSocket
 *       a todos los usuarios con perfiles compatibles (por rubro y/o provincia).
 *       También guarda una alerta persistente en la tabla `alertas`.
 *     tags: [Licitaciones]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [titulo]
 *             properties:
 *               titulo:               { type: string }
 *               organismo:            { type: string }
 *               descripcion:          { type: string }
 *               rubro:                { type: string }
 *               provincia:            { type: string }
 *               fecha_publicacion:    { type: string, format: date }
 *               fecha_cierre:         { type: string, format: date }
 *               presupuesto_estimado: { type: number }
 *               url_original:         { type: string, format: uri }
 *     responses:
 *       201:
 *         description: Licitación creada y notificaciones enviadas
 *       400:
 *         description: Falta el campo título
 */
licitacionesRouter.post('/', authMiddleware, async (req, res) => {
  const {
    titulo, organismo, descripcion, rubro, provincia,
    fecha_publicacion, fecha_cierre, presupuesto_estimado,
    url_original, datos_originales,
  } = req.body;

  if (!titulo) {
    return res.status(400).json({ error: 'El campo título es requerido' });
  }

  try {
    const { data, error } = await supabase
      .from('licitaciones')
      .insert({
        titulo, organismo, descripcion, rubro, provincia,
        fecha_publicacion, fecha_cierre, presupuesto_estimado,
        url_original, datos_originales,
      })
      .select()
      .single();

    if (error) throw error;

    // Notificar a usuarios compatibles por WebSocket + persistir alerta
    await _notificarCompatibles(data);

    return res.status(201).json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Error al crear licitación', detalle: err.message });
  }
});

// ── Función interna de notificación ───────────────────────────────────────────

async function _notificarCompatibles(licitacion) {
  try {
    const { data: perfiles } = await supabase
      .from('perfiles_empresa')
      .select('usuario_id, rubro, provincia');

    if (!perfiles) return;

    for (const perfil of perfiles) {
      // Compatibilidad simple: rubro o provincia contiene al menos una palabra clave
      const rubroOk = licitacion.rubro && perfil.rubro &&
        licitacion.rubro.toLowerCase().includes(perfil.rubro.toLowerCase().split(' ')[0]);
      const provOk = !licitacion.provincia || !perfil.provincia ||
        licitacion.provincia.toLowerCase().includes(perfil.provincia.toLowerCase().split(' ')[0]);

      if (!rubroOk && !provOk) continue;

      // WebSocket: popup instantáneo si el usuario está conectado
      wsManager.notificarNuevaLicitacion(perfil.usuario_id, licitacion);

      // Alerta persistente en BD para cuando el usuario se conecte luego
      await supabase.from('alertas').insert({
        usuario_id:    perfil.usuario_id,
        licitacion_id: licitacion.id,
        mensaje:       `Nueva licitación: "${licitacion.titulo}" — ${licitacion.organismo || 'organismo público'}`,
      });
    }
  } catch (err) {
    console.error('[WS] Error al notificar compatibles:', err.message);
  }
}