export const IPFS_GATEWAY = (process.env.NEXT_PUBLIC_IPFS_GATEWAY || "https://ipfs.io/ipfs/").replace(/\/?$/, "/");

const MAX_METADATA_CHARS = 1_000_000;
const FETCH_TIMEOUT_MS = 8_000;

export interface NftMetadata {
  name?: string;
  image?: string;
}

export function resolveUri(uri: string | null | undefined, tokenId?: bigint): string | null {
  if (!uri) return null;
  let value = uri.trim();
  if (!value) return null;
  if (tokenId !== undefined) value = value.replace(/\{id\}/gi, tokenId.toString(16).padStart(64, "0"));
  if (value.startsWith("ipfs://")) return IPFS_GATEWAY + value.slice(7).replace(/^ipfs\//, "");
  if (value.startsWith("ar://")) return `https://arweave.net/${value.slice(5)}`;
  if (value.startsWith("data:") || value.startsWith("https://") || value.startsWith("http://")) return value;
  if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z2-7]+)/.test(value)) return IPFS_GATEWAY + value;
  return null;
}

function decodeDataUri(uri: string): string | null {
  const comma = uri.indexOf(",");
  if (comma < 0) return null;
  const header = uri.slice(5, comma);
  const payload = uri.slice(comma + 1);
  try {
    if (header.endsWith(";base64")) {
      const binary = atob(payload);
      return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
    }
    return decodeURIComponent(payload);
  } catch {
    return null;
  }
}

function safeImage(url: string | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("data:")) return url.startsWith("data:image/") ? url : undefined;
  return url.startsWith("https://") || url.startsWith("http://") ? url : undefined;
}

export async function fetchNftMetadata(uri: string): Promise<NftMetadata | null> {
  let text: string | null = null;
  if (uri.startsWith("data:")) {
    text = decodeDataUri(uri);
  } else {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(uri, { signal: controller.signal, referrerPolicy: "no-referrer", credentials: "omit" });
      if (!response.ok) return null;
      text = await response.text();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  if (!text || text.length > MAX_METADATA_CHARS) return null;
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    const name = typeof json.name === "string" ? json.name.slice(0, 120) : undefined;
    let image = safeImage(resolveUri(typeof json.image === "string" ? json.image : typeof json.image_url === "string" ? json.image_url : null));
    if (!image && typeof json.image_data === "string" && json.image_data.trim().startsWith("<svg")) {
      image = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(json.image_data)}`;
    }
    return { name, image };
  } catch {
    return null;
  }
}
