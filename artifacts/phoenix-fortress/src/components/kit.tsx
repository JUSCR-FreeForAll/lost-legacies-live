import { useState, type ReactNode } from 'react';
import { AlertTriangle, Check, Copy, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { errorInfo, shortHash } from '@/lib/vault';

export function PageHeader({ eyebrow, title, children, actions }: { eyebrow: string; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="rise mb-8 flex flex-col gap-4 border-b border-border pb-6 md:flex-row md:items-end md:justify-between">
      <div className="max-w-2xl">
        <div className="eyebrow mb-2">{eyebrow}</div>
        <h1 className="font-display text-3xl font-medium md:text-4xl" data-testid="text-page-title">{title}</h1>
        {children && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{children}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({ title, meta, children, className }: { title?: ReactNode; meta?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rise rounded-md border border-card-border bg-card shadow-xs', className)}>
      {title && (
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {meta && <div className="text-xs text-muted-foreground">{meta}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function ErrorPanel({ error, onRetry, label = 'Request failed' }: { error: unknown; onRetry?: () => void; label?: string }) {
  const e = errorInfo(error);
  return (
    <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm" data-testid="status-error">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-destructive">{label}</div>
          <div className="mt-1 break-words text-foreground/80">{e.message}</div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
            {e.status !== undefined && <span>HTTP {e.status}</span>}
            {e.code && <span>code {e.code}</span>}
            {e.requestId && <span>request {e.requestId}</span>}
          </div>
        </div>
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry} data-testid="button-retry">
            <RotateCw className="mr-1.5 h-3.5 w-3.5" /> Retry
          </Button>
        )}
      </div>
    </div>
  );
}

export function InlineError({ error }: { error: unknown }) {
  if (!error) return null;
  const e = errorInfo(error);
  return (
    <p className="rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">
      {e.message}
      {(e.code || e.requestId) && <span className="ml-2 font-mono text-muted-foreground">{[e.code, e.requestId].filter(Boolean).join(' / ')}</span>}
    </p>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="ledger-rule rounded-md border border-dashed border-border px-6 py-10 text-center" data-testid="status-empty">
      <div className="mx-auto mb-3 h-px w-10 bg-primary/60" />
      <div className="font-display text-lg">{title}</div>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function RowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
    </div>
  );
}

export function Hash({ value, n = 10, testId }: { value: string; n?: number; testId?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={value}
      data-testid={testId}
      onClick={() => { void navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
      className="group inline-flex items-center gap-1 rounded px-1 font-mono text-xs text-foreground/80 hover:bg-muted"
    >
      {shortHash(value, n)}
      {copied ? <Check className="h-3 w-3 text-verdigris" /> : <Copy className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />}
    </button>
  );
}

const tones = {
  neutral: 'border-border bg-muted text-muted-foreground',
  good: 'border-verdigris/30 bg-verdigris/10 text-verdigris',
  warn: 'border-ochre/30 bg-ochre/10 text-ochre',
  bad: 'border-destructive/30 bg-destructive/10 text-destructive',
  seal: 'border-primary/30 bg-primary/10 text-primary',
};
export function Tag({ tone = 'neutral', children, testId }: { tone?: keyof typeof tones; children: ReactNode; testId?: string }) {
  return <span data-testid={testId} className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-wider', tones[tone])}>{children}</span>;
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium">{label}</label>
      {children}
      {hint && <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

export const selectCls = 'h-9 w-full rounded-md border border-input bg-card px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40';

export function Restricted({ what }: { what: string }) {
  return <Empty title="Administrator access required">{what} is limited to the tenant administrator. Your role is assigned by the server and cannot be changed here.</Empty>;
}
