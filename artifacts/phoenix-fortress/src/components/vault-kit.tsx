import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { Check, Copy, Download, EyeOff, KeyRound, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { InlineError } from '@/components/kit';
import { cn } from '@/lib/utils';
import { errorInfo } from '@/lib/vault';

export function CopyButton({ value, label = 'Copy', testId, size = 'sm', variant = 'outline' }: { value: string; label?: string; testId?: string; size?: 'sm' | 'default'; variant?: 'outline' | 'ghost' | 'default' }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button type="button" size={size} variant={variant} data-testid={testId}
      onClick={() => { void navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
      {copied ? <Check className="mr-1.5 h-3.5 w-3.5 text-verdigris" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
      {copied ? 'Copied' : label}
    </Button>
  );
}

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function downloadText(name: string, text: string, mime = 'text/plain') {
  downloadBlob(name, new Blob([text], { type: mime }));
}
export const today = () => new Date().toISOString().slice(0, 10);

/** One-time secret display. Values live only in parent state; dismiss clears them. */
export function SecretBox({ title, note, values, onDismiss, dismissLabel = 'I have stored this safely', testId, numbered, filename }: {
  title: string; note: ReactNode; values: string[]; onDismiss: () => void; dismissLabel?: string; testId: string; numbered?: boolean; filename?: string;
}) {
  const text = values.join('\n');
  const print = () => {
    const w = window.open('', '_blank', 'width=600,height=700');
    if (!w) return;
    const doc = w.document;
    doc.title = title;
    const pre = doc.createElement('pre');
    pre.style.font = '14px ui-monospace, monospace';
    pre.textContent = `${title}\n\n${values.map((v, i) => (numbered ? `${String(i + 1).padStart(2, '0')}  ${v}` : v)).join('\n')}`;
    doc.body.appendChild(pre);
    w.print();
  };
  return (
    <div className="rise rounded-md border-2 border-primary/40 bg-primary/[0.04] p-4" data-testid={`secret-${testId}`}>
      <div className="mb-1 flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-primary" />
        <span className="eyebrow !text-primary">Shown once</span>
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{note}</p>
      {numbered ? (
        <ol className="grid grid-cols-1 gap-x-6 gap-y-1 rounded border border-border bg-card p-3 font-mono text-sm sm:grid-cols-2">
          {values.map((v, i) => <li key={v} className="flex gap-3"><span className="text-muted-foreground">{String(i + 1).padStart(2, '0')}</span><span data-testid={`text-${testId}-${i}`}>{v}</span></li>)}
        </ol>
      ) : (
        <code className="block select-all break-all rounded border border-border bg-card p-3 font-mono text-sm" data-testid={`text-${testId}`}>{text}</code>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <CopyButton value={text} label={values.length > 1 ? 'Copy all' : 'Copy'} testId={`button-copy-${testId}`} />
        {filename && <Button type="button" size="sm" variant="outline" onClick={() => downloadText(filename, text + '\n')} data-testid={`button-download-${testId}`}><Download className="mr-1.5 h-3.5 w-3.5" />Save as text</Button>}
        {filename && <Button type="button" size="sm" variant="outline" onClick={print} data-testid={`button-print-${testId}`}><Printer className="mr-1.5 h-3.5 w-3.5" />Print</Button>}
        <Button type="button" size="sm" className="ml-auto" onClick={onDismiss} data-testid={`button-dismiss-${testId}`}><EyeOff className="mr-1.5 h-3.5 w-3.5" />{dismissLabel}</Button>
      </div>
    </div>
  );
}

/** InlineError that recognises CONSENT_REQUIRED and points to the consent registry. */
export function MutationError({ error }: { error: unknown }) {
  if (!error) return null;
  const e = errorInfo(error);
  if (e.code === 'CONSENT_REQUIRED') {
    return (
      <div role="alert" className="rounded border border-ochre/40 bg-ochre/10 px-3 py-2 text-xs text-foreground">
        {e.message} <Link href="/privacy" className="font-medium text-primary underline underline-offset-2" data-testid="link-consent-required">Review consent in Privacy &amp; safety</Link>
        <span className="ml-2 font-mono text-muted-foreground">{e.code}</span>
      </div>
    );
  }
  return <InlineError error={error} />;
}

export function isConsentError(error: unknown) {
  return errorInfo(error).code === 'CONSENT_REQUIRED';
}

export type Parsed = { ok: true; value: Record<string, unknown> } | { ok: false; error: string };
export function parseObject(text: string): Parsed {
  if (!text.trim()) return { ok: false, error: '' };
  try {
    const v: unknown = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'Expected a JSON object { ... }' };
    return { ok: true, value: v as Record<string, unknown> };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid JSON' };
  }
}

export function JsonInput({ value, onChange, placeholder, testId, rows = 7 }: { value: string; onChange: (v: string) => void; placeholder?: string; testId: string; rows?: number }) {
  const p = parseObject(value);
  return (
    <div className="space-y-1">
      <Textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} spellCheck={false}
        className={cn('font-mono text-xs', !p.ok && p.error && 'border-destructive/50')} data-testid={`input-${testId}`} />
      <div className="text-[11px] font-mono">{p.ok ? <span className="text-verdigris">valid JSON object</span> : p.error ? <span className="text-destructive">{p.error}</span> : <span className="text-muted-foreground">paste JSON</span>}</div>
    </div>
  );
}

export function JsonView({ value, max = 'max-h-56' }: { value: unknown; max?: string }) {
  const text = JSON.stringify(value, null, 2);
  return (
    <div className="relative">
      <pre className={cn('overflow-auto rounded border border-border bg-muted/50 p-3 font-mono text-[11px] leading-relaxed', max)}>{text}</pre>
      <div className="absolute right-2 top-2"><CopyButton value={text} label="Copy JSON" variant="outline" /></div>
    </div>
  );
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export function Countdown({ to }: { to: string }) {
  const now = useNow();
  const diff = new Date(to).getTime() - now;
  if (diff <= 0) return <span className="font-mono text-verdigris">ready now</span>;
  const s = Math.floor(diff / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return <span className="font-mono tabular-nums">{d > 0 && `${d}d `}{String(h).padStart(2, '0')}:{String(m).padStart(2, '0')}:{String(sec).padStart(2, '0')}</span>;
}

export function Consequences({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-1.5 text-sm">
      {items.map((it, i) => <li key={i} className="flex gap-2.5"><span className="mt-2 h-1 w-3 shrink-0 bg-primary/60" /><span className="text-foreground/85">{it}</span></li>)}
    </ul>
  );
}
