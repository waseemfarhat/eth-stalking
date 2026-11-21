import { Prisma, PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
export type Tx = Prisma.TransactionClient;

/**
 * All state-changing financial work goes through withTx.
 *
 * SQLite allows one writer at a time; to make read-check-write sequences (balance checks,
 * duplicate checks, audit hash chaining) race-free inside this single-process server we
 * also serialise write transactions through an in-process queue. On a future PostgreSQL
 * deployment this becomes SERIALIZABLE isolation + row locks.
 */
let queue: Promise<unknown> = Promise.resolve();

export function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const run = queue.then(() => prisma.$transaction(fn, { timeout: 20000, maxWait: 20000 }));
  queue = run.catch(() => undefined);
  return run;
}

export function pushHistory(historyJson: string, item: Record<string, unknown>): string {
  const arr = JSON.parse(historyJson || '[]') as unknown[];
  arr.push({ ...item, at: new Date().toISOString() });
  return JSON.stringify(arr);
}
