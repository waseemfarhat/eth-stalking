import { Router } from 'express';
import { getAddress } from 'ethers';
import { chainConfig } from '../config/env.js';
import { depositPolicy, localRealTestLimits } from '../config/compliance.js';
import { getMinConfirmations } from '../config/settings.js';
import { h } from '../middleware/http.js';

export const publicRouter = Router();

publicRouter.get(
  '/config',
  h(async (_req, res) => {
    const cfg = chainConfig();
    const policy = await depositPolicy();
    res.json({
      platform: 'ETH STALKING',
      chain: { mode: cfg.mode, chainId: cfg.chainId, tokenContract: cfg.tokenContract, symbol: cfg.symbol, decimals: cfg.decimals },
      minConfirmations: await getMinConfirmations(),
      deposits: {
        accepting: policy.accepting,
        realFunds: policy.realFunds,
        localTest: policy.localTest,
        limits: policy.localTest ? { maxDeposit: localRealTestLimits().maxDeposit, maxTotal: localRealTestLimits().maxTotal } : null,
        reason: policy.reason,
        wallet: policy.wallet
          ? {
              label: policy.wallet.label,
              provider: policy.wallet.provider,
              address: getAddress(policy.wallet.address),
              currency: policy.wallet.currency,
              network: policy.wallet.network,
              chainId: policy.wallet.chainId,
              isSample: policy.wallet.isSample,
            }
          : null,
      },
      assets: [{ currency: 'USDT', network: 'ETHEREUM_ERC20', label: 'USDT · Ethereum (ERC-20)' }],
    });
  }),
);

publicRouter.get('/health', (_req, res) => res.json({ ok: true }));
