import { NextRequest } from 'next/server';
import type { ZodIssue } from 'zod';

export type ErrorDetail = {
  field: string;
  message: string;
  code: string;
};

export type ErrorResponseBody = {
  success: false;
  error: {
    code: string;
    message: string;
    details: ErrorDetail[];
    requestId: string;
  };
};

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: ErrorDetail[];

  constructor(
    code: string,
    message: string,
    status: number,
    details: ErrorDetail[] = [],
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Request validation failed.', details: ErrorDetail[] = []) {
    super('VALIDATION_FAILED', message, 422, details);
    this.name = 'ValidationError';
  }

  static fromZodIssues(issues: readonly ZodIssue[]): ValidationError {
    const details = issues.map((issue) => ({
      field: issue.path.length > 0 ? issue.path.map(String).join('.') : '_root',
      message: issue.message,
      code: issue.code,
    }));

    return new ValidationError('Request validation failed.', details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication is required.') {
    super('UNAUTHORIZED', message, 401);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action.') {
    super('FORBIDDEN', message, 403);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'The requested resource was not found.') {
    super('NOT_FOUND', message, 404);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message = 'The requested operation conflicts with the current resource state.') {
    super('CONFLICT', message, 409);
    this.name = 'ConflictError';
  }
}

export function getRequestId(request: NextRequest): string {
  const supplied = request.headers.get('x-request-id')?.trim();
  if (supplied && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(supplied)) {
    return supplied;
  }

  return crypto.randomUUID();
}

function errorResponse(
  requestId: string,
  error: AppError,
): Response {
  const body: ErrorResponseBody = {
    success: false,
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
      requestId,
    },
  };

  return Response.json(body, {
    status: error.status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Request-Id': requestId,
    },
  });
}

function logUnexpectedError(requestId: string, error: unknown): void {
  const details = error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { value: String(error) };

  console.error(JSON.stringify({
    event: 'api_unhandled_error',
    requestId,
    ...details,
  }));
}

export type ApiHandler = (
  request: NextRequest,
  requestId: string,
) => Promise<Response> | Response;

export async function withErrorHandler(
  request: NextRequest,
  handler: ApiHandler,
): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    const response = await handler(request, requestId);
    response.headers.set('X-Request-Id', requestId);
    return response;
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(requestId, error);
    }

    logUnexpectedError(requestId, error);
    return errorResponse(
      requestId,
      new AppError(
        'INTERNAL_SERVER_ERROR',
        'An unexpected server error occurred.',
        500,
      ),
    );
  }
}
