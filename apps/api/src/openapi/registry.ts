import { z, type ZodType } from 'zod';
import { ERROR_CODES, type Permission } from '@sakthimaan/shared';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface RouteDoc {
  method: Method;
  /** Express-style full path, e.g. /api/v1/orders/:id */
  path: string;
  summary: string;
  tag: string;
  auth: 'bearer' | 'refresh-cookie' | 'none';
  permissions?: readonly Permission[];
  body?: ZodType;
  query?: ZodType;
  /** Status → description. 200 and the error envelope are added automatically. */
  responses?: Record<number, string>;
  description?: string;
}

type JsonSchema = Record<string, unknown>;

const toJsonSchema = (schema: ZodType): JsonSchema =>
  z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });

/**
 * Minimal OpenAPI 3.1 generator fed by the same Zod schemas that validate requests,
 * so the docs cannot drift from the validation. Routes register themselves next to
 * their router definitions.
 */
export class ApiDocs {
  private readonly routes: RouteDoc[] = [];

  register(doc: RouteDoc): void {
    this.routes.push(doc);
  }

  toOpenApi(info: { title: string; version: string }): Record<string, unknown> {
    const paths: Record<string, Record<string, unknown>> = {};
    for (const r of this.routes) {
      const path = r.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
      const pathParams = [...r.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => ({
        name: m[1],
        in: 'path',
        required: true,
        schema: { type: 'string' },
      }));
      const queryParams = r.query ? this.queryParameters(r.query) : [];

      const responses: Record<string, unknown> = {
        '200': {
          description: 'Success',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } },
        },
      };
      for (const [status, description] of Object.entries(r.responses ?? {})) {
        responses[status] =
          Number(status) >= 400
            ? {
                description,
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
              }
            : { description };
      }
      responses['400'] ??= {
        description: 'Validation error',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      };
      if (r.auth === 'bearer') {
        responses['401'] ??= {
          description: 'Not authenticated',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        };
        if (r.permissions?.length) {
          responses['403'] ??= {
            description: 'Missing permission',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          };
        }
      }

      const description = [
        r.description,
        r.permissions?.length
          ? `**Requires:** ${r.permissions.map((p) => `\`${p}\``).join(', ')}`
          : undefined,
      ]
        .filter(Boolean)
        .join('\n\n');

      (paths[path] ??= {})[r.method] = {
        summary: r.summary,
        tags: [r.tag],
        ...(description ? { description } : {}),
        ...(r.auth === 'bearer' ? { security: [{ bearerAuth: [] }] } : {}),
        ...(r.auth === 'refresh-cookie' ? { security: [{ refreshCookie: [] }] } : {}),
        parameters: [...pathParams, ...queryParams],
        ...(r.body
          ? {
              requestBody: {
                required: true,
                content: { 'application/json': { schema: toJsonSchema(r.body) } },
              },
            }
          : {}),
        responses,
      };
    }

    return {
      openapi: '3.1.0',
      info: {
        ...info,
        description:
          'Store admin API. All responses use the envelope `{ success, data, meta? }` or ' +
          '`{ success: false, error: { code, message, details? } }`. Amounts are integer paise.',
      },
      servers: [{ url: '/' }],
      paths,
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          refreshCookie: { type: 'apiKey', in: 'cookie', name: 'smc_rt' },
        },
        schemas: {
          Success: {
            type: 'object',
            required: ['success', 'data'],
            properties: { success: { const: true }, data: {}, meta: { type: 'object' } },
          },
          Error: {
            type: 'object',
            required: ['success', 'error'],
            properties: {
              success: { const: false },
              error: {
                type: 'object',
                required: ['code', 'message'],
                properties: { code: { enum: [...ERROR_CODES] }, message: { type: 'string' }, details: {} },
              },
            },
          },
        },
      },
    };
  }

  private queryParameters(schema: ZodType): Record<string, unknown>[] {
    const json = toJsonSchema(schema);
    const props = (json.properties ?? {}) as Record<string, JsonSchema>;
    const required = new Set((json.required as string[] | undefined) ?? []);
    return Object.entries(props).map(([name, s]) => ({
      name,
      in: 'query',
      required: required.has(name),
      schema: s,
    }));
  }
}
