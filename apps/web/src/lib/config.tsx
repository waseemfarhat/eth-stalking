import { createContext, useContext, type ReactNode } from 'react';
import { useApi } from '../api/client';

export interface PlatformConfig {
  platform: string;
  chain: { mode: 'sample' | 'sepolia' | 'mainnet'; chainId: number; tokenContract: string; symbol: string; decimals: number };
  minConfirmations: number;
  deposits: {
    accepting: boolean;
    realFunds: boolean;
    localTest?: boolean;
    limits?: { maxDeposit: string; maxTotal: string } | null;
    reason: string | null;
    wallet: { label: string; provider: string; address: string; currency: string; network: string; chainId: number; isSample: boolean } | null;
  };
  assets: { currency: string; network: string; label: string }[];
}

const Ctx = createContext<{ config: PlatformConfig | null; reload: () => void }>({ config: null, reload: () => undefined });

export function ConfigProvider({ children }: { children: ReactNode }) {
  const { data, reload } = useApi<PlatformConfig>('/config');
  return <Ctx.Provider value={{ config: data, reload }}>{children}</Ctx.Provider>;
}

export const useConfig = () => useContext(Ctx);
