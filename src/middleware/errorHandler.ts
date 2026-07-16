import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { env } from '../config/env';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    stack?: string;
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  // AppError — known operational errors
  if (err instanceof AppError) {
    const body: ErrorBody = {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    };
    res.status(err.statusCode).json(body);
    return;
  }

  // Zod validation errors
  if (err instanceof ZodError) {
    res.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.flatten().fieldErrors,
      },
    });
    return;
  }

  // Multer errors
  if (err && typeof err === 'object' && 'code' in err) {
    const multerErr = err as { code: string; message: string };
    if (multerErr.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        error: {
          code: 'FILE_TOO_LARGE',
          message: `File exceeds the ${env.MAX_CV_SIZE_MB}MB size limit`,
        },
      });
      return;
    }
  }

  // Unknown errors
  console.error('[unhandled error]', err);
  const isProd = env.NODE_ENV === 'production';
  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
      ...(isProd ? {} : { stack: err instanceof Error ? err.stack : String(err) }),
    },
  });
}
