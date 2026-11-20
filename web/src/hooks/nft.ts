"use client";

import { useQuery } from "@tanstack/react-query";
import type { usePublicClient } from "wagmi";
import { type Address, erc721Abi, parseAbi } from "viem";
import { nftLockVaultAbi } from "@/generated/abis";
import { fetchNftMetadata, resolveUri, type NftMetadata } from "@/lib/nft";
import { useReadyClient } from "./protocol";

type Client = NonNullable<ReturnType<typeof usePublicClient>>;

export const erc1155Abi = parseAbi([
  "function balanceOf(address account, uint256 id) view returns (uint256)",
  "function isApprovedForAll(address account, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
  "function uri(uint256 id) view returns (string)",
]);
const enumerableAbi = parseAbi(["function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)"]);
const introspectionAbi = parseAbi(["function supportsInterface(bytes4 interfaceId) view returns (bool)"]);
const collectionNameAbi = parseAbi(["function name() view returns (string)"]);

const ERC721_INTERFACE = "0x80ac58cd";
const ERC1155_INTERFACE = "0xd9b67a26";
const MAX_LISTED_PER_COLLECTION = 50;

export type NftStandard = "erc721" | "erc1155";
export const STANDARD_INDEX: Record<NftStandard, number> = { erc721: 0, erc1155: 1 };

export interface NftRef {
  collection: Address;
  standard: NftStandard;
  tokenId: bigint;
}

export interface OwnedNft extends NftRef {
  balance: bigint;
  collectionName: string;
}

export type NftLockStatus = "active" | "withdrawn" | "early";

export interface NftLock extends NftRef {
  id: bigint;
  owner: Address;
  amount: bigint;
  start: number;
  end: number;
  closedAt: number;
  status: NftLockStatus;
  minFee: bigint;
  maxFee: bigint;
  feePaid: bigint;
}

type RawNftLock = {
  owner: Address;
  start: bigint;
  standard: number;
  status: number;
  collection: Address;
  end: bigint;
  closedAt: bigint;
  tokenId: bigint;
  amount: bigint;
  minFee: bigint;
  maxFee: bigint;
  feePaid: bigint;
};

const STATUS: Record<number, NftLockStatus> = { 1: "active", 2: "withdrawn", 3: "early" };

function toNftLock(id: bigint, raw: RawNftLock): NftLock | null {
  const status = STATUS[raw.status];
  if (!status) return null;
  return {
    id,
    owner: raw.owner,
    collection: raw.collection,
    standard: raw.standard === 1 ? "erc1155" : "erc721",
    tokenId: raw.tokenId,
    amount: raw.amount,
    start: Number(raw.start),
    end: Number(raw.end),
    closedAt: Number(raw.closedAt),
    status,
    minFee: raw.minFee,
    maxFee: raw.maxFee,
    feePaid: raw.feePaid,
  };
}

export interface NftTerms {
  minFee: bigint;
  maxFee: bigint;
}

export function useNftTerms() {
  const { client, deployment, ready } = useReadyClient();
  const vault = deployment?.contracts.nftLockVault;
  return useQuery({
    queryKey: ["nftTerms", deployment?.chainId, vault],
    enabled: ready && !!vault,
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<NftTerms> => {
      const [minFee, maxFee] = await client!.readContract({ address: vault!, abi: nftLockVaultAbi, functionName: "earlyUnlockFeeTerms" });
      return { minFee, maxFee };
    },
  });
}

export function useNftLocks(owner: Address | undefined) {
  const { client, deployment, ready } = useReadyClient();
  const vault = deployment?.contracts.nftLockVault;
  return useQuery({
    queryKey: ["nftLocks", deployment?.chainId, owner],
    enabled: ready && !!vault && !!owner,
    refetchInterval: 15_000,
    queryFn: async (): Promise<NftLock[]> => {
      const ids = await client!.readContract({ address: vault!, abi: nftLockVaultAbi, functionName: "lockIdsOf", args: [owner!] });
      if (ids.length === 0) return [];
      const raws = (await client!.readContract({
        address: vault!,
        abi: nftLockVaultAbi,
        functionName: "getLocks",
        args: [ids],
      })) as readonly RawNftLock[];
      return raws
        .map((raw, i) => toNftLock(ids[i], raw))
        .filter((l): l is NftLock => l !== null)
        .reverse();
    },
  });
}

export interface NftLockDetail {
  lock: NftLock;
  preview: { fee: bigint; block: bigint; at: number };
}

export function useNftLock(id: bigint | undefined) {
  const { client, deployment, ready } = useReadyClient();
  const vault = deployment?.contracts.nftLockVault;
  return useQuery({
    queryKey: ["nftLock", deployment?.chainId, id?.toString()],
    enabled: ready && !!vault && id !== undefined,
    refetchInterval: 15_000,
    queryFn: async (): Promise<NftLockDetail | null> => {
      const block = await client!.getBlock();
      const raw = (await client!.readContract({
        address: vault!,
        abi: nftLockVaultAbi,
        functionName: "getLock",
        args: [id!],
        blockNumber: block.number,
      })) as RawNftLock;
      const lock = toNftLock(id!, raw);
      if (!lock) return null;
      const fee = await client!.readContract({
        address: vault!,
        abi: nftLockVaultAbi,
        functionName: "previewEarlyUnlock",
        args: [id!],
        blockNumber: block.number,
      });
      return { lock, preview: { fee, block: block.number, at: Number(block.timestamp) } };
    },
  });
}

export function useOwnedNfts(owner: Address | undefined) {
  const { client, deployment, ready } = useReadyClient();
  const collections = deployment?.nftCollections ?? [];
  return useQuery({
    queryKey: ["ownedNfts", deployment?.chainId, owner],
    enabled: ready && !!owner && collections.length > 0,
    refetchInterval: 30_000,
    queryFn: async (): Promise<OwnedNft[]> => {
      const out: OwnedNft[] = [];
      for (const c of collections) {
        try {
          if (c.standard === "erc721" && c.enumerable) {
            const balance = await client!.readContract({ address: c.address, abi: erc721Abi, functionName: "balanceOf", args: [owner!] });
            const count = Number(balance > BigInt(MAX_LISTED_PER_COLLECTION) ? BigInt(MAX_LISTED_PER_COLLECTION) : balance);
            const ids = await Promise.all(
              Array.from({ length: count }, (_, i) =>
                client!.readContract({ address: c.address, abi: enumerableAbi, functionName: "tokenOfOwnerByIndex", args: [owner!, BigInt(i)] }),
              ),
            );
            for (const tokenId of ids) out.push({ collection: c.address, standard: "erc721", tokenId, balance: 1n, collectionName: c.name });
          } else if (c.standard === "erc1155") {
            for (const id of c.ids ?? []) {
              const balance = await client!.readContract({
                address: c.address,
                abi: erc1155Abi,
                functionName: "balanceOf",
                args: [owner!, BigInt(id)],
              });
              if (balance > 0n) out.push({ collection: c.address, standard: "erc1155", tokenId: BigInt(id), balance, collectionName: c.name });
            }
          }
        } catch {
        }
      }
      return out;
    },
  });
}

export type InspectResult =
  | { ok: true; standard: NftStandard; balance: bigint; collectionName: string }
  | { ok: false; reason: "notNft" };

export async function inspectNft(client: Client, collection: Address, tokenId: bigint, owner: Address): Promise<InspectResult> {
  const supports = (id: `0x${string}`) =>
    client.readContract({ address: collection, abi: introspectionAbi, functionName: "supportsInterface", args: [id] }).catch(() => false);
  const [is721, is1155] = await Promise.all([supports(ERC721_INTERFACE), supports(ERC1155_INTERFACE)]);
  if (!is721 && !is1155) return { ok: false, reason: "notNft" };
  const collectionName = await client
    .readContract({ address: collection, abi: collectionNameAbi, functionName: "name" })
    .catch(() => "");
  if (is721) {
    const holder = await client
      .readContract({ address: collection, abi: erc721Abi, functionName: "ownerOf", args: [tokenId] })
      .catch(() => null);
    return { ok: true, standard: "erc721", balance: holder?.toLowerCase() === owner.toLowerCase() ? 1n : 0n, collectionName };
  }
  const balance = await client
    .readContract({ address: collection, abi: erc1155Abi, functionName: "balanceOf", args: [owner, tokenId] })
    .catch(() => 0n);
  return { ok: true, standard: "erc1155", balance, collectionName };
}

export function useNftMetadata(ref: NftRef | undefined) {
  const { client, deployment, ready } = useReadyClient();
  return useQuery({
    queryKey: ["nftMetadata", deployment?.chainId, ref?.collection.toLowerCase(), ref?.tokenId.toString()],
    enabled: ready && !!ref,
    staleTime: Infinity,
    retry: 0,
    queryFn: async (): Promise<NftMetadata | null> => {
      const uri =
        ref!.standard === "erc721"
          ? await client!.readContract({ address: ref!.collection, abi: erc721Abi, functionName: "tokenURI", args: [ref!.tokenId] }).catch(() => null)
          : await client!.readContract({ address: ref!.collection, abi: erc1155Abi, functionName: "uri", args: [ref!.tokenId] }).catch(() => null);
      const url = resolveUri(uri, ref!.tokenId);
      return url ? fetchNftMetadata(url) : null;
    },
  });
}

export function useCollectionName(collection: Address | undefined) {
  const { client, deployment, ready } = useReadyClient();
  const known = deployment?.nftCollections?.find((c) => c.address.toLowerCase() === collection?.toLowerCase());
  return useQuery({
    queryKey: ["collectionName", deployment?.chainId, collection?.toLowerCase()],
    enabled: ready && !!collection && !known,
    staleTime: Infinity,
    initialData: known ? known.name : undefined,
    queryFn: async () =>
      client!.readContract({ address: collection!, abi: collectionNameAbi, functionName: "name" }).catch(() => ""),
  });
}
