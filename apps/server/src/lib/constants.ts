export const Roles = ['USER', 'ADMIN', 'SUPERADMIN'] as const;
export type Role = (typeof Roles)[number];
export const isAdminRole = (r: string) => r === 'ADMIN' || r === 'SUPERADMIN';

export const UserStatus = ['ACTIVE', 'SUSPENDED'] as const;

export const DepositStatus = {
  SUBMITTED: 'SUBMITTED',
  AWAITING_VERIFICATION: 'AWAITING_VERIFICATION',
  AWAITING_CONFIRMATIONS: 'AWAITING_CONFIRMATIONS',
  VERIFIED: 'VERIFIED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type DepositStatus = keyof typeof DepositStatus;

export const WithdrawalStatus = {
  REQUESTED: 'REQUESTED',
  APPROVED: 'APPROVED',
  PAYOUT_RECORDED: 'PAYOUT_RECORDED',
  COMPLETED: 'COMPLETED',
  REJECTED: 'REJECTED',
} as const;

export const StakingStatus = {
  REQUESTED: 'REQUESTED',
  ACTIVE: 'ACTIVE',
  REJECTED: 'REJECTED',
  ENDED: 'ENDED',
} as const;

export const UserAccountTypes = ['AVAILABLE', 'LOCKED', 'PENDING', 'STAKED'] as const;
export type UserAccountType = (typeof UserAccountTypes)[number];
export const PlatformAccountTypes = ['DEPOSIT_CLEARING', 'REWARD_FUNDING', 'ADJUSTMENTS', 'WITHDRAWAL_PAYOUTS'] as const;
export type PlatformAccountType = (typeof PlatformAccountTypes)[number];

export const SUPPORTED_ASSETS = [{ currency: 'USDT', network: 'ETHEREUM_ERC20', label: 'USDT · Ethereum (ERC-20)' }] as const;
