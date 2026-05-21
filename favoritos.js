import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { authMiddleware } from '../middleware/auth.js';

export const favoritosRouter = Router();

/**
 * @swagger
 * /favoritos:
 *   get:
 *     summary: Listar licitaciones favoritas del usuario
 *     tags: [Favoritos]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de favoritos con detalle de licitación
 */
favoritosRouter.get('/', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('favoritos')
      .select(`
        id,
        creado_en,
        licitaciones (*)
      `)
      .eq('usuario_id', req.user.id)
      .order('creado_en', { ascending: false });

    if (error) throw error;
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Error al obtener favoritos', detalle: err.message });
  }
});

/**
 * @swagger
 * /favoritos:
 *   post:
 *     summary: Agregar una licitación a favoritos
 *     tags: [Favoritos]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [licitacion_id]
 *             properties:
 *               licitacion_id:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       201:
 *         description: Agregado a favoritos
 *       409:
 *         description: Ya estaba en favoritos
 */
favoritosRouter.post('/', authMiddleware, async (req, res) => {
  const { licitacion_id } = req.body;

  if (!licitacion_id) {
    return res.status(400).json({ error: 'Se requiere licitacion_id' });
  }

  try {
    const { data, error } = await supabase
      .from('favoritos')
      .insert({ usuario_id: req.user.id, licitacion_id })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Esta licitación ya está en tus favoritos' });
      }
      throw error;
    }
    return res.status(201).json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Error al agregar favorito', detalle: err.message });
  }
});

/**
 * @swagger
 * /favoritos/{licitacion_id}:
 *   delete:
 *     summary: Quitar una licitación de favoritos
 *     tags: [Favoritos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: licitacion_id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Eliminado de favoritos
 *       404:
 *         description: No estaba en favoritos
 */
favoritosRouter.delete('/:licitacion_id', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('favoritos')
      .delete()
      .eq('usuario_id', req.user.id)
      .eq('licitacion_id', req.params.licitacion_id)
      .select();

    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'No encontrado en favoritos' });
    }
    return res.json({ mensaje: 'Eliminado de favoritos' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al eliminar favorito', detalle: err.message });
  }
});
