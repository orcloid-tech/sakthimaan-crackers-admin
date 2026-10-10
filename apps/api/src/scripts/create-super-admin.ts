/**
 * Creates the first Super Admin (there is no sign-up endpoint by design).
 *
 *   SUPERADMIN_EMAIL=owner@example.com SUPERADMIN_NAME="Owner" SUPERADMIN_PASSWORD='...' \
 *     npm run create-super-admin -w @sakthimaan/api
 *
 * Refuses to run if the email is already taken. Further users are created from the
 * admin panel (Users module).
 */
import { emailSchema, passwordSchema } from '@sakthimaan/shared';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { connectDb, disconnectDb } from '../config/db.js';
import { loadEnv } from '../config/env.js';
import { createLogger } from '../config/logger.js';
import { AuditLogModel, UserModel } from '../models/index.js';

const inputSchema = z.object({
  SUPERADMIN_EMAIL: emailSchema,
  SUPERADMIN_NAME: z.string().trim().min(2).max(100),
  SUPERADMIN_PASSWORD: passwordSchema,
});

async function run(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger({ ...env, LOG_LEVEL: 'info' });
  const parsed = inputSchema.safeParse(process.env);
  if (!parsed.success) {
    for (const i of parsed.error.issues) console.error(`${i.path.join('.')}: ${i.message}`);
    process.exitCode = 1;
    return;
  }
  const { SUPERADMIN_EMAIL: email, SUPERADMIN_NAME: name, SUPERADMIN_PASSWORD: password } = parsed.data;

  await connectDb(env.MONGODB_URI, logger, { autoIndex: true });
  try {
    if (await UserModel.exists({ email })) {
      console.error(`A user with email ${email} already exists.`);
      process.exitCode = 1;
      return;
    }
    const user = await UserModel.create({
      name,
      email,
      role: 'super_admin',
      passwordHash: await bcrypt.hash(password, env.BCRYPT_COST),
      passwordChangedAt: new Date(),
    });
    await AuditLogModel.create({
      actor: { name: 'system (create-super-admin script)' },
      action: 'create',
      entity: 'user',
      entityId: String(user._id),
      entityLabel: email,
      summary: 'Super Admin created from CLI',
    });
    console.log(`Super Admin created: ${email}`);
  } finally {
    await disconnectDb();
  }
}

void run();
