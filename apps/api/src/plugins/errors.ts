import { API_BASE, type ErrorResponse } from '@parksmart/shared';
import type { FastifyError, FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { AppError } from '../lib/errors';
import { reportError } from '../lib/monitoring';

const CODE_BY_STATUS: Record<number, string> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'BUSINESS_RULE',
  429: 'RATE_LIMITED',
};

const body = (code: string, message: string, details: Record<string, unknown> = {}) =>
  ({ error: { code, message, details } }) satisfies ErrorResponse;

/** Every error leaves the API in the format from docs/09-api-conventions.md. */
export const errorsPlugin = fp(async (app: FastifyInstance) => {
  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply
        .status(400)
        .send(body('VALIDATION_FAILED', 'Request validation failed.', { issues: err.validation }));
    }
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send(body(err.code, err.message, err.details));
    }
    if (err.code?.startsWith('FST_CSRF')) {
      return reply.status(403).send(body('CSRF_INVALID', 'Missing or invalid CSRF token.'));
    }
    const status = err.statusCode ?? 500;
    if (status < 500) {
      return reply.status(status).send(body(CODE_BY_STATUS[status] ?? 'ERROR', err.message));
    }
    req.log.error({ err }, 'unhandled error');
    reportError(err, { route: req.routeOptions.url ?? 'unknown', method: req.method });
    return reply.status(500).send(body('INTERNAL', 'Something went wrong.'));
  });

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith(API_BASE) || req.url === '/health') {
      return reply.status(404).send(body('NOT_FOUND', `Route ${req.method} ${req.url} not found.`));
    }
    // Non-API GETs fall through to the web app in production (see static plugin).
    if (req.method === 'GET' && app.hasDecorator('sendSpa')) {
      return (reply as unknown as { sendSpa: () => unknown }).sendSpa();
    }
    return reply.status(404).send(body('NOT_FOUND', 'Not found.'));
  });
});
