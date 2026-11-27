import { CircleCheck, CircleDashed, CircleX, Clock, ShieldQuestion } from 'lucide-react';
import { useGetDiagnostics, getGetDiagnosticsQueryKey, type Gate, type GateStatus } from '@workspace/api-client-react';
import { ErrorPanel, PageHeader, Panel, Restricted, RowsSkeleton, Tag } from '@/components/kit';
import { JsonView } from '@/components/vault-kit';
import { useIdentity } from '@/components/identity';
import { cn } from '@/lib/utils';
import { fmtDate, qopts, relTime, shortHash } from '@/lib/vault';

const statusTone: Record<GateStatus, 'good' | 'bad' | 'warn' | 'neutral'> = { pass: 'good', fail: 'bad', stale: 'warn', not_run: 'neutral', not_verified: 'warn' };
const statusIcon: Record<GateStatus, typeof CircleCheck> = { pass: CircleCheck, fail: CircleX, stale: Clock, not_run: CircleDashed, not_verified: ShieldQuestion };

export default function DiagnosticsPage() {
  const { isAdmin, isLoading } = useIdentity();
  const dg = useGetDiagnostics({ query: { ...qopts, enabled: isAdmin, queryKey: getGetDiagnosticsQueryKey() } });
  if (isLoading) return <RowsSkeleton />;
  if (!isAdmin) return <><PageHeader eyebrow="Administration" title="Diagnostics" /><Restricted what="Diagnostic evidence" /></>;
  const d = dg.data;

  const phases = new Map<string, Gate[]>();
  d?.gates.forEach((g) => { const a = phases.get(g.phase) ?? []; a.push(g); phases.set(g.phase, a); });
  const t = d?.latestTests ?? null;
  const stale = t ? t.currentSourceHash != null && t.sourceHash !== t.currentSourceHash : false;
  const counts = d ? d.gates.reduce<Record<string, number>>((acc, g) => { acc[g.status] = (acc[g.status] ?? 0) + 1; return acc; }, {}) : {};

  return (
    <>
      <PageHeader eyebrow="Evidence & limits" title="Diagnostics">
        What this deployment can and cannot prove, as reported by the server. The browser infers nothing; a gate without evidence is shown as not run.
      </PageHeader>

      {dg.isLoading ? <RowsSkeleton rows={8} /> : dg.error ? <ErrorPanel error={dg.error} onRetry={() => void dg.refetch()} /> : d && (
        <div className="space-y-6">
          <div className="rise grid gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
            <Stat k="Readiness" v={<Tag tone={d.readiness.status === 'ready' ? 'good' : 'bad'} testId="status-readiness">{d.readiness.status}</Tag>} />
            <Stat k="Publishable" v={<Tag tone={d.publishable ? 'good' : 'warn'} testId="status-publishable">{d.publishable ? 'yes' : 'no'}</Tag>} />
            <Stat k="Production verified" v={<Tag tone={d.productionVerified ? 'good' : 'warn'} testId="status-production">{d.productionVerified ? 'verified' : 'not verified'}</Tag>} />
            <Stat k="Gates" v={<span className="font-mono text-xs">{Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(' · ')}</span>} />
          </div>
          {!d.productionVerified && (
            <p className="rise rounded-md border border-ochre/30 bg-ochre/10 px-4 py-3 text-sm text-foreground/85">
              Production has not been verified. Passing tests here describe a development database and runtime; they are not a claim about a live deployment.
            </p>
          )}

          <div className="grid gap-6 lg:grid-cols-[1fr_1.35fr]">
            <div className="space-y-6">
              <Panel title="Readiness checks" meta={d.readiness.conditions.length ? `${d.readiness.conditions.length} condition(s)` : undefined}>
                <ul className="divide-y divide-border text-sm">
                  {d.readiness.checks.map((c) => (
                    <li key={c.name} className="flex items-start justify-between gap-3 py-2" data-testid={`row-check-${c.name}`}>
                      <div className="min-w-0"><div className="font-mono text-xs">{c.name}</div><div className="text-xs text-muted-foreground">{c.detail}</div></div>
                      <Tag tone={c.ok ? 'good' : 'bad'}>{c.ok ? 'ok' : 'fail'}</Tag>
                    </li>
                  ))}
                </ul>
                {d.readiness.conditions.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{d.readiness.conditions.map((c) => <Tag key={c} tone="bad">{c}</Tag>)}</div>}
              </Panel>
              <Panel title="Runtime">
                <dl className="grid grid-cols-[130px_1fr] gap-y-2.5 text-sm">
                  <dt className="text-muted-foreground">Encryption</dt><dd><Tag tone={d.encryption === 'configured' ? 'good' : 'bad'} testId="text-encryption">{d.encryption.replace('_', ' ')}</Tag></dd>
                  <dt className="text-muted-foreground">Signing key</dt><dd className="break-all font-mono text-xs" data-testid="text-signing-key">{d.signingKey}</dd>
                  <dt className="text-muted-foreground">Session revoker</dt><dd className="font-mono text-xs" data-testid="text-session-revoker">{d.sessionRevoker}</dd>
                </dl>
                <div className="mt-4"><div className="eyebrow mb-1.5">Outbox</div><JsonView value={d.outbox} max="max-h-40" /></div>
              </Panel>
              <Panel title="Latest test run" meta={t ? `${fmtDate(t.ranAt)} (${relTime(t.ranAt)})` : undefined}>
                {!t ? <p className="text-sm text-muted-foreground" data-testid="text-tests-status">Not run. No test evidence is recorded for this build.</p> : (
                  <div className="space-y-3 text-sm">
                    {stale && <p className="rounded border border-ochre/30 bg-ochre/10 px-3 py-2 text-xs text-ochre" data-testid="status-tests-stale">Stale: this run tested source {shortHash(t.sourceHash, 8)}, but the server now runs {shortHash(t.currentSourceHash ?? '', 8)}.</p>}
                    <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs">
                      <span className="text-verdigris" data-testid="text-tests-passed">{t.passed} passed</span>
                      <span className={t.failed ? 'text-destructive' : 'text-muted-foreground'} data-testid="text-tests-failed">{t.failed} failed</span>
                    </div>
                    <dl className="grid grid-cols-[90px_1fr] gap-y-1 font-mono text-[11px] text-muted-foreground">
                      <dt>database</dt><dd className="text-foreground">{t.database}</dd>
                      <dt>runtime</dt><dd className="text-foreground">{t.runtime}</dd>
                      <dt>file</dt><dd className="break-all text-foreground">{t.file}</dd>
                      <dt>source</dt><dd className="break-all text-foreground">{t.sourceHash}</dd>
                    </dl>
                  </div>
                )}
              </Panel>
            </div>

            <div className="space-y-6">
              {[...phases.entries()].map(([phase, gates]) => (
                <Panel key={phase} title={phase} meta={`${gates.filter((g) => g.status === 'pass').length}/${gates.length} pass`}>
                  <ul className="divide-y divide-border">
                    {gates.map((g) => {
                      const Icon = statusIcon[g.status];
                      return (
                        <li key={g.id} className="flex gap-3 py-2.5" data-testid={`row-gate-${g.id}`}>
                          <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', { pass: 'text-verdigris', fail: 'text-destructive', stale: 'text-ochre', not_run: 'text-muted-foreground', not_verified: 'text-ochre' }[g.status])} />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-sm font-medium">{g.title}</span>
                              {g.critical && <Tag tone="seal">critical</Tag>}
                            </div>
                            <p className="mt-0.5 text-xs text-muted-foreground">{g.detail}</p>
                            <div className="mt-1 font-mono text-[10px] text-muted-foreground">{g.id} · source {g.source}</div>
                          </div>
                          <Tag tone={statusTone[g.status]}>{g.status.replace('_', ' ')}</Tag>
                        </li>
                      );
                    })}
                  </ul>
                </Panel>
              ))}
              <Panel title="Known limitations">
                {d.limitations.length ? <ul className="list-disc space-y-1.5 pl-5 text-sm">{d.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul> : <p className="text-sm text-muted-foreground">None reported by the server.</p>}
              </Panel>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Stat({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="bg-card p-4"><div className="eyebrow mb-2">{k}</div>{v}</div>;
}
