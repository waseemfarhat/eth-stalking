import type { Tx } from './prisma.js';

export function notify(tx: Tx, userId: string, type: string, title: string, body: string) {
  return tx.notification.create({ data: { userId, type, title, body } });
}
