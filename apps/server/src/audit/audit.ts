import { createHash } from 'node:crypto';
import { prisma, type Tx } from '../lib/prisma.js';

export interface AuditInput {
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
  ip?: string | null;
}

const GENESIS = '0'.repeat(64);

const replacer = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

function computeHash(prevHash: string, row: { actorId: string | null; action: string; entityType: string; entityId: string | null; details: string; createdAt: string }) {
  const canonical = JSON.stringify([prevHash, row.actorId, row.action, row.entityType, row.entityId, row.details, row.createdAt]);
  return createHash('sha256').update(canonical).digest('hex');
}

/** Append an audit record. Must be called inside the same withTx as the change it describes. */
export async function audit(tx: Tx, input: AuditInput) {
  const last = await tx.auditLog.findFirst({ orderBy: { seq: 'desc' }, select: { hash: true } });
  const prevHash = last?.hash ?? GENESIS;
  const createdAt = new Date();
  const details = JSON.stringify(input.details ?? {}, replacer);
  const hash = computeHash(prevHash, {
    actorId: input.actorId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    details,
    createdAt: createdAt.toISOString(),
  });
  return tx.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      actorRole: input.actorRole ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      details,
      ip: input.ip ?? null,
      prevHash,
      hash,
      createdAt,
    },
  });
}

/** Recompute the whole chain. Any edited, inserted or removed row breaks it. */
export async function verifyAuditChain() {
  let prev = GENESIS;
  let count = 0;
  let cursor: number | undefined;
  for (;;) {
    const rows = await prisma.auditLog.findMany({
      orderBy: { seq: 'asc' },
      take: 1000,
      ...(cursor !== undefined ? { cursor: { seq: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;
    for (const r of rows) {
      const expected = computeHash(prev, {
        actorId: r.actorId,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        details: r.details,
        createdAt: r.createdAt.toISOString(),
      });
      if (r.prevHash !== prev || r.hash !== expected) {
        return { valid: false, checked: count, brokenAtSeq: r.seq };
      }
      prev = r.hash;
      count++;
    }
    cursor = rows[rows.length - 1].seq;
  }
  return { valid: true, checked: count, brokenAtSeq: null as number | null };
}
