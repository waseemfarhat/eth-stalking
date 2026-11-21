import { randomBytes } from 'node:crypto';
import { verifyMessage } from 'ethers';

/**
 * Wallet ownership proof without ever touching a secret:
 * the owner signs this text in their wallet app (Bitget Wallet → "Sign message" / personal_sign)
 * and pastes the signature. We recover the signing address and compare.
 */
export function buildOwnershipChallenge(address: string, chainId: number) {
  const nonce = randomBytes(16).toString('hex');
  return [
    'ETH STALKING — receiving wallet ownership verification',
    '',
    `Address: ${address}`,
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued at: ${new Date().toISOString()}`,
    '',
    'Signing this message proves you control this address.',
    'It does not authorise any transaction and costs no gas.',
    'Never share your private key or recovery phrase with anyone.',
  ].join('\n');
}

export function verifyOwnershipSignature(message: string, signature: string, expectedAddress: string): { ok: boolean; recovered: string | null } {
  try {
    const recovered = verifyMessage(message, signature).toLowerCase();
    return { ok: recovered === expectedAddress.toLowerCase(), recovered };
  } catch {
    return { ok: false, recovered: null };
  }
}
