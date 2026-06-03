import { Router } from 'express';
import { authMiddleware } from './auth.js';
import { supabase } from './supabase.js';

export const assistantRouter = Router();

const OPENAI_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

assistantRouter.post('/informe', authMiddleware, async (req, res) => {
  const licitacion = req.body?.licitacion;
  if (!licitacion?.titulo) {
    return res.status(400).json({ error: 'Falta la licitación para analizar' });
  }

  const perfil = await obtenerPerfil(req.user.id);
  const fallback = construirInformeLocal(licitacion, perfil);

  if (!process.env.OPENAI_API_KEY) {
    return res.json({ modo: 'demo', ...fallback });
  }

  try {
    const texto = await consultarOpenAI({
      instructions: promptSistema(),
      input: JSON.stringify({
        tarea: 'generar_informe_licitacion',
        licitacion: limpiarLicitacion(licitacion),
        empresa: limpiarPerfil(perfil),
        formato_requerido: {
          resumen: 'string',
          plazos: 'string',
          compatibilidad: 'string',
          recomendacion: 'string',
          riesgos: ['string'],
          documentos: ['string'],
          checklist: ['string'],
          semaforo: [{ estado: 'verde|amarillo|rojo', titulo: 'string', texto: 'string' }],
          propuesta: {
            resumen_empresa: 'string',
            experiencia_relevante: 'string',
            capacidades_operativas: 'string',
            documentos_faltantes: ['string'],
            proximos_pasos: ['string'],
          },
        },
      }),
      maxOutputTokens: 1800,
    });

    const informe = parsearJson(texto);
    return res.json({ modo: 'ia', ...normalizarInforme(informe, fallback) });
  } catch (err) {
    console.error('[Asistente IA] Error generando informe:', err.message);
    return res.json({ modo: 'fallback', aviso: 'No se pudo consultar OpenAI. Mostramos análisis local.', ...fallback });
  }
});

assistantRouter.post('/pregunta', authMiddleware, async (req, res) => {
  const { licitacion, pregunta } = req.body || {};
  if (!licitacion?.titulo || !pregunta) {
    return res.status(400).json({ error: 'Falta licitación o pregunta' });
  }

  const perfil = await obtenerPerfil(req.user.id);
  const respuestaLocal = responderPreguntaLocal(licitacion, perfil, pregunta);

  if (!process.env.OPENAI_API_KEY) {
    return res.json({ modo: 'demo', respuesta: respuestaLocal });
  }

  try {
    const texto = await consultarOpenAI({
      instructions: promptSistema(),
      input: JSON.stringify({
        tarea: 'responder_pregunta_contextual',
        pregunta,
        licitacion: limpiarLicitacion(licitacion),
        empresa: limpiarPerfil(perfil),
        instrucciones: 'Respondé en español claro, en 2 a 5 párrafos breves o bullets. Marcá supuestos y recomendá revisar el pliego oficial.',
      }),
      maxOutputTokens: 900,
    });

    return res.json({ modo: 'ia', respuesta: texto.trim() });
  } catch (err) {
    console.error('[Asistente IA] Error respondiendo pregunta:', err.message);
    return res.json({ modo: 'fallback', respuesta: respuestaLocal });
  }
});

assistantRouter.post('/general', authMiddleware, async (req, res) => {
  const pregunta = req.body?.pregunta;
  if (!pregunta) {
    return res.status(400).json({ error: 'Falta la pregunta' });
  }

  const perfil = await obtenerPerfil(req.user.id);
  const respuestaLocal = responderGeneralLocal(perfil, pregunta);

  if (!process.env.OPENAI_API_KEY) {
    return res.json({ modo: 'demo', respuesta: respuestaLocal });
  }

  try {
    const texto = await consultarOpenAI({
      instructions: promptSistema(),
      input: JSON.stringify({
        tarea: 'asistente_general_licitia',
        pregunta,
        empresa: limpiarPerfil(perfil),
        instrucciones: [
          'Respondé como consultor inicial de licitaciones para una pyme argentina.',
          'Orientá al usuario sobre búsqueda, requisitos, documentación, riesgos, costos, preparación de propuestas y próximos pasos.',
          'Si la pregunta necesita una licitación concreta, pedí que abra una oportunidad y use el informe IA contextual.',
          'Usá español claro y bullets breves cuando ayuden.',
        ],
      }),
      maxOutputTokens: 900,
    });

    return res.json({ modo: 'ia', respuesta: texto.trim() });
  } catch (err) {
    console.error('[Asistente IA] Error en consulta general:', err.message);
    return res.json({ modo: 'fallback', respuesta: respuestaLocal });
  }
});

async function obtenerPerfil(usuarioId) {
  const { data } = await supabase
    .from('perfiles_empresa')
    .select('*')
    .eq('usuario_id', usuarioId)
    .maybeSingle();
  return data || null;
}

async function consultarOpenAI({ instructions, input, maxOutputTokens }) {
  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      instructions,
      input,
      temperature: 0.2,
      max_output_tokens: maxOutputTokens,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenAI HTTP ${response.status}`);
  }

  if (data.output_text) return data.output_text;

  const partes = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && content.text) partes.push(content.text);
    }
  }
  return partes.join('\n').trim();
}

function promptSistema() {
  return [
    'Sos LicitIA, un asistente para pymes argentinas que quieren entender licitaciones publicas.',
    'No sos abogado ni contador. No des certeza legal: indicá qué revisar en el pliego oficial.',
    'Usá lenguaje simple, accionable y orientado a decisión.',
    'Analizá compatibilidad empresa-licitación, plazos, documentación, riesgos, costos y próximos pasos.',
    'Si faltan datos, marcá el dato como no confirmado y explicá cómo validarlo.',
  ].join('\n');
}

function limpiarLicitacion(lic) {
  return {
    id: lic.id,
    numero_proceso: lic.numero_proceso,
    titulo: lic.titulo,
    organismo: lic.organismo,
    descripcion: recortar(lic.descripcion, 1800),
    rubro: lic.rubro,
    provincia: lic.provincia,
    fecha_publicacion: lic.fecha_publicacion,
    fecha_cierre: lic.fecha_cierre,
    presupuesto_estimado: lic.presupuesto_estimado,
    fuente: lic.fuente,
    url_original: lic.url_original,
    ia_match: lic.ia_match,
    ia_criterios: lic.ia_criterios,
    datos_originales: lic.datos_originales,
  };
}

function limpiarPerfil(perfil) {
  if (!perfil) return { estado: 'sin_perfil' };
  return {
    nombre_empresa: perfil.nombre_empresa,
    rubro: perfil.rubro,
    descripcion: recortar(perfil.descripcion, 1500),
    provincia: perfil.provincia,
    ciudad: perfil.ciudad,
    palabras_clave: perfil.palabras_clave || [],
  };
}

function parsearJson(texto) {
  const limpio = texto
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  return JSON.parse(limpio);
}

function normalizarInforme(informe, fallback) {
  return {
    resumen: informe.resumen || fallback.resumen,
    plazos: informe.plazos || fallback.plazos,
    compatibilidad: informe.compatibilidad || fallback.compatibilidad,
    recomendacion: informe.recomendacion || fallback.recomendacion,
    riesgos: lista(informe.riesgos, fallback.riesgos),
    documentos: lista(informe.documentos, fallback.documentos),
    checklist: lista(informe.checklist, fallback.checklist),
    semaforo: Array.isArray(informe.semaforo) && informe.semaforo.length ? informe.semaforo : fallback.semaforo,
    propuesta: {
      resumen_empresa: informe.propuesta?.resumen_empresa || fallback.propuesta.resumen_empresa,
      experiencia_relevante: informe.propuesta?.experiencia_relevante || fallback.propuesta.experiencia_relevante,
      capacidades_operativas: informe.propuesta?.capacidades_operativas || fallback.propuesta.capacidades_operativas,
      documentos_faltantes: lista(informe.propuesta?.documentos_faltantes, fallback.propuesta.documentos_faltantes),
      proximos_pasos: lista(informe.propuesta?.proximos_pasos, fallback.propuesta.proximos_pasos),
    },
  };
}

function construirInformeLocal(lic, perfil) {
  const alimentos = esAlimentos(lic, perfil);
  const dias = diasRestantes(lic.fecha_cierre);
  const empresa = perfil?.nombre_empresa || 'tu empresa';
  const rubro = perfil?.rubro || 'el rubro declarado';
  const ubicacion = [perfil?.ciudad, perfil?.provincia].filter(Boolean).join(', ') || 'la zona declarada';

  return {
    resumen: `El organismo busca ${String(lic.titulo || 'un bien o servicio').toLowerCase()}. Para ${empresa}, el primer análisis debe cruzar objeto, alcance, lugar de entrega, documentación y fecha límite.`,
    plazos: lic.fecha_cierre
      ? `La fecha registrada de cierre/apertura es ${formatearFecha(lic.fecha_cierre)}. ${dias == null ? 'No pudimos calcular días restantes.' : `Quedan ${dias} días.`}`
      : 'No hay fecha de cierre confirmada en los datos disponibles. Revisá el pliego oficial.',
    compatibilidad: `Compatibilidad preliminar: ${lic.ia_match || 'a validar'}%. Se estima con rubro (${rubro}), palabras clave, capacidad operativa, zona (${ubicacion}) y plazo disponible.`,
    recomendacion: dias !== null && dias <= 2
      ? 'Avanzá solo si ya tenés documentación lista. El plazo es muy corto para empezar desde cero.'
      : 'Conviene descargar el pliego y validar requisitos excluyentes antes de presupuestar.',
    riesgos: [
      'Requisitos técnicos o administrativos no visibles en el resumen.',
      'Garantías, anexos o formatos de presentación obligatorios.',
      'Costos logísticos o de cumplimiento subestimados.',
      ...(alimentos ? ['Habilitación sanitaria, trazabilidad, cadena de frío o bromatología no confirmadas.'] : []),
    ],
    documentos: documentosBase(alimentos),
    checklist: checklistBase(alimentos),
    semaforo: [
      { estado: lic.ia_match >= 75 ? 'verde' : 'amarillo', titulo: 'Encaje', texto: lic.ia_match >= 75 ? 'El objeto parece alineado con el perfil.' : 'Hay señales útiles, pero falta validar pliego.' },
      { estado: dias !== null && dias <= 2 ? 'rojo' : dias !== null && dias <= 5 ? 'amarillo' : 'verde', titulo: 'Plazo', texto: dias == null ? 'Fecha no confirmada.' : `${dias} días disponibles.` },
      { estado: alimentos ? 'amarillo' : 'verde', titulo: 'Documentación', texto: alimentos ? 'Revisar permisos sanitarios y cadena de frío.' : 'Revisar documentación fiscal, técnica y garantías.' },
    ],
    propuesta: {
      resumen_empresa: `${empresa} puede presentarse como proveedor vinculado a ${rubro}, explicando ubicación, cobertura, capacidad operativa y experiencia.`,
      experiencia_relevante: 'Agregar clientes, entregas/prestaciones similares, volúmenes, continuidad de servicio y referencias.',
      capacidades_operativas: alimentos
        ? 'Detallar cámaras, vehículos, trazabilidad, controles de temperatura, personal, cobertura y frecuencia de entrega.'
        : 'Detallar personal, equipamiento, cobertura, tiempos de respuesta, procesos internos y capacidad de cumplimiento.',
      documentos_faltantes: documentosBase(alimentos),
      proximos_pasos: [
        'Descargar y leer el pliego oficial.',
        'Marcar requisitos excluyentes.',
        'Calcular costos completos y margen.',
        'Preparar propuesta técnica y económica.',
        'Revisar garantías, anexos y forma de presentación.',
      ],
    },
  };
}

function responderPreguntaLocal(lic, perfil, pregunta) {
  const p = String(pregunta).toLowerCase();
  const informe = construirInformeLocal(lic, perfil);
  if (/document|papel|certific|habilit/.test(p)) {
    return `Documentación a revisar: ${informe.documentos.join('; ')}. Confirmalo siempre contra el pliego oficial, porque puede haber requisitos excluyentes.`;
  }
  if (/conviene|present|descart/.test(p)) {
    return `${informe.recomendacion} ${informe.compatibilidad}`;
  }
  if (/plazo|tiempo|fecha|cierre|apertura/.test(p)) {
    return informe.plazos;
  }
  if (/riesgo|problema|ojo/.test(p)) {
    return `Riesgos principales: ${informe.riesgos.join('; ')}.`;
  }
  if (/costo|precio|presupuesto|oferta/.test(p)) {
    return 'Calculá producto/servicio, logística, personal, impuestos, garantías, seguros, margen y riesgo de variación de precios. La oferta debe cubrir el cumplimiento completo del contrato.';
  }
  return `${informe.resumen}\n\n${informe.recomendacion}`;
}

function responderGeneralLocal(perfil, pregunta) {
  const p = String(pregunta).toLowerCase();
  const rubro = perfil?.rubro || 'tu rubro';
  const zona = [perfil?.ciudad, perfil?.provincia].filter(Boolean).join(', ') || 'tu zona de operación';

  if (/sem[aá]foro|decision|decisi[oó]n|prioridad/.test(p)) {
    return `Usá este semáforo: verde si el objeto coincide con ${rubro}, tenés plazo y documentación; amarillo si falta validar requisitos, zona o capacidad; rojo si el rubro no encaja, el plazo es muy corto o hay requisitos excluyentes no cubiertos.`;
  }
  if (/checklist|document|certific|habilit/.test(p)) {
    return `Checklist inicial para ${rubro}: constancia fiscal, datos societarios, inscripción como proveedor si aplica, antecedentes, propuesta técnica, oferta económica, garantías y certificados específicos del rubro. Si trabajás con alimentos, sumá habilitación sanitaria, bromatología, trazabilidad, cadena de frío y vehículos aptos.`;
  }
  if (/riesgo|problema|revisar/.test(p)) {
    return `Riesgos típicos: no leer anexos técnicos, subestimar logística en ${zona}, no tener certificados vigentes, ofertar sin margen, llegar tarde con garantías o no cumplir forma de presentación.`;
  }
  if (/costo|precio|presupuesto|cotiz/.test(p)) {
    return 'Para armar precio calculá producto/servicio, personal, logística, combustible, refrigeración si aplica, seguros, impuestos, garantías, gastos administrativos, margen y riesgo de variación de costos.';
  }
  if (/propuesta|presentaci[oó]n|borrador/.test(p)) {
    return `Borrador base: presentá quiénes son, experiencia relevante, capacidad operativa, cobertura en ${zona}, recursos disponibles, documentación preparada, propuesta técnica, oferta económica y próximos pasos para cumplir el contrato.`;
  }
  return `Para tu empresa (${rubro}), empezaría buscando licitaciones por objeto, zona y capacidad real de cumplimiento. Abrí una licitación concreta y usá "Generar informe IA" para que LicitIA analice plazos, match, requisitos, riesgos y propuesta sobre esa oportunidad.`;
}

function documentosBase(alimentos) {
  const base = [
    'Constancia fiscal y datos societarios.',
    'Inscripción o documentación como proveedor si corresponde.',
    'Garantía de oferta si el pliego la exige.',
    'Propuesta técnica y oferta económica.',
  ];
  if (!alimentos) return base;
  return [
    'Habilitación sanitaria o bromatológica.',
    'Certificados vinculados a manipulación/transporte de alimentos si aplican.',
    'Documentación de cadena de frío, vehículos y trazabilidad.',
    ...base,
  ];
}

function checklistBase(alimentos) {
  return [
    'Confirmar objeto, cantidades, alcance y lugar de entrega.',
    'Revisar fecha y hora límite.',
    ...(alimentos ? ['Validar cadena de frío, habilitaciones, vehículos y certificados sanitarios.'] : []),
    'Separar documentación administrativa y técnica.',
    'Calcular precio completo, logística, garantías e impuestos.',
    'Preparar propuesta y revisar anexos del pliego.',
  ];
}

function esAlimentos(lic, perfil) {
  return /alimento|carne|pollo|frigor|c[aá]rnico|refriger|v[ií]veres|canes|equinos/i.test([
    lic.titulo,
    lic.descripcion,
    lic.rubro,
    perfil?.rubro,
    perfil?.descripcion,
  ].filter(Boolean).join(' '));
}

function diasRestantes(fecha) {
  if (!fecha) return null;
  return Math.ceil((new Date(`${fecha}T00:00:00`) - new Date()) / 86400000);
}

function formatearFecha(fecha) {
  return new Date(`${fecha}T00:00:00`).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function recortar(texto, largo) {
  const value = String(texto || '');
  return value.length > largo ? `${value.slice(0, largo)}...` : value;
}

function lista(valor, fallback) {
  return Array.isArray(valor) && valor.length ? valor.map(String) : fallback;
}
