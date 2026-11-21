/** keccak256("Transfer(address,address,uint256)") */
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export interface TransferLog {
  logIndex: number;
  token: string; // lowercase
  from: string; // lowercase
  to: string; // lowercase
  amount: bigint; // token base units
}

export interface TxLookup {
  /** chain id the transaction was found on (from the node) */
  chainId: number;
  status: 'not_found' | 'pending' | 'success' | 'failed';
  blockNumber: number | null;
  blockHash: string | null;
  /** all ERC-20 Transfer logs emitted by the transaction (any token) */
  transfers: TransferLog[];
}

export interface FoundTransfer extends TransferLog {
  txHash: string;
  blockNumber: number;
}

export interface ChainProvider {
  readonly name: string;
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<number>;
  lookupTransaction(txHash: string): Promise<TxLookup>;
  findTransfersTo(token: string, to: string, fromBlock: number, toBlock: number): Promise<FoundTransfer[]>;
  getTokenBalance(token: string, address: string): Promise<bigint>;
}

export const TX_HASH_RE = /^0x[0-9a-f]{64}$/;
export const ADDRESS_RE = /^0x[0-9a-f]{40}$/;
