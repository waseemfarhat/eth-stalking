// npm run db:rotate-passwords — give every staff and demo account a new random password
// (and sign them out everywhere). Prints the new passwords once.
import { randomBytes } from 'node:crypto';
import { hashPassword, revokeAllSessions } from '../src/auth/auth.js';
import { audit } from '../src/audit/audit.js';
import { prisma, withTx } from '../src/lib/prisma.js';

const users = await prisma.user.findMany({
  where: { OR: [{ role: { in: ['ADMIN', 'SUPERADMIN'] } }, { email: { endsWith: '@example.test' } }] },
  orderBy: { role: 'desc' },
});
console.log('\n  New passwords (shown once — save them now):\n');
for (const u of users) {
  const pw = randomBytes(9).toString('base64url') + '7a';
  const passwordHash = await hashPassword(pw);
  await withTx(async (tx) => {
    await tx.user.update({ where: { id: u.id }, data: { passwordHash, failedLogins: 0, lockedUntil: null } });
    await audit(tx, { actorId: null, actorRole: 'SYSTEM', action: 'PASSWORD_ROTATED', entityType: 'User', entityId: u.id });
  });
  await revokeAllSessions(u.id);
  console.log(`   ${u.role.padEnd(10)}  ${u.email.padEnd(32)}  ${pw}`);
}
console.log('');
await prisma.$disconnect();
