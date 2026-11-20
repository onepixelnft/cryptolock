"use client";

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConfig } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import type { Hash, TransactionReceipt } from "viem";
import { describeError, TransactionRevertedError, type ErrorMessage } from "@/lib/errors";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { explorerUrl } from "@/config/chains";

export interface TxStep {
  id: string;
  label: string;
  send: () => Promise<Hash>;
}

export type StepState = "waiting" | "signing" | "pending" | "done" | "error";

export interface StepView {
  id: string;
  label: string;
  state: StepState;
  hash?: Hash;
}

export type FlowStatus = "idle" | "running" | "success" | "error";

export function useTxFlow() {
  const config = useConfig();
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const { t } = useI18n();
  const [steps, setSteps] = useState<StepView[]>([]);
  const [status, setStatus] = useState<FlowStatus>("idle");
  const [error, setError] = useState<ErrorMessage | null>(null);
  const running = useRef(false);

  const run = useCallback(
    async (input: TxStep[]): Promise<TransactionReceipt[] | null> => {
      if (running.current) return null;
      running.current = true;
      setError(null);
      setStatus("running");
      setSteps(input.map((s) => ({ id: s.id, label: s.label, state: "waiting" })));
      const update = (index: number, patch: Partial<StepView>) =>
        setSteps((all) => all.map((s, i) => (i === index ? { ...s, ...patch } : s)));

      const receipts: TransactionReceipt[] = [];
      try {
        for (let i = 0; i < input.length; i++) {
          update(i, { state: "signing" });
          const hash = await input[i].send();
          update(i, { state: "pending", hash });
          const chainId = config.state.chainId;
          notify({ kind: "info", message: t("tx.submitted"), href: explorerUrl(chainId, "tx", hash) });
          const receipt = await waitForTransactionReceipt(config, { hash });
          if (receipt.status !== "success") throw new TransactionRevertedError();
          receipts.push(receipt);
          update(i, { state: "done" });
          notify({ kind: "success", message: t("tx.confirmed"), href: explorerUrl(chainId, "tx", hash) });
        }
        setStatus("success");
        return receipts;
      } catch (err) {
        const message = describeError(err);
        setSteps((all) => all.map((s) => (s.state === "signing" || s.state === "pending" ? { ...s, state: "error" } : s)));
        setError(message);
        setStatus("error");
        notify({ kind: "error", message: t(message.key, message.vars) });
        return null;
      } finally {
        running.current = false;
        await queryClient.invalidateQueries();
      }
    },
    [config, notify, queryClient, t],
  );

  const reset = useCallback(() => {
    setSteps([]);
    setStatus("idle");
    setError(null);
  }, []);

  return { run, reset, steps, status, error };
}
