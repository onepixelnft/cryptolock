"use client";

import { useState } from "react";
import { type NftRef, useNftMetadata } from "@/hooks/nft";

export function NftPicture({ image, size, fill }: { image?: string; size?: number; fill?: boolean }) {
  const [failed, setFailed] = useState(false);
  const style = fill ? undefined : { width: size, height: size };
  if (!image || failed) {
    return (
      <span className={`nft-placeholder${fill ? " is-fill" : ""}`} style={style} aria-hidden>
        NFT
      </span>
    );
  }
  return (
    <img
      className={`nft-img${fill ? " is-fill" : ""}`}
      src={image}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      style={style}
      onError={() => setFailed(true)}
    />
  );
}

export function NftImage({ nft, size = 28, fill }: { nft: NftRef; size?: number; fill?: boolean }) {
  const metadata = useNftMetadata(nft).data;
  return <NftPicture image={metadata?.image} size={size} fill={fill} />;
}

export function useNftLabel(nft: NftRef | undefined, collectionName?: string): string {
  const metadata = useNftMetadata(nft).data;
  if (!nft) return "";
  return metadata?.name || `${collectionName || "NFT"} #${nft.tokenId.toString()}`;
}
