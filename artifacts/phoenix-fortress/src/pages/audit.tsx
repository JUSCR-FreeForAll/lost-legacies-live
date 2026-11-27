import { useState } from 'react';
import { ChevronRight, ShieldCheck, ShieldX } from 'lucide-react';
import { useListEvents, useVerifyVault, type LedgerBlock } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Empty, ErrorPanel, Hash, InlineError, PageHeader, Panel, RowsSkeleton, Tag } from '@/components/kit';
import { cn } from '@/lib/utils';
import { fmtDate, qopts, useInvalidateAll } from '@/lib/vault';

export default function AuditPage() {
  const ev = useListEvents({ query: { ...qopts } });
  const v = useVerifyVault();
  const invalidate = useInvalidateAll();
  const rows = [...(ev.data ?? [])].sort((a, b) => b.idx - a.idx);

  return (
    <>
      <PageHeader eyebrow="Evidence" title="Audit ledger" actions={
        <Button onClick={() => v.mutate(undefined, { onSuccess: () => void invalidate() })} disabled={v.isPending} data-testid="button-verify-vault">
          <ShieldCheck className="mr-1.5 h-4 w-4" />{v.isPending ? 'Verifying' : 'Verify integrity now'}
        </Button>
      }>
        Every write is appended as a hash-chained event. Integrity is checked only when you ask; until a verification returns, nothing on this page claims the chain is intact.
      </PageHeader>

      <div className="mb-6">
        {v.isPending ? (
          <div className="rise rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">Recomputing hashes across events, backups and stages…</div>
        ) : v.error ? (
          <InlineError error={v.error} />
        ) : v.data ? (
          <div className={cn('rise rounded-md border p-4', v.data.valid ? 'border-verdigris/40 bg-verdigris/5' : 'border-destructive/40 bg-destructive/5')} data-testid="status-verification">
            <div className="flex items-center gap-2 font-medium">
              {v.data.valid ? <ShieldCheck className="h-5 w-5 text-verdigris" /> : <ShieldX className="h-5 w-5 text-destructive" />}
              {v.data.valid ? 'Verification passed at ' : 'Verification FAILED at '}{fmtDate(v.data.verifiedAt)}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs text-muted-foreground">
              <span>height {v.data.ledgerHeight}</span><span>{v.data.backupsChecked} backups</span><span>{v.data.stagesChecked} stages</span><span>{v.data.evidenceChecked} evidence</span><span>{v.data.checkpointsChecked} checkpoints</span>
              <span>tip <Hash value={v.data.tipHash} n={10} /></span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">This result describes the moment it ran. Later writes are not covered until you verify again.</p>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground" data-testid="status-verification">Not verified in this session.</div>
        )}
      </div>

      <Panel title="Events" meta={ev.data ? `${ev.data.length} recorded` : undefined}>
        {ev.isLoading ? <RowsSkeleton rows={8} /> : ev.error ? <ErrorPanel error={ev.error} onRetry={() => void ev.refetch()} /> : !rows.length ? (
          <Empty title="The ledger is empty">Events appear when datasets, backups, recoveries, credentials or members change.</Empty>
        ) : (
          <ol className="relative">{rows.map((e) => <EventRow key={e.idx} e={e} />)}</ol>
        )}
      </Panel>
    </>
  );
}

function EventRow({ e }: { e: LedgerBlock }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-border last:border-0" data-testid={`row-event-${e.idx}`}>
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-muted/40">
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">#{e.idx}</span>
        <Tag tone="seal">{e.eventType}</Tag>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{e.actorId}</span>
        <span className="hidden whitespace-nowrap text-xs text-muted-foreground sm:inline">{fmtDate(e.occurredAt)}</span>
      </button>
      {open && (
        <div className="mb-3 ml-[4.5rem] space-y-2 rounded-md bg-muted/50 p-3 text-xs">
          <div className="flex flex-wrap gap-x-6"><span>hash <Hash value={e.hash} n={16} /></span><span>prev <Hash value={e.prevHash} n={16} /></span></div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px]">{JSON.stringify(e.meta, null, 2)}</pre>
        </div>
      )}
    </li>
  );
}
