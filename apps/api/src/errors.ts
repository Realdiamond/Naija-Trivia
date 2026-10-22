/** Errors as RFC 9457 problem+json (doc 09 §1). */
import type { FastifyError, FastifyInstance } from 'fastify';
import { ErrorCode, type Problem } from '@whosabi/shared-types';
import type { z } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    readonly title: string,
    readonly detail?: string,
  ) {
    super(title);
    this.name = 'ApiError';
  }
}

export const unauthorized = (detail?: string) =>
  new ApiError(401, ErrorCode.unauthorized, 'You need to sign in', detail);
export const notFound = (detail?: string) => new ApiError(404, ErrorCode.notFound, 'Not found', detail);
export const conflict = (code: ErrorCode, title: string, detail?: string) =>
  new ApiError(409, code, title, detail);

/** Validate input with a Zod schema; a failure becomes a 400 problem listing what's wrong. */
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
      .join('; ');
    throw new ApiError(400, ErrorCode.validation, 'The request is not valid', detail);
  }
  return result.data;
}

function problemFor(
  status: number,
  code: ErrorCode,
  title: string,
  requestId: string,
  detail?: string,
): Problem {
  return {
    type: `https://whosabi.ng/errors/${code.toLowerCase().replaceAll('_', '-')}`,
    title,
    status,
    code,
    ...(detail ? { detail } : {}),
    request_id: requestId,
  };
}

export function registerErrorHandlers(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | ApiError, request, reply) => {
    let problem: Problem;
    if (error instanceof ApiError) {
      problem = problemFor(error.status, error.code, error.title, request.id, error.detail);
    } else if (error.statusCode === 429) {
      problem = problemFor(429, ErrorCode.rateLimited, 'Too many requests', request.id, 'Try again shortly.');
    } else if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      problem = problemFor(
        error.statusCode,
        ErrorCode.validation,
        'The request is not valid',
        request.id,
        error.message,
      );
    } else {
      request.log.error({ err: error }, 'unhandled error');
      problem = problemFor(500, ErrorCode.internal, 'Something went wrong on our side', request.id);
    }
    void reply.code(problem.status).type('application/problem+json').send(problem);
  });

  app.setNotFoundHandler((request, reply) => {
    const problem = problemFor(
      404,
      ErrorCode.notFound,
      'Not found',
      request.id,
      `${request.method} ${request.url}`,
    );
    void reply.code(404).type('application/problem+json').send(problem);
  });
}
