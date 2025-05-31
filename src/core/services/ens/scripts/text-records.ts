import { normalize, namehash } from 'viem/ens';
import { type Address, type Chain, type Hash, type TransactionReceipt } from './types.js';
import { getPublicClient, getWalletClient } from '../../../services/clients.js';
import { mainnet } from 'viem/chains';
import { isAddress, type Log } from 'viem';

// Common ABI definitions
const RESOLVER_ABI = [
  {
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' },
    ],
    name: 'setText',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'addr', type: 'address' },
    ],
    name: 'setAddr',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

/**
 * Retrieves a specific text record associated with an ENS name.
 * @param name The ENS name to query.
 * @param key The key of the text record to retrieve.
 * @param network Optional. The target blockchain network. Defaults to Ethereum mainnet.
 * @returns A Promise that resolves to the value of the text record, or null if not set.
 */
export async function getEnsTextRecord(
  name: string,
  key: string,
  network: string | Chain = mainnet
): Promise<string | null> {
  try {
    const normalizedEns = normalize(name);
    const publicClient = getPublicClient(network);
    return await publicClient.getEnsText({
      name: normalizedEns,
      key,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to get ENS text record "${key}" for "${name}". Reason: ${message} [Error Code: GetEnsTextRecord_General_001]`
    );
  }
}

/**
 * Sets a text record for an ENS name.
 * @param name The ENS name to update.
 * @param key The key of the text record to set.
 * @param value The value to set for the text record, or null to clear it.
 * @param network Optional. The target blockchain network. Defaults to Ethereum mainnet.
 * @returns A Promise that resolves to the transaction hash of the operation.
 */
export async function setEnsTextRecord(
  name: string,
  key: string,
  value: string | null,
  network: string | Chain = mainnet
): Promise<Hash> {
  try {
    const normalizedEns = normalize(name);
    const publicClient = getPublicClient(network);
    const walletClient = getWalletClient(network);
    if (!walletClient.account) {
      throw new Error('No wallet account available [Error Code: SetEnsTextRecord_NoAccount_001]');
    }
    const resolverAddress = await publicClient.getEnsResolver({
      name: normalizedEns,
    });
    if (!resolverAddress || typeof resolverAddress !== 'string' || !resolverAddress.startsWith('0x')) {
      throw new Error(`Could not resolve ENS resolver address for ${normalizedEns}`);
    }
    return await walletClient.writeContract({
      address: resolverAddress as `0x${string}`,
      abi: RESOLVER_ABI,
      functionName: 'setText',
      args: [namehash(normalizedEns), key, value || ''],
      account: walletClient.account,
      chain: walletClient.chain,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to set ENS text record "${key}" for "${name}". Reason: ${message} [Error Code: SetEnsTextRecord_General_001]`
    );
  }
}

/**
 * Sets the Ethereum address record for an ENS name.
 * @param name The ENS name to update.
 * @param address The Ethereum address to set, or null to clear it.
 * @param network Optional. The target blockchain network. Defaults to Ethereum mainnet.
 * @returns A Promise that resolves to the transaction receipt of the operation.
 */
export async function setEnsAddressRecord(
  name: string,
  address: Address | null,
  network: string | Chain = mainnet
): Promise<TransactionReceipt> {
  try {
    const normalizedEns = normalize(name);
    if (address && !isAddress(address)) {
      throw new Error(
        `Invalid Ethereum address: "${address}" [Error Code: SetEnsAddressRecord_InvalidInput_001]`
      );
    }
    const walletClient = getWalletClient(network);
    if (!walletClient.account) {
      throw new Error('No wallet account available [Error Code: SetEnsAddressRecord_NoAccount_001]');
    }
    const registryAddress = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as `0x${string}`;
    const result = await walletClient.writeContract({
      address: registryAddress,
      abi: [
        {
          inputs: [
            { name: 'node', type: 'bytes32' },
            { name: 'addr', type: 'address' },
          ],
          name: 'setAddr',
          outputs: [],
          stateMutability: 'nonpayable',
          type: 'function',
        },
      ],
      functionName: 'setAddr',
      args: [namehash(normalizedEns), address || '0x0000000000000000000000000000000000000000'],
      account: walletClient.account,
      chain: walletClient.chain,
    });
    return result as unknown as TransactionReceipt;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to set ENS address record for "${name}". Reason: ${message} [Error Code: SetEnsAddressRecord_General_001]`
    );
  }
}

/**
 * Gets the most recent ENS name registrations
 * @param count The number of recent registrations to fetch (default: 10)
 * @param network Optional. The target blockchain network. Defaults to Ethereum mainnet.
 * @returns A Promise that resolves to an array of recent registrations
 */
export async function getRecentRegistrations(
  count: number = 10,
  network: string | Chain = mainnet
): Promise<Array<{
  name: string;
  owner: Address;
  blockNumber: bigint;
  transactionHash: Hash;
}>> {
  try {
    const publicClient = getPublicClient(network);
    const registryAddress = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as `0x${string}`;
    const latestBlock = await publicClient.getBlockNumber();
    // Type logs as Log & args for correct property access
    const logs = await publicClient.getLogs({
      address: registryAddress,
      event: {
        type: 'event',
        name: 'NewOwner',
        inputs: [
          { type: 'bytes32', name: 'node', indexed: true },
          { type: 'bytes32', name: 'label', indexed: true },
          { type: 'address', name: 'owner' }
        ]
      },
      fromBlock: latestBlock - BigInt(10000),
      toBlock: latestBlock,
      strict: true // ensures args is always present
    }) as Array<Log & { args: { label: string; node: string; owner: Address } }>;
    // Filter out logs with missing or invalid blockNumber, transactionHash, or args
    const filteredLogs = logs.filter(log => typeof log.blockNumber === 'bigint' && !!log.transactionHash && !!log.args && !!log.args.owner);
    const registrations = await Promise.all(
      filteredLogs.slice(-count).map(async (log) => {
        const { label, node, owner } = log.args;
        const name = await publicClient.getEnsName({
          address: owner,
          blockNumber: log.blockNumber
        });
        return {
          name: name || 'unknown.eth',
          owner,
          blockNumber: log.blockNumber as bigint,
          transactionHash: log.transactionHash as Hash
        };
      })
    );
    return registrations.reverse();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to get recent registrations. Reason: ${message} [Error Code: GetRecentRegistrations_General_001]`
    );
  }
} 