import { Link } from 'wouter';
import { ArrowRight, Bell, ShieldAlert, TriangleAlert } from 'lucide-react';
import { useIdentity } from '@/components/identity';
import { useGetOverview, useListDatasets, useListBackups } from '@workspace/api-client-react';
import { Empty, ErrorPanel, Hash, PageHeader, Panel, RowsSkeleton, Tag } from '@/components/kit';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { fmtBytes, fmtDate, intervalLabel, qopts, relTime } from '@/lib/vault';

export default function OverviewPage() {
  const ov = useGetOverview({ query: { ...qopts } });
  const ds = useListDatasets({ query: { ...qopts } });
  const bk = useListBackups({ query: { ...qopts } });
  const o = ov.data;
  const { identity } = useIdentity();
  const safe = identity?.safeMode ?? false;

  const stats = o
    ? [
        { k: 'Datasets', v: o.datasets, id: 'datasets' },
        { k: 'Backups', v: o.backups, id: 'backups' },
        { k: 'Retained bytes', v: fmtBytes(o.retainedBytes), id: 'bytes' },
        { k: 'Staged recoveries', v: o.stagedRecoveries, id: 'stages' },
        { k: 'Overdue datasets', v: o.overdueDatasets, id: 'overdue', warn: o.overdueDatasets > 0 },
        { k: 'Ledger height', v: o.ledgerHeight, id: 'ledger' },
      ]
    : [];

  return (
    <>
      <PageHeader eyebrow="Inventory" title="What the vault holds right now">
        Counts come straight from the server for the selected tenant. Integrity is not implied here; run a verification from the audit ledger when you need proof.
      </PageHeader>

      {identity?.recoveryRequired && (
        <div role="alert" className="rise mb-6 flex items-start gap-3 rounded-md border-2 border-destructive/40 bg-destructive/5 p-4" data-testid="status-recovery-required">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div className="flex-1 text-sm">
            <div className="font-semibold text-destructive">RECOVERY_REQUIRED: writes are paused</div>
            <p className="mt-1 text-foreground/80">The server found an integrity condition it will not paper over. Review what it detected and resolve it deliberately before continuing.</p>
          </div>
          <Button asChild size="sm" variant="outline"><Link href="/resilience" data-testid="link-resolve-integrity">Review conditions</Link></Button>
        </div>
      )}
      {o && (o.openConditions > 0 || (!safe && o.unreadNotifications > 0)) && (
        <div className="rise mb-6 flex flex-wrap gap-3">
          {o.openConditions > 0 && (
            <Link href="/resilience" className="flex items-center gap-2 rounded-md border border-ochre/40 bg-ochre/10 px-3 py-2 text-sm hover:bg-ochre/15" data-testid="link-open-conditions">
              <TriangleAlert className="h-4 w-4 text-ochre" /><span><b className="font-mono">{o.openConditions}</b> open integrity condition{o.openConditions === 1 ? '' : 's'}</span><ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            </Link>
          )}
          {!safe && o.unreadNotifications > 0 && (
            <Link href="/privacy" className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-muted" data-testid="link-unread-notifications">
              <Bell className="h-4 w-4 text-primary" /><span><b className="font-mono">{o.unreadNotifications}</b> unread notice{o.unreadNotifications === 1 ? '' : 's'}</span><ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            </Link>
          )}
        </div>
      )}

      {ov.isLoading ? (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="bg-card p-5"><Skeleton className="mb-2 h-3 w-20" /><Skeleton className="h-8 w-16" /></div>)}
        </div>
      ) : ov.error ? (
        <ErrorPanel error={ov.error} onRetry={() => void ov.refetch()} />
      ) : (
        <div className="rise grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border md:grid-cols-3">
          {stats.map((s) => (
            <div key={s.id} className="bg-card p-5">
              <div className="eyebrow">{s.k}</div>
              <div className={`mt-2 font-display text-3xl ${s.warn ? 'text-ochre' : ''}`} data-testid={`text-stat-${s.id}`}>{s.v}</div>
            </div>
          ))}
          <div className="col-span-2 bg-card px-5 py-3 text-xs text-muted-foreground md:col-span-3">
            Last backup received: <span className="font-mono text-foreground" data-testid="text-last-backup">{o?.lastBackupAt ? `${fmtDate(o.lastBackupAt)} (${relTime(o.lastBackupAt)})` : 'none yet'}</span>
          </div>
        </div>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Panel title="Push cadence" meta="Tracked only. Your scheduler sends the data.">
          {ds.isLoading ? <RowsSkeleton /> : ds.error ? <ErrorPanel error={ds.error} onRetry={() => void ds.refetch()} /> : !ds.data?.length ? (
            <Empty title="No datasets registered" action={<Button asChild size="sm"><Link href="/datasets">Register a dataset</Link></Button>}>
              Register a user-owned JSON source before pushing backups.
            </Empty>
          ) : (
            <ul className="divide-y divide-border">
              {ds.data.map((d) => {
                const overdue = d.nextDueAt && new Date(d.nextDueAt).getTime() < Date.now();
                return (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-2.5" data-testid={`row-dataset-${d.id}`}>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{d.name}</div>
                      <div className="text-xs text-muted-foreground">{intervalLabel(d.intervalMinutes)}</div>
                    </div>
                    {d.nextDueAt == null ? <Tag>untracked</Tag> : overdue ? <Tag tone="warn">overdue {relTime(d.nextDueAt)}</Tag> : <Tag tone="good">due {relTime(d.nextDueAt)}</Tag>}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        <Panel title="Recent manifests" meta={<Link href="/backups" className="inline-flex items-center gap-1 hover:text-foreground">All <ArrowRight className="h-3 w-3" /></Link>}>
          {bk.isLoading ? <RowsSkeleton /> : bk.error ? <ErrorPanel error={bk.error} onRetry={() => void bk.refetch()} /> : !bk.data?.length ? (
            <Empty title="No backups yet">Backups appear after your application pushes JSON to the vault.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {[...bk.data].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6).map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="truncate">{b.datasetName} <span className="font-mono text-xs text-muted-foreground">v{b.version}</span></div>
                    <Hash value={b.checksum} n={8} />
                  </div>
                  <span className="text-xs text-muted-foreground">{relTime(b.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
