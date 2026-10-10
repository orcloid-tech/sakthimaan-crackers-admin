import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { type z, type ZodType } from 'zod';
import type { ValidationIssue } from '@sakthimaan/shared';
import { AppError } from '../utils/app-error.js';

type Schemas = { body?: ZodType; query?: ZodType; params?: ZodType };
type Out<S, K extends keyof Schemas> = S extends { [P in K]: infer Z extends ZodType }
  ? z.output<Z>
  : undefined;

/** Parsed, typed request input handed to controllers. */
export interface Valid<S extends Schemas> {
  body: Out<S, 'body'>;
  query: Out<S, 'query'>;
  params: Out<S, 'params'>;
}

export type ValidatedHandler<S extends Schemas> = (
  input: Valid<S>,
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void> | void;

export function validationError(issues: ValidationIssue[]): AppError {
  return new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', issues);
}

function toIssues(location: ValidationIssue['location'], error: z.ZodError): ValidationIssue[] {
  return error.issues.map((i) => ({
    location,
    path: i.path.map(String).join('.'),
    message: i.message,
    code: i.code,
  }));
}

/**
 * Validates body / query / params with Zod and calls the handler with the parsed,
 * typed values. Every route that takes input goes through this; unknown body keys are
 * rejected by the schemas (`z.strictObject`). Async errors propagate to the error
 * handler (Express 5 forwards rejected promises).
 */
export function validated<S extends Schemas>(schemas: S, handler: ValidatedHandler<S>): RequestHandler {
  return async (req, res, next) => {
    const issues: ValidationIssue[] = [];
    const parsed: Record<string, unknown> = {};
    for (const location of ['params', 'query', 'body'] as const) {
      const schema = schemas[location];
      if (!schema) continue;
      const result = schema.safeParse(location === 'body' ? (req.body ?? {}) : req[location]);
      if (result.success) parsed[location] = result.data;
      else issues.push(...toIssues(location, result.error));
    }
    if (issues.length > 0) throw validationError(issues);
    await handler(parsed as unknown as Valid<S>, req, res, next);
  };
}
