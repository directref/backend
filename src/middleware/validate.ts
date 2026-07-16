import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { AppError } from './errorHandler';

type Target = 'body' | 'query' | 'params';

/**
 * Factory that returns middleware validating a specific part of the request
 * with a Zod schema. Throws a 422 AppError on failure.
 */
export function validate<T>(schema: ZodSchema<T>, target: Target = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      throw new AppError(
        422,
        'VALIDATION_ERROR',
        'Request validation failed',
        (result.error as ZodError).flatten().fieldErrors,
      );
    }
    // Replace with coerced/defaulted values from Zod
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any)[target] = result.data;
    next();
  };
}
