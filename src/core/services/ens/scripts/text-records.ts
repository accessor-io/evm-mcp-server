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

// ENS .eth Registrar Controller address and NameRegistered event ABI
const ETH_REGISTRAR_CONTROLLER_ADDRESS = '0x283Af0B28c62C092C9727F1Ee09c02CA627EB7F5' as `0x${string}`;
const NAME_REGISTERED_EVENT_ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'string', name: 'name', type: 'string' },
      { indexed: true, internalType: 'address', name: 'owner', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'cost', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'expires', type: 'uint256' }
    ],
    name: 'NameRegistered',
    type: 'event'
  }
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
  cost: bigint;
  expires: bigint;
}>> {
  try {
    const publicClient = getPublicClient(network);
    const latestBlock = await publicClient.getBlockNumber();
    const logs = await publicClient.getLogs({
      address: ETH_REGISTRAR_CONTROLLER_ADDRESS,
      event: NAME_REGISTERED_EVENT_ABI[0],
      fromBlock: latestBlock - BigInt(10000),
      toBlock: latestBlock,
      strict: true
    }) as Array<Log & { args: { name: string; owner: Address; cost: bigint; expires: bigint } }>;
    const filteredLogs = logs.filter(log => typeof log.blockNumber === 'bigint' && !!log.transactionHash && !!log.args && !!log.args.owner && !!log.args.name);
    const registrations = filteredLogs.slice(-count).map((log) => {
      const { name, owner, cost, expires } = log.args;
      return {
        name,
        owner,
        blockNumber: log.blockNumber as bigint,
        transactionHash: log.transactionHash as Hash,
        cost,
        expires
      };
    });
    return registrations.reverse();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to get recent registrations. Reason: ${message} [Error Code: GetRecentRegistrations_General_001]`
    );
  }
} 