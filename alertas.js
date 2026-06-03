import { Router } from 'express';
import { supabase } from './supabase.js';
import { authMiddleware } from './auth.js';
import { recordatoriosFavoritosService } from './recordatorios.js';

export const alertasRouter = Router();

alertasRouter.post('/recordatorios/run', authMiddleware, async (req, res) => {
  try {
    const resultado = await recordatoriosFavoritosService.checkAndNotify({
      forceEmail: req.query.forceEmail === 'true',
    });
    return res.json({ mensaje: 'Revisión de recordatorios ejecutada', resultado });
  } catch (err) {
    return res.status(500).json({ error: 'Error al ejecutar recordatorios', detalle: err.message });
  }
});

/**
 * @swagger
 * /alertas:
 *   get:
 *     summary: Listar alertas del usuario (leídas y no leídas)
 *     tags: [Alertas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: soloNoLeidas
 *         schema: { type: boolean }
 *         description: Si es true, retorna solo las alertas no leídas
 *     responses:
 *       200:
 *         description: Lista de alertas
 */
alertasRouter.get('/', authMiddleware, async (req, res) => {
  const { soloNoLeidas } = req.query;

  try {
    let query = supabase
      .from('alertas')
      .select(`
        id,
        mensaje,
        leida,
        creado_en,
        licitaciones (id, titulo, organismo, fecha_cierre, rubro)
      `)
      .eq('usuario_id', req.user.id)
      .order('creado_en', { ascending: false });

    if (soloNoLeidas === 'true') {
      query = query.eq('leida', false);
    }

    const { data, error } = await query;
    if (error) throw error;
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Error al obtener alertas', detalle: err.message });
  }
});

/**
 * @swagger
 * /alertas/{id}/leer:
 *   post:
 *     summary: Marcar una alerta como leída
 *     tags: [Alertas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Alerta marcada como leída
 *       404:
 *         description: Alerta no encontrada
 */
alertasRouter.post('/:id/leer', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('alertas')
      .update({ leida: true })
      .eq('id', req.params.id)
      .eq('usuario_id', req.user.id)
      .select();

    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Alerta no encontrada' });
    }
    return res.json({ mensaje: 'Alerta marcada como leída' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al actualizar alerta', detalle: err.message });
  }
});

/**
 * @swagger
 * /alertas/leer-todas:
 *   post:
 *     summary: Marcar todas las alertas del usuario como leídas
 *     tags: [Alertas]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Todas las alertas marcadas como leídas
 */
alertasRouter.post('/leer-todas', authMiddleware, async (req, res) => {
  try {
    const { error } = await supabase
      .from('alertas')
      .update({ leida: true })
      .eq('usuario_id', req.user.id)
      .eq('leida', false);

    if (error) throw error;
    return res.json({ mensaje: 'Todas las alertas marcadas como leídas' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al actualizar alertas', detalle: err.message });
  }
});
