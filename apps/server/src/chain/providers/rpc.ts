import { Contract, JsonRpcProvider, Network, zeroPadValue } from 'ethers';
import { TRANSFER_TOPIC, type ChainProvider, type FoundTransfer, type TransferLog, type TxLookup } from '../types.js';

const topicToAddress = (t: string) => ('0x' + t.slice(26)).toLowerCase();

/**
 * Real Ethereum JSON-RPC provider (mainnet or Sepolia).
 * The RPC URL (which may embed a provider API key) comes only from server env and is never sent to clients.
 */
export class RpcChainProvider implements ChainProvider {
  readonly name: string;
  private p: JsonRpcProvider;

  constructor(url: string, private chainId: number) {
    if (!url) throw new Error('ETH_RPC_URL is required for sepolia/mainnet mode');
    this.p = new JsonRpcProvider(url, chainId, { staticNetwork: Network.from(chainId), batchMaxCount: 1 });
    this.name = `rpc:${chainId}`;
  }

  async getChainId() {
    // Ask the node directly rather than trusting configuration.
    return Number(BigInt(await this.p.send('eth_chainId', [])));
  }

  getBlockNumber() {
    return this.p.getBlockNumber();
  }

  async lookupTransaction(txHash: string): Promise<TxLookup> {
    const nodeChainId = await this.getChainId();
    const tx = await this.p.getTransaction(txHash);
    if (!tx) return { chainId: nodeChainId, status: 'not_found', blockNumber: null, blockHash: null, transfers: [] };
    const txChainId = tx.chainId ? Number(tx.chainId) : nodeChainId;
    const receipt = await this.p.getTransactionReceipt(txHash);
    if (!receipt) return { chainId: txChainId, status: 'pending', blockNumber: null, blockHash: null, transfers: [] };
    const transfers: TransferLog[] = receipt.logs
      .filter((l) => l.topics.length === 3 && l.topics[0].toLowerCase() === TRANSFER_TOPIC)
      .map((l) => ({
        logIndex: l.index,
        token: l.address.toLowerCase(),
        from: topicToAddress(l.topics[1]),
        to: topicToAddress(l.topics[2]),
        amount: l.data && l.data !== '0x' ? BigInt(l.data) : 0n,
      }));
    return {
      chainId: txChainId,
      status: receipt.status === 1 ? 'success' : 'failed',
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      transfers,
    };
  }

  async findTransfersTo(token: string, to: string, fromBlock: number, toBlock: number): Promise<FoundTransfer[]> {
    const logs = await this.p.getLogs({
      address: token,
      topics: [TRANSFER_TOPIC, null, zeroPadValue(to, 32)],
      fromBlock,
      toBlock,
    });
    return logs
      .filter((l) => !l.removed)
      .map((l) => ({
        txHash: l.transactionHash.toLowerCase(),
        logIndex: l.index,
        blockNumber: l.blockNumber,
        token: l.address.toLowerCase(),
        from: topicToAddress(l.topics[1]),
        to: topicToAddress(l.topics[2]),
        amount: BigInt(l.data),
      }));
  }

  async getTokenBalance(token: string, address: string): Promise<bigint> {
    const c = new Contract(token, ['function balanceOf(address) view returns (uint256)'], this.p);
    return BigInt(await c.balanceOf(address));
  }
}
