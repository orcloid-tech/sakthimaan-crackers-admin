import { z } from 'zod';

const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.url({ message: 'Each origin must be a full URL, e.g. https://admin.example.com' })));

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const int = (def: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z.coerce.number().int().min(min).max(max).default(def);

/**
 * Every environment variable the API reads, validated once at startup.
 * The process refuses to start with a readable error instead of failing later.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: int(4000, 1, 65535),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    /** Number of trusted reverse proxies (Render/Railway/Nginx = 1). Needed for correct client IPs. */
    TRUST_PROXY: int(0, 0, 10),

    MONGODB_URI: z
      .string()
      .regex(/^mongodb(\+srv)?:\/\//, 'MONGODB_URI must be a mongodb:// or mongodb+srv:// URI'),

    /** Admin panel origins (credentialed CORS; also the CSRF Origin allowlist for cookie endpoints). */
    CORS_ADMIN_ORIGINS: csv,
    /** Customer website origins (public namespace only, no credentials). */
    CORS_PUBLIC_ORIGINS: csv,
    /** Development: also accept the admin from private-network addresses (phone testing over Wi-Fi). */
    DEV_ALLOW_LAN_ORIGINS: bool.optional(),
    /** Base URL of the admin app, used in password-reset links. */
    ADMIN_APP_URL: z.url(),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    // Data encryption at rest (separate from JWT signing; see services/encryption.ts).
    // Required in production (checked at start-up); optional in development and tests.
    ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY must be at least 32 characters').optional(),
    JWT_ACCESS_TTL_SECONDS: int(900, 60, 3600),
    JWT_ISSUER: z.string().default('sakthimaan-api'),
    JWT_AUDIENCE: z.string().default('sakthimaan-admin'),
    REFRESH_TOKEN_TTL_DAYS: int(7, 1, 90),
    /**
     * A rotated refresh token presented again within this many seconds (two tabs, a retried
     * request) gets the same new pair instead of triggering reuse detection. 0 disables.
     */
    REFRESH_REUSE_GRACE_SECONDS: int(30, 0, 120),
    REFRESH_COOKIE_NAME: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .default('smc_rt'),
    /** Defaults to true in production. */
    COOKIE_SECURE: bool.optional(),
    /**
     * Admin (admin.<domain>) and API (api.<domain>) on one registrable domain are the same
     * site, so `strict` works. `none` is only for cross-site hosting, which browsers
     * increasingly block for cookies anyway (see README, "Hosting & cookies").
     */
    COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('strict'),
    /**
     * Leave unset (recommended): the cookie is host-only on the API host, which is all the
     * refresh flow needs. Set it (e.g. `example.com`) only if another subdomain must receive it.
     */
    COOKIE_DOMAIN: z
      .string()
      .trim()
      .toLowerCase()
      .transform((v) => v.replace(/^\./, ''))
      .pipe(
        z.string().regex(/^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z]{2,63}$/, 'Must be a domain like example.com'),
      )
      .optional(),

    BCRYPT_COST: int(12, 4, 15),
    LOGIN_MAX_ATTEMPTS: int(5, 1, 50),
    LOGIN_LOCK_MINUTES: int(15, 1, 1440),
    PASSWORD_RESET_TTL_MINUTES: int(30, 5, 1440),

    RATE_LIMIT_ADMIN_PER_MIN: int(600, 1),
    RATE_LIMIT_AUTH_PER_15MIN: int(20, 1),
    RATE_LIMIT_PUBLIC_READ_PER_MIN: int(120, 1),
    RATE_LIMIT_PUBLIC_WRITE_PER_10MIN: int(10, 1),

    MAIL_PROVIDER: z.enum(['console', 'smtp']).default('console'),
    MAIL_FROM: z.string().default('no-reply@localhost'), // address only; the name comes from Settings
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: int(587, 1, 65535),
    SMTP_SECURE: bool.default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),

    CAPTCHA_PROVIDER: z.enum(['none']).default('none'),

    /** cloudinary in production; local (disk, served at /uploads) for development. */
    STORAGE_PROVIDER: z.enum(['local', 'cloudinary']).default('local'),
    LOCAL_UPLOAD_DIR: z.string().default('uploads'),
    /** Public base URL of this API, used to build local upload URLs. */
    PUBLIC_API_URL: z.url().optional(),
    CLOUDINARY_CLOUD_NAME: z.string().optional(),
    CLOUDINARY_API_KEY: z.string().optional(),
    CLOUDINARY_API_SECRET: z.string().optional(),
    CLOUDINARY_FOLDER: z
      .string()
      .regex(/^[a-z0-9_\-/]+$/i)
      .default('sakthimaan'),
    UPLOAD_MAX_IMAGE_MB: int(5, 1, 20),
    IMPORT_MAX_FILE_MB: int(2, 1, 20),
    IMPORT_MAX_ROWS: int(2000, 1, 10_000),

    API_DOCS_ENABLED: bool.optional(),
    JSON_BODY_LIMIT: z.string().default('1mb'),
  })
  .superRefine((env, ctx) => {
    if (env.ENCRYPTION_KEY && env.ENCRYPTION_KEY === env.JWT_ACCESS_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['ENCRYPTION_KEY'],
        message: 'Must be different from JWT_ACCESS_SECRET (rotating one must not affect the other)',
      });
    }
    if (env.NODE_ENV === 'production') {
      // Secrets must be real random values, not copied placeholders.
      for (const key of ['JWT_ACCESS_SECRET', 'ENCRYPTION_KEY'] as const) {
        const value = env[key];
        if (value && PLACEHOLDER_SECRET.test(value)) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message:
              "Looks like a placeholder. Generate one: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"",
          });
        }
      }
      if (env.BCRYPT_COST < 12) {
        ctx.addIssue({ code: 'custom', path: ['BCRYPT_COST'], message: 'Must be >= 12 in production' });
      }
      if (env.COOKIE_SECURE === false) {
        ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'Must be true in production' });
      }
      if (env.DEV_ALLOW_LAN_ORIGINS === true) {
        ctx.addIssue({
          code: 'custom',
          path: ['DEV_ALLOW_LAN_ORIGINS'],
          message: 'Not allowed in production',
        });
      }
      if (env.CORS_ADMIN_ORIGINS.length === 0) {
        ctx.addIssue({ code: 'custom', path: ['CORS_ADMIN_ORIGINS'], message: 'Required in production' });
      }
      if (env.MAIL_PROVIDER === 'console') {
        ctx.addIssue({ code: 'custom', path: ['MAIL_PROVIDER'], message: 'Use smtp in production' });
      }
    }
    if (env.COOKIE_SAMESITE === 'none' && env.COOKIE_SECURE === false) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SAMESITE'],
        message: 'SameSite=None requires secure cookies',
      });
    }
    if (env.COOKIE_DOMAIN) {
      const domain = env.COOKIE_DOMAIN;
      if (SHARED_HOSTING_SUFFIXES.some((s) => domain === s || domain.endsWith(`.${s}`))) {
        ctx.addIssue({
          code: 'custom',
          path: ['COOKIE_DOMAIN'],
          message: `${domain} is a shared hosting domain (public suffix); browsers reject cookies scoped to it. Use your own domain.`,
        });
      }
      const outside = env.CORS_ADMIN_ORIGINS.filter((o) => !isWithinDomain(new URL(o).hostname, domain));
      if (env.COOKIE_SAMESITE !== 'none' && outside.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['CORS_ADMIN_ORIGINS'],
          message: `Admin origin(s) ${outside.join(', ')} are not under COOKIE_DOMAIN ${domain}; the refresh cookie would not be sent`,
        });
      }
    }
    if (env.STORAGE_PROVIDER === 'cloudinary') {
      for (const key of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'] as const) {
        if (!env[key])
          ctx.addIssue({ code: 'custom', path: [key], message: 'Required when STORAGE_PROVIDER=cloudinary' });
      }
    }
    if (env.MAIL_PROVIDER === 'smtp' && !env.SMTP_HOST) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_HOST'], message: 'Required when MAIL_PROVIDER=smtp' });
    }
  })
  .transform((env) => ({
    ...env,
    COOKIE_SECURE: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
    API_DOCS_ENABLED: env.API_DOCS_ENABLED ?? env.NODE_ENV !== 'production',
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    DEV_ALLOW_LAN_ORIGINS: env.DEV_ALLOW_LAN_ORIGINS ?? env.NODE_ENV === 'development',
  }));

export type Env = z.output<typeof envSchema>;

/**
 * Default hosting domains are on the Public Suffix List: `a.onrender.com` and
 * `b.onrender.com` are different *sites*, so a SameSite=Strict/Lax refresh cookie is never
 * sent between them, and SameSite=None cookies are third-party cookies that Safari (and
 * increasingly Chrome) block. Admin and API must share a custom domain.
 */
export const SHARED_HOSTING_SUFFIXES = [
  'onrender.com',
  'vercel.app',
  'netlify.app',
  'railway.app',
  'up.railway.app',
  'herokuapp.com',
  'pages.dev',
  'workers.dev',
  'fly.dev',
  'github.io',
  'web.app',
  'firebaseapp.com',
  'azurewebsites.net',
] as const;

function isWithinDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Non-fatal hosting problems worth logging at startup (fatal ones fail validation). */
/** Values copied from .env.example or obviously made up. */
const PLACEHOLDER_SECRET = /change[-_ ]?me|example|placeholder|your[-_ ]?(secret|key)|^secret|password/i;

export function deploymentWarnings(env: Env): string[] {
  const warnings: string[] = [];
  if (env.isProduction && env.STORAGE_PROVIDER === 'local') {
    warnings.push(
      'STORAGE_PROVIDER=local in production: uploads are lost on redeploy on Render/Railway (ephemeral disk). Use cloudinary.',
    );
  }
  for (const origin of env.CORS_ADMIN_ORIGINS) {
    const host = new URL(origin).hostname;
    if (SHARED_HOSTING_SUFFIXES.some((s) => isWithinDomain(host, s))) {
      warnings.push(
        `Admin origin ${origin} is on a shared hosting domain: the refresh cookie will be treated as ` +
          'cross-site/third-party and sessions will not survive a page reload. Use admin.<your-domain> and api.<your-domain>.',
      );
    }
  }
  return warnings;
}

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'EnvValidationError';
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Treat empty strings as unset, so `FOO=` in .env falls back to the default.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ''));
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return Object.freeze(result.data);
}
