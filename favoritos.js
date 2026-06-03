import { Router } from 'express';
import { supabase } from './supabase.js';
import { authMiddleware } from './auth.js';

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
  let { licitacion_id } = req.body;
  const { licitacion } = req.body;

  if (!licitacion_id) {
    return res.status(400).json({ error: 'Se requiere licitacion_id' });
  }

  try {
    if (!pareceUuid(licitacion_id)) {
      if (!licitacion?.titulo) {
        return res.status(400).json({
          error: 'Para guardar una licitación externa se requiere enviar sus datos',
        });
      }
      const guardada = await guardarLicitacionExterna(licitacion, licitacion_id);
      licitacion_id = guardada.id;
    }

    const { data, error } = await supabase
      .from('favoritos')
      .insert({ usuario_id: req.user.id, licitacion_id })
      .select(`
        id,
        licitacion_id,
        creado_en,
        licitaciones (*)
      `)
      .single();

    if (error) {
      if (error.code === '23505') {
        const { data: existente, error: favError } = await supabase
          .from('favoritos')
          .select(`
            id,
            licitacion_id,
            creado_en,
            licitaciones (*)
          `)
          .eq('usuario_id', req.user.id)
          .eq('licitacion_id', licitacion_id)
          .single();

        if (favError) throw favError;
        return res.status(200).json(existente);
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
    let licitacionId = req.params.licitacion_id;
    if (!pareceUuid(licitacionId)) {
      const { data: lic } = await supabase
        .from('licitaciones')
        .select('id')
        .or(`url_original.eq.${licitacionId},datos_originales->>numero_proceso.eq.${licitacionId}`)
        .maybeSingle();
      if (lic?.id) licitacionId = lic.id;
    }

    const { data, error } = await supabase
      .from('favoritos')
      .delete()
      .eq('usuario_id', req.user.id)
      .eq('licitacion_id', licitacionId)
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

function pareceUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

async function guardarLicitacionExterna(licitacion, externalId) {
  const url = licitacion.url_original || null;
  const numero = licitacion.numero_proceso || licitacion.id || externalId;

  let query = supabase
    .from('licitaciones')
    .select('*');

  if (url) {
    query = query.eq('url_original', url);
  } else {
    query = query.eq('titulo', licitacion.titulo).eq('fecha_cierre', licitacion.fecha_cierre || null);
  }

  const { data: existente, error: fetchError } = await query
    .limit(1)
    .maybeSingle();
  if (fetchError) throw fetchError;

  const payload = {
    fuente: recortar(licitacion.fuente || 'COMPR.AR', 100),
    titulo: licitacion.titulo,
    organismo: recortar(licitacion.organismo, 200),
    descripcion: licitacion.descripcion || null,
    rubro: recortar(licitacion.rubro, 100),
    provincia: recortar(licitacion.provincia, 100),
    fecha_publicacion: normalizarFecha(licitacion.fecha_publicacion),
    fecha_cierre: normalizarFecha(licitacion.fecha_cierre),
    presupuesto_estimado: normalizarMonto(licitacion.presupuesto_estimado),
    url_original: url,
    datos_originales: {
      ...(existente?.datos_originales || {}),
      ...(licitacion.datos_originales || {}),
      numero_proceso: numero,
      external_id: externalId,
    },
  };

  if (existente) {
    const { data, error } = await supabase
      .from('licitaciones')
      .update(payload)
      .eq('id', existente.id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('licitaciones')
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
}

function recortar(value, max) {
  if (!value) return null;
  const text = String(value);
  return text.length > max ? text.slice(0, max) : text;
}

function normalizarMonto(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizarFecha(value) {
  if (!value) return null;
  const text = String(value);
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ar = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (ar) return `${ar[3]}-${ar[2]}-${ar[1]}`;
  return null;
}
