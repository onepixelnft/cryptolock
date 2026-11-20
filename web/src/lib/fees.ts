export function feeBpsAt(minBps: number, maxBps: number, start: number, end: number, timestamp: number): number {
  if (timestamp >= end) return 0;
  const from = Math.max(timestamp, start);
  return minBps + Math.floor(((maxBps - minBps) * (end - from)) / (end - start));
}

export function feeBpsAfterShare(minBps: number, maxBps: number, elapsedShare: number): number {
  const remainingShare = Math.min(1, Math.max(0, 1 - elapsedShare));
  return minBps + Math.floor((maxBps - minBps) * remainingShare);
}
