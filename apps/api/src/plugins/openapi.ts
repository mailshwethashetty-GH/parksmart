import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

/** OpenAPI generated from the Zod route schemas. Swagger UI at /docs outside production. */
export const openapiPlugin = fp(async (app: FastifyInstance) => {
  await app.register(fastifySwagger, {
    openapi: {
      info: { title: 'ParkSmart API', version: '0.1.0' },
      components: {
        securitySchemes: {
          session: { type: 'apiKey', in: 'cookie', name: 'parksmart.session_token' },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  if (app.env.NODE_ENV !== 'production') {
    await app.register(fastifySwaggerUi, { routePrefix: '/docs' });
  }
});
