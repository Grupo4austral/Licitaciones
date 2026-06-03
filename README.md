# LicitIA 🏛️

Plataforma web que conecta a pymes argentinas con licitaciones públicas del Estado, usando inteligencia artificial y alertas en tiempo real.

---

## Estructura del proyecto

```
licitia/
├── frontend/
│   ├── index.html              ← SPA principal (landing + auth + dashboard)
│   ├── css/
│   │   └── styles.css          ← Estilos globales con CSS custom properties
│   └── js/
│       ├── app.js              ← Bootstrap: instancia y coordina todo
│       ├── ApiService.js       ← Clase ES6: llamadas HTTP al backend (JWT)
│       ├── AuthManager.js      ← Clase ES6: login, registro, sesión
│       ├── WebSocketClient.js  ← Clase ES6: conexión WS + popups emergentes
│       ├── LicitacionesView.js ← Clase ES6: grid de licitaciones, filtros, favoritos
│       ├── PerfilView.js       ← Clase ES6: formulario perfil empresa + tags
│       └── AlertasView.js      ← Clase ES6: panel de notificaciones
│
└── backend/
    ├── server.js               ← Express + HTTP server + WebSocket init
    ├── package.json
    ├── .env.example            ← Variables de entorno requeridas
    ├── config/
    │   ├── supabase.js         ← Cliente Supabase (service role)
    │   └── swagger.js          ← Configuración OpenAPI 3.0
    ├── middleware/
    │   └── auth.js             ← JWT middleware + requireRole()
    ├── routes/
    │   ├── auth.js             ← POST /auth/register, POST /auth/login
    │   ├── licitaciones.js     ← GET/POST /licitaciones (dispara WS al crear)
    │   ├── perfil.js           ← GET/POST /perfil
    │   ├── favoritos.js        ← GET/POST/DELETE /favoritos
    │   └── alertas.js          ← GET /alertas, POST /alertas/:id/leer
    └── services/
        └── websocket.js        ← WebSocketManager singleton
```

---

## Setup

### 1. Clonar y configurar el backend

```bash
cd backend
cp .env.example .env
# Completar SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y JWT_SECRET en .env
npm install
npm run dev
```

El backend corre en `http://localhost:3000`

### 2. Abrir el frontend

Servir el frontend con cualquier servidor estático:

```bash
cd frontend
npx serve .
# o con Live Server en VS Code
```

Abrir `http://localhost:5500` (o el puerto que use el servidor)

---

## API REST

La documentación Swagger está disponible en:
```
http://localhost:3000/api/docs
```

### Endpoints principales

| Método | Ruta                        | Auth | Descripción                          |
|--------|-----------------------------|------|--------------------------------------|
| POST   | /api/auth/register          | ❌    | Registro de usuario                  |
| POST   | /api/auth/login             | ❌    | Login → devuelve JWT                 |
| GET    | /api/licitaciones           | ✅    | Listar con filtros y paginación      |
| GET    | /api/licitaciones/:id       | ✅    | Detalle de una licitación            |
| POST   | /api/licitaciones           | ✅    | Crear licitación (dispara WS alert)  |
| GET    | /api/perfil                 | ✅    | Obtener perfil de empresa            |
| POST   | /api/perfil                 | ✅    | Crear/actualizar perfil              |
| GET    | /api/favoritos              | ✅    | Listar favoritos                     |
| POST   | /api/favoritos              | ✅    | Agregar a favoritos                  |
| DELETE | /api/favoritos/:id          | ✅    | Quitar de favoritos                  |
| GET    | /api/alertas                | ✅    | Listar alertas (filtro no leídas)    |
| POST   | /api/alertas/:id/leer       | ✅    | Marcar alerta como leída             |
| POST   | /api/alertas/leer-todas     | ✅    | Marcar todas como leídas             |

---

## WebSocket

Conexión: `ws://localhost:3000/ws?userId=<uuid>`

### Mensajes del servidor

```json
// Al conectar
{ "tipo": "conexion_ok", "mensaje": "...", "timestamp": "..." }

// Nueva licitación compatible
{
  "tipo": "nueva_licitacion",
  "licitacion": {
    "id": "uuid",
    "titulo": "...",
    "organismo": "...",
    "rubro": "...",
    "provincia": "...",
    "fecha_cierre": "2025-07-01",
    "presupuesto_estimado": 2400000,
    "url_original": "https://..."
  },
  "timestamp": "..."
}
```

El popup emergente se muestra automáticamente. Se auto-cierra a los 12 segundos.

---

## Base de datos (Supabase)

Las tablas están definidas en el SQL provisto. El backend usa el cliente con `service_role_key` para operar sin restricciones de RLS.

---

## Despliegue

### Backend (Render)
1. Crear Web Service en [render.com](https://render.com)
2. Root directory: `.`
3. Build command: `npm install`
4. Start command: `node server.js`
5. Agregar variables de entorno del `.env`

### Frontend (GitHub Pages / Vercel / Netlify)
Subir el directorio `frontend/` como sitio estático.
Actualizar `API_URL` y `WS_URL` en `app.js` con la URL de producción del backend.

---

## Fuente nacional de licitaciones

LicitIA consulta oportunidades actuales desde el portal público oficial COMPR.AR (`https://comprar.gob.ar`) y las normaliza al esquema interno de `licitaciones`.

El backend ejecuta un polling periódico desde `datosGobAr.js`:
- detecta procesos nuevos publicados en COMPR.AR;
- evita duplicados usando `url_original`;
- guarda los registros en Supabase;
- dispara WebSocket para usuarios compatibles;
- persiste alertas para usuarios desconectados.

También queda documentada la fuente histórica de datos abiertos de la ONC en datos.gob.ar, útil como referencia y respaldo, pero no suficiente para alertas en tiempo real por su frecuencia de actualización.

---

## Requisitos del Proyecto Integrador

✅ Repositorio GitHub con colaboración de 4 integrantes  
✅ HTML/CSS con classes e ids (sin tags deprecados)  
✅ JavaScript orientado a objetos con 4+ clases ES6  
✅ Backend con Node.js + Express  
✅ Persistencia en Supabase (PostgreSQL)  
✅ Al menos 1 llamado GET  
✅ Al menos 1 llamado POST con body  
✅ Seguridad: JWT (Authentication) + middleware de Authorization  
✅ APIs documentadas con Swagger (OpenAPI 3.0)  
✅ Sin bugs mayores, funcionalidad completa  
✅ Desplegable en Render + GitHub Pages / Vercel  
✅ **Crédito extra**: WebSocket para alertas en tiempo real  
