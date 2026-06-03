import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'LicitIA API',
      version: '1.0.0',
      description:
        'API REST de LicitIA — Plataforma de licitaciones públicas con inteligencia artificial para pymes argentinas.',
      contact: {
        name: 'Equipo LicitIA',
        email: 'dev@licitia.ar',
      },
    },
    servers: [
      {
        url: 'http://localhost:3000/api',
        description: 'Servidor de desarrollo',
      },
      {
        url: 'https://licitia.onrender.com/api',
        description: 'Servidor de producción',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token obtenido en /auth/login',
        },
      },
      schemas: {
        Usuario: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            nombre: { type: 'string', example: 'María García' },
            email: { type: 'string', format: 'email', example: 'maria@empresa.com' },
            rol: { type: 'string', example: 'usuario' },
            creado_en: { type: 'string', format: 'date-time' },
          },
        },
        PerfilEmpresa: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            usuario_id: { type: 'string', format: 'uuid' },
            nombre_empresa: { type: 'string', example: 'Limpieza Total SRL' },
            rubro: { type: 'string', example: 'Servicios de limpieza' },
            descripcion: { type: 'string' },
            provincia: { type: 'string', example: 'Buenos Aires' },
            ciudad: { type: 'string', example: 'Pilar' },
            palabras_clave: {
              type: 'array',
              items: { type: 'string' },
              example: ['limpieza', 'mantenimiento', 'sanitización'],
            },
          },
        },
        Licitacion: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            fuente: { type: 'string', example: 'Datos Argentina / COMPR.AR' },
            titulo: { type: 'string' },
            organismo: { type: 'string' },
            descripcion: { type: 'string' },
            rubro: { type: 'string' },
            provincia: { type: 'string' },
            fecha_publicacion: { type: 'string', format: 'date' },
            fecha_cierre: { type: 'string', format: 'date' },
            presupuesto_estimado: { type: 'number' },
            url_original: { type: 'string', format: 'uri' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            detalle: { type: 'string' },
          },
        },
      },
    },
  },
  apis: ['./*.js'],
};

export const swaggerSpec = swaggerJsdoc(options);
