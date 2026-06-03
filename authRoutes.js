import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { supabase, supabasePublic } from './supabase.js';

export const authRouter = Router();

function normalizarCuit(cuit = '') {
  return String(cuit).replace(/\D/g, '');
}

function usuarioResponse(perfil) {
  return {
    id: perfil.usuario_id,
    nombre: perfil.nombre_empresa,
    cuit: perfil.cuit,
    email: perfil.email,
    rol: 'usuario',
    creado_en: perfil.creado_en,
  };
}

function firmarToken(perfil) {
  return jwt.sign(
    { id: perfil.usuario_id, cuit: perfil.cuit, email: perfil.email, rol: 'usuario' },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Registrar una empresa
 *     tags: [Autenticacion]
 */
authRouter.post('/register', async (req, res) => {
  const { nombre, cuit, email, password } = req.body;
  const cuitNormalizado = normalizarCuit(cuit);
  const emailNormalizado = String(email || '').trim().toLowerCase();

  if (!nombre || !cuitNormalizado || !emailNormalizado || !password) {
    return res.status(400).json({ error: 'Faltan campos requeridos: nombre de empresa, CUIT, email y password' });
  }
  if (cuitNormalizado.length !== 11) {
    return res.status(400).json({ error: 'El CUIT debe tener 11 dígitos' });
  }
  if (!emailNormalizado.includes('@')) {
    return res.status(400).json({ error: 'El email no es válido' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }

  try {
    const { data: perfilExistente } = await supabase
      .from('perfiles_empresa')
      .select('id')
      .or(`cuit.eq.${cuitNormalizado},email.eq.${emailNormalizado}`)
      .maybeSingle();

    if (perfilExistente) {
      return res.status(400).json({ error: 'Ya existe una empresa registrada con ese CUIT o email' });
    }

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: emailNormalizado,
      password,
      email_confirm: true,
      user_metadata: {
        nombre_empresa: nombre,
        cuit: cuitNormalizado,
      },
    });

    if (authError) {
      return res.status(400).json({ error: 'No se pudo crear el usuario', detalle: authError.message });
    }

    const userId = authData.user.id;
    const { data: perfil, error: perfilError } = await supabase
      .from('perfiles_empresa')
      .insert({
        usuario_id: userId,
        nombre_empresa: nombre,
        cuit: cuitNormalizado,
        email: emailNormalizado,
        palabras_clave: [],
      })
      .select('*')
      .single();

    if (perfilError) {
      await supabase.auth.admin.deleteUser(userId);
      throw perfilError;
    }

    return res.status(201).json({
      mensaje: 'Cuenta creada exitosamente',
      token: firmarToken(perfil),
      usuario: usuarioResponse(perfil),
    });
  } catch (err) {
    console.error('[Auth] Error en registro:', err);
    return res.status(500).json({ error: 'Error interno del servidor', detalle: err.message });
  }
});

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Iniciar sesión con CUIT
 *     tags: [Autenticacion]
 */
authRouter.post('/login', async (req, res) => {
  const { cuit, password } = req.body;
  const cuitNormalizado = normalizarCuit(cuit);

  if (!cuitNormalizado || !password) {
    return res.status(400).json({ error: 'Se requieren CUIT y password' });
  }

  try {
    const { data: perfil, error: perfilError } = await supabase
      .from('perfiles_empresa')
      .select('*')
      .eq('cuit', cuitNormalizado)
      .maybeSingle();

    if (perfilError) throw perfilError;
    if (!perfil) {
      return res.status(401).json({ error: 'CUIT o contraseña incorrectos' });
    }

    const { error: loginError } = await supabasePublic.auth.signInWithPassword({
      email: perfil.email,
      password,
    });

    if (loginError) {
      return res.status(401).json({ error: 'CUIT o contraseña incorrectos' });
    }

    return res.json({
      token: firmarToken(perfil),
      usuario: usuarioResponse(perfil),
    });
  } catch (err) {
    console.error('[Auth] Error en login:', err);
    return res.status(500).json({ error: 'Error interno del servidor', detalle: err.message });
  }
});
