"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useBlock } from "wagmi";
import { useNetwork } from "@/hooks/useNetwork";

const ChainClockContext = createContext<number>(0);

export function ChainClockProvider({ children }: { children: ReactNode }) {
  const { status } = useNetwork();
  const ready = status === "ready";
  const { data: block } = useBlock({ watch: ready, query: { enabled: ready } });
  const offset = useRef(0);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    if (!block) return;
    const drift = Number(block.timestamp) - Date.now() / 1000;
    offset.current = drift > 0 ? drift : 0;
    setNow(Math.floor(Date.now() / 1000 + offset.current));
  }, [block]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000 + offset.current)), 1_000);
    return () => window.clearInterval(id);
  }, []);

  return <ChainClockContext.Provider value={now}>{children}</ChainClockContext.Provider>;
}

export function useChainNow(): number {
  return useContext(ChainClockContext);
}
