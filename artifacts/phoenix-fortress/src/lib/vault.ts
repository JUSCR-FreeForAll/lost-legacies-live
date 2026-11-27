import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@workspace/api-client-react';

export const MAX_PAYLOAD_BYTES = 256 * 1024;

export const INTERVAL_OPTIONS: { value: 0 | 60 | 360 | 1440 | 10080; label: string; hint: string }[] = [
  { value: 0, label: 'No expected cadence', hint: 'Never flagged due or overdue' },
  { value: 60, label: 'Expect a push every hour', hint: 'Your scheduler pushes; the vault only tracks due/overdue' },
  { value: 360, label: 'Expect a push every 6 hours', hint: 'Your scheduler pushes; the vault only tracks due/overdue' },
  { value: 1440, label: 'Expect a push every 24 hours', hint: 'Your scheduler pushes; the vault only tracks due/overdue' },
  { value: 10080, label: 'Expect a push every 7 days', hint: 'Your scheduler pushes; the vault only tracks due/overdue' },
];

export function intervalLabel(m: number) {
  return INTERVAL_OPTIONS.find((o) => o.value === m)?.label ?? `Every ${m} min (externally pushed)`;
}

/** Stable idempotency key for one logical write; reused across retries, rotated after success. */
export function useIdempotencyKey() {
  const [key, setKey] = useState(() => crypto.randomUUID());
  const rotate = useCallback(() => setKey(crypto.randomUUID()), []);
  return { key, rotate };
}

export function useInvalidateAll() {
  const qc = useQueryClient();
  const ref = useRef(qc);
  ref.current = qc;
  return useCallback(() => ref.current.invalidateQueries(), []);
}

export type ErrorInfo = { message: string; code?: string; requestId?: string; status?: number };

export function errorInfo(err: unknown): ErrorInfo {
  if (err instanceof ApiError) {
    const d = err.data as { error?: unknown; code?: unknown; requestId?: unknown } | null | undefined;
    const msg = d && typeof d === 'object' && typeof d.error === 'string' ? d.error : err.message || `Request failed (${err.status})`;
    return {
      message: msg,
      code: d && typeof d.code === 'string' ? d.code : undefined,
      requestId: d && typeof d.requestId === 'string' ? d.requestId : undefined,
      status: err.status,
    };
  }
  if (err instanceof Error) return { message: err.message };
  return { message: 'Unknown error' };
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(2)} MiB`;
  return `${(n / 1024 ** 3).toFixed(2)} GiB`;
}

export function fmtDate(s: string | null | undefined) {
  if (!s) return 'None';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function relTime(s: string | null | undefined) {
  if (!s) return '';
  const diff = new Date(s).getTime() - Date.now();
  const abs = Math.abs(diff);
  const units: [number, string][] = [[86400000, 'd'], [3600000, 'h'], [60000, 'm']];
  for (const [ms, u] of units) if (abs >= ms) { const v = Math.round(abs / ms); return diff < 0 ? `${v}${u} ago` : `in ${v}${u}`; }
  return diff < 0 ? 'just now' : 'in <1m';
}

export function shortHash(h: string, n = 10) {
  return h.length > n * 2 ? `${h.slice(0, n)}…${h.slice(-4)}` : h;
}

export const qopts = { retry: 1, refetchOnWindowFocus: false } as const;
