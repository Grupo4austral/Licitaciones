import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import { wsManager } from '../services/websocket.js';

export const licitacionesRouter = Router();

/**
 * @swagger
 * /licitaciones:
 *   get:
 *     summary: Listar licitaciones con filtros opcionales
 *     tags: [Licitaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: rubro
 *         schema: { type: string }
 *         description: Filtrar por rubro
 *       - in: query
 *         name: provincia
 *         schema: { type: string }
 *         description: Filtrar por provincia
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Búsqueda en título y descripción
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *     responses:
 *       200:
 *         description: Lista de licitaciones
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 licitaciones:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Licitacion'
 *                 total: { type: integer }
 *                 page: { type: integer }
 *                 totalPaginas: { type: integer }
 */
licitacionesRouter.get('/', authMiddleware, async (req, res) => {
  const { rubro, provincia, q, page = 1, limit = 20 } = req.query;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  try {
    let query = supabase
      .from('licitaciones')
      .select('*', { count: 'exact' })
      .order('fecha_publicacion', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (rubro) query = query.ilike('rubro', `%${rubro}%`);
    if (provincia) query = query.ilike('provincia', `%${provincia}%`);
    if (q) query = query.or(`titulo.ilike.%${q}%,descripcion.ilike.%${q}%`);

    const { data, error, count } = await query;
    if (error) throw error;

    return res.json({
      licitaciones: data,
      total: count,
      page: pageNum,
      totalPaginas: Math.ceil(count / limitNum),
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al obtener licitaciones', detalle: err.message });
  }
});

/**
 * @swagger
 * /licitaciones/{id}:
 *   get:
 *     summary: Obtener detalle de una licitación
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
 *             schema:
 *               $ref: '#/components/schemas/Licitacion'
 *       404:
 *         description: Licitación no encontrada
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

/**
 * @swagger
 * /licitaciones:
 *   post:
 *     summary: Crear una nueva licitación (admin) — también dispara alertas WebSocket
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
 *               titulo: { type: string }
 *               organismo: { type: string }
 *               descripcion: { type: string }
 *               rubro: { type: string }
 *               provincia: { type: string }
 *               fecha_publicacion: { type: string, format: date }
 *               fecha_cierre: { type: string, format: date }
 *               presupuesto_estimado: { type: number }
 *               url_original: { type: string, format: uri }
 *     responses:
 *       201:
 *         description: Licitación creada
 *       400:
 *         description: Datos inválidos
 */
licitacionesRouter.post('/', authMiddleware, async (req, res) => {
  const {
    titulo, organismo, descripcion, rubro, provincia,
    fecha_publicacion, fecha_cierre, presupuesto_estimado, url_original, datos_originales,
  } = req.body;

  if (!titulo) {
    return res.status(400).json({ error: 'El campo título es requerido' });
  }

  try {
    const { data, error } = await supabase
      .from('licitaciones')
      .insert({
        titulo, organismo, descripcion, rubro, provincia,
        fecha_publicacion, fecha_cierre, presupuesto_estimado, url_original, datos_originales,
      })
      .select()
      .single();

    if (error) throw error;

    // ── Disparar alertas WebSocket a todos los usuarios conectados ──
    // En producción: buscarías usuarios con perfil compatible y les notificarías individualmente
    await _notificarUsuariosCompatibles(data);

    return res.status(201).json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Error al crear licitación', detalle: err.message });
  }
});

/**
 * Busca usuarios con perfil compatible y les notifica por WebSocket.
 * Lógica básica: coincidencia de rubro o provincia.
 */
async function _notificarUsuariosCompatibles(licitacion) {
  try {
    let query = supabase.from('perfiles_empresa').select('usuario_id');

    if (licitacion.rubro) {
      query = query.ilike('rubro', `%${licitacion.rubro}%`);
    }
    if (licitacion.provincia) {
      query = query.or(`provincia.ilike.%${licitacion.provincia}%,provincia.is.null`);
    }

    const { data: perfiles } = await query;

    if (!perfiles) return;

    for (const perfil of perfiles) {
      wsManager.notificarNuevaLicitacion(perfil.usuario_id, licitacion);

      // También guardar la alerta en la base de datos
      await supabase.from('alertas').insert({
        usuario_id: perfil.usuario_id,
        licitacion_id: licitacion.id,
        mensaje: `Nueva licitación compatible: "${licitacion.titulo}" de ${licitacion.organismo || 'organismo público'}`,
      });
    }
  } catch (err) {
    console.error('[WS] Error al notificar usuarios:', err.message);
  }
}
