import { env } from '../config/env.js';
import { depositPolicy } from '../config/compliance.js';
import { refreshOpenDeposits, scanReceivingWallet } from '../modules/deposits.service.js';

let timer: NodeJS.Timeout | null = null;
let running = false;

/**
 * Periodic chain work:
 *  - re-verify submitted / awaiting-confirmation deposits (confirmation tracking)
 *  - scan the receiving wallet for unmatched incoming transfers
 * On mainnet nothing runs until the compliance gate is open (depositPolicy().accepting).
 */
export async function tick() {
  if (running) return;
  running = true;
  try {
    const policy = await depositPolicy();
    if (!policy.accepting) return;
    if (env.SCANNER_ENABLED) {
      const r = await scanReceivingWallet();
      if (r.found) console.log(`[scanner] ${r.found} new unmatched transfer(s) in blocks ${r.from}-${r.to}`);
    }
    await refreshOpenDeposits();
  } catch (e) {
    console.warn('[chain-jobs]', (e as Error).message);
  } finally {
    running = false;
  }
}

export function startChainJobs() {
  if (timer) return;
  timer = setInterval(tick, env.CHAIN_POLL_INTERVAL_MS);
  void tick();
}

export function stopChainJobs() {
  if (timer) clearInterval(timer);
  timer = null;
}
