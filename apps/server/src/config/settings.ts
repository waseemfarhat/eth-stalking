import { env } from './env.js';
import { prisma, type Tx } from '../lib/prisma.js';

export const SETTING_MIN_CONFIRMATIONS = 'deposit.minConfirmations';

/** Effective confirmation threshold: admin may raise it, never lower it below the env floor. */
export async function getMinConfirmations(client: Tx | typeof prisma = prisma) {
  const s = await client.platformSetting.findUnique({ where: { key: SETTING_MIN_CONFIRMATIONS } });
  const v = s ? Number(s.value) : env.MIN_CONFIRMATIONS;
  return Math.max(env.MIN_CONFIRMATIONS, Number.isFinite(v) ? v : env.MIN_CONFIRMATIONS);
}

export async function getSetting(key: string, client: Tx | typeof prisma = prisma) {
  return (await client.platformSetting.findUnique({ where: { key } }))?.value ?? null;
}

export async function setSetting(tx: Tx, key: string, value: string, updatedById: string | null) {
  return tx.platformSetting.upsert({ where: { key }, create: { key, value, updatedById }, update: { value, updatedById } });
}
