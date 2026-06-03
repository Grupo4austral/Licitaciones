import { supabase } from './supabase.js';
import { wsManager } from './websocket.js';

const DEFAULT_DAYS = 3;
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;

class RecordatoriosFavoritosService {
  #timer = null;
  #running = false;

  start() {
    const interval = Number(process.env.REMINDER_POLL_MS || DEFAULT_INTERVAL_MS);
    const initialDelay = Number(process.env.REMINDER_INITIAL_DELAY_MS || 20_000);

    console.log(`[Recordatorios] Servicio iniciado. Revisión cada ${Math.round(interval / 60000)} min.`);
    setTimeout(() => this.checkAndNotify(), initialDelay);
    this.#timer = setInterval(() => this.checkAndNotify(), interval);
  }

  stop() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  async checkAndNotify({ forceEmail = false } = {}) {
    if (this.#running) return { running: true };
    this.#running = true;
    const stats = {
      favoritosRevisados: 0,
      favoritosEnVentana: 0,
      sinPerfilEmail: 0,
      yaTenianRecordatorio: 0,
      alertasCreadas: 0,
      emailsEnviados: 0,
      emailsOmitidosSinConfig: 0,
      erroresEmail: [],
    };

    try {
      const days = Number(process.env.REMINDER_DAYS_BEFORE || DEFAULT_DAYS);
      const hoy = this.#fechaISO(new Date());
      const limite = this.#fechaISO(this.#sumarDias(new Date(), days));

      const { data: favoritos, error } = await supabase
        .from('favoritos')
        .select(`
          usuario_id,
          licitacion_id,
          licitaciones (id, titulo, organismo, fecha_cierre, url_original)
        `);

      if (error) throw error;
      stats.favoritosRevisados = favoritos?.length || 0;

      const usuarios = [...new Set((favoritos || []).map((fav) => fav.usuario_id).filter(Boolean))];
      const perfiles = await this.#obtenerPerfiles(usuarios);

      for (const fav of favoritos || []) {
        const lic = fav.licitaciones;
        const perfil = perfiles.get(fav.usuario_id);
        if (!lic?.fecha_cierre) continue;

        const dias = this.#diasHasta(lic.fecha_cierre);
        if (dias < 0 || dias > days) continue;
        stats.favoritosEnVentana++;

        if (!perfil?.email) {
          stats.sinPerfilEmail++;
          continue;
        }

        const yaExiste = await this.#yaTieneRecordatorio(fav.usuario_id, lic.id);
        if (yaExiste && !forceEmail) {
          stats.yaTenianRecordatorio++;
          continue;
        }

        const mensaje = this.#mensaje(lic, dias);
        if (!yaExiste) {
          const { error: insertError } = await supabase.from('alertas').insert({
            usuario_id: fav.usuario_id,
            licitacion_id: lic.id,
            mensaje,
            leida: false,
          });

          if (insertError) throw insertError;
          stats.alertasCreadas++;

          wsManager.notificarNuevaLicitacion(fav.usuario_id, {
            ...lic,
            titulo: `Recordatorio: ${lic.titulo}`,
          });
        } else {
          stats.yaTenianRecordatorio++;
        }

        const enviado = await this.#enviarEmail({ perfil, lic, dias, mensaje });
        if (enviado.ok) stats.emailsEnviados++;
        else if (enviado.reason === 'missing_config') stats.emailsOmitidosSinConfig++;
        else stats.erroresEmail.push(enviado.error || 'Error desconocido');
      }

      if (stats.alertasCreadas || stats.emailsEnviados || stats.erroresEmail.length) {
        console.log(`[Recordatorios] Alertas creadas: ${stats.alertasCreadas}. Emails enviados: ${stats.emailsEnviados}.`);
      }
      return stats;
    } catch (err) {
      console.error('[Recordatorios] Error:', err.message);
      return { ...stats, error: err.message };
    } finally {
      this.#running = false;
    }
  }

  async #yaTieneRecordatorio(usuarioId, licitacionId) {
    const desde = `${this.#fechaISO(new Date())}T00:00:00.000Z`;
    const { data, error } = await supabase
      .from('alertas')
      .select('id')
      .eq('usuario_id', usuarioId)
      .eq('licitacion_id', licitacionId)
      .gte('creado_en', desde)
      .ilike('mensaje', 'Recordatorio:%')
      .limit(1);

    if (error) throw error;
    return Boolean(data?.length);
  }

  async #obtenerPerfiles(usuarioIds) {
    if (!usuarioIds.length) return new Map();

    const { data, error } = await supabase
      .from('perfiles_empresa')
      .select('usuario_id, nombre_empresa, email')
      .in('usuario_id', usuarioIds);

    if (error) throw error;
    return new Map((data || []).map((perfil) => [perfil.usuario_id, perfil]));
  }

  async #enviarEmail({ perfil, lic, dias, mensaje }) {
    if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
      return { ok: false, reason: 'missing_config' };
    }

    const subject = dias === 0
      ? `Hoy vence una licitación favorita`
      : `Una licitación favorita vence en ${dias} día${dias === 1 ? '' : 's'}`;

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.55;color:#0a0f1e">
        <h2 style="margin:0 0 12px">LicitIA</h2>
        <p>Hola ${this.#esc(perfil.nombre_empresa || 'equipo')},</p>
        <p>${this.#esc(mensaje)}</p>
        <p><strong>Organismo:</strong> ${this.#esc(lic.organismo || 'No informado')}</p>
        <p><strong>Fecha de cierre:</strong> ${this.#esc(this.#formatearFecha(lic.fecha_cierre))}</p>
        ${lic.url_original ? `<p><a href="${this.#esc(lic.url_original)}">Ver publicación oficial</a></p>` : ''}
        <p>Revisá documentación, garantías, requisitos técnicos y forma de presentación antes de ofertar.</p>
      </div>
    `;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: perfil.email,
        subject,
        html,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`[Recordatorios] No se pudo enviar email a ${perfil.email}: ${errorText}`);
      return { ok: false, reason: 'resend_error', error: errorText };
    }

    return { ok: true };
  }

  #mensaje(lic, dias) {
    const plazo = dias === 0
      ? 'vence hoy'
      : dias === 1
      ? 'vence mañana'
      : `vence en ${dias} días`;
    return `Recordatorio: "${lic.titulo}" ${plazo}. Revisá el pliego y prepará documentación antes del cierre.`;
  }

  #diasHasta(fechaISO) {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const cierre = new Date(`${fechaISO}T00:00:00`);
    return Math.ceil((cierre - hoy) / 86_400_000);
  }

  #fechaISO(date) {
    return date.toISOString().slice(0, 10);
  }

  #sumarDias(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  #formatearFecha(fechaISO) {
    return new Date(`${fechaISO}T00:00:00`).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  }

  #esc(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

export const recordatoriosFavoritosService = new RecordatoriosFavoritosService();
