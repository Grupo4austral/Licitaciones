import { Router } from 'express';
import { supabase } from './supabase.js';
import { authMiddleware } from './auth.js';

export const perfilRouter = Router();

/**
 * @swagger
 * /perfil:
 *   get:
 *     summary: Obtener el perfil de empresa del usuario autenticado
 *     tags: [Perfil de Empresa]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Perfil de empresa
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PerfilEmpresa'
 *       404:
 *         description: Perfil no encontrado
 */
perfilRouter.get('/', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('perfiles_empresa')
      .select('*')
      .eq('usuario_id', req.user.id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'No tenés un perfil de empresa aún' });
    }
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Error interno', detalle: err.message });
  }
});

/**
 * @swagger
 * /perfil:
 *   post:
 *     summary: Crear o actualizar el perfil de empresa
 *     tags: [Perfil de Empresa]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nombre_empresa, rubro]
 *             properties:
 *               nombre_empresa:
 *                 type: string
 *                 example: "Limpieza Total SRL"
 *               rubro:
 *                 type: string
 *                 example: "Servicios de limpieza"
 *               descripcion:
 *                 type: string
 *               provincia:
 *                 type: string
 *                 example: "Buenos Aires"
 *               ciudad:
 *                 type: string
 *               palabras_clave:
 *                 type: array
 *                 items: { type: string }
 *     responses:
 *       200:
 *         description: Perfil guardado
 *       400:
 *         description: Datos inválidos
 */
perfilRouter.post('/', authMiddleware, async (req, res) => {
  const { nombre_empresa, rubro, descripcion, provincia, ciudad, palabras_clave } = req.body;

  if (!nombre_empresa || !rubro) {
    return res.status(400).json({ error: 'nombre_empresa y rubro son requeridos' });
  }

  try {
    const payload = {
      nombre_empresa,
      rubro,
      descripcion: descripcion || null,
      provincia: provincia || null,
      ciudad: ciudad || null,
      palabras_clave: palabras_clave || [],
    };

    const { data: perfilExistente, error: fetchError } = await supabase
      .from('perfiles_empresa')
      .select('usuario_id')
      .eq('usuario_id', req.user.id)
      .maybeSingle();

    if (fetchError) throw fetchError;

    if (perfilExistente) {
      const { data, error } = await supabase
        .from('perfiles_empresa')
        .update(payload)
        .eq('usuario_id', req.user.id)
        .select()
        .single();

      if (error) throw error;
      return res.json(data);
    }

    const { data, error } = await supabase
      .from('perfiles_empresa')
      .insert({
        ...payload,
        usuario_id: req.user.id,
        cuit: req.user.cuit,
        email: req.user.email,
      })
      .select()
      .single();

    if (error) throw error;
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Error al guardar perfil', detalle: err.message });
  }
});
