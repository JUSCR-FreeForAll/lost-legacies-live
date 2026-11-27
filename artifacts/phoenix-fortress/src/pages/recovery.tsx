import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, ShieldCheck, Undo2 } from 'lucide-react';
import {
  useListBackups, useListStages, useGetStageData, getGetStageDataQueryKey, usePlanRestore, useConfirmRestore, useRollbackStage,
  type RestorePlan, type Stage,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Empty, ErrorPanel, Field, Hash, InlineError, PageHeader, Panel, RowsSkeleton, Tag, selectCls } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { fmtBytes, fmtDate, qopts, relTime, useIdempotencyKey, useInvalidateAll } from '@/lib/vault';

export default function RecoveryPage() {
  const [plan, setPlan] = useState<RestorePlan | null>(null);
  const step = plan ? 2 : 1;
  return (
    <>
      <PageHeader eyebrow="Recovery" title="Stage a restore, never overwrite">
        Recovery is a three-step procedure: a dry-run plan, a typed confirmation, then a new staging copy you can export or roll back. Source systems are never touched and nothing is promoted automatically.
      </PageHeader>
      <ol className="rise mb-6 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-border bg-border text-xs">
        {['Dry-run plan', 'Typed confirmation', 'Staged copy'].map((s, i) => (
          <li key={s} className={cn('bg-card px-4 py-3', step === i + 1 && 'bg-primary/5')}>
            <span className={cn('font-mono', step === i + 1 ? 'text-primary' : 'text-muted-foreground')}>0{i + 1}</span> <span className={step === i + 1 ? 'font-medium' : 'text-muted-foreground'}>{s}</span>
          </li>
        ))}
      </ol>
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        {plan ? <ConfirmPanel plan={plan} onDone={() => setPlan(null)} /> : <PlanPanel onPlanned={setPlan} />}
        <StagesPanel />
      </div>
    </>
  );
}

function PlanPanel({ onPlanned }: { onPlanned: (p: RestorePlan) => void }) {
  const bk = useListBackups({ query: { ...qopts } });
  const [backupId, setBackupId] = useState('');
  const [target, setTarget] = useState('');
  const idem = useIdempotencyKey();
  const m = usePlanRestore();
  const retained = (bk.data ?? []).filter((b) => b.status === 'retained').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const targetOk = /^[a-zA-Z0-9_-]{3,60}$/.test(target);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate({ data: { backupId, target, idempotencyKey: idem.key } }, { onSuccess: (p) => { idem.rotate(); onPlanned(p); } });
  };

  return (
    <Panel title="01 · Request a dry-run plan">
      {bk.isLoading ? <RowsSkeleton rows={3} /> : bk.error ? <ErrorPanel error={bk.error} onRetry={() => void bk.refetch()} /> : !retained.length ? (
        <Empty title="No retained backups">Only backups whose payload is still retained can be staged.</Empty>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Backup" htmlFor="r-b">
            <select id="r-b" className={selectCls} value={backupId} onChange={(e) => setBackupId(e.target.value)} data-testid="select-restore-backup">
              <option value="">Choose a retained backup</option>
              {retained.map((b) => <option key={b.id} value={b.id}>{b.datasetName} v{b.version} · {fmtDate(b.createdAt)} · {fmtBytes(b.bytes)}</option>)}
            </select>
          </Field>
          <Field label="New staging label" htmlFor="r-t" hint="3–60 letters, digits, dash or underscore. A fresh staging area; existing data is not overwritten.">
            <Input id="r-t" value={target} onChange={(e) => setTarget(e.target.value)} className="font-mono" placeholder="restore-check-1" data-testid="input-restore-target" />
          </Field>
          <InlineError error={m.error} />
          <Button type="submit" className="w-full" disabled={!backupId || !targetOk || m.isPending} data-testid="button-plan-restore">{m.isPending ? 'Planning' : 'Create dry-run plan'}</Button>
        </form>
      )}
    </Panel>
  );
}

function ConfirmPanel({ plan, onDone }: { plan: RestorePlan; onDone: () => void }) {
  const [typed, setTyped] = useState('');
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const { toast } = useToast();
  const m = useConfirmRestore();
  const matches = typed === plan.confirmation;
  const expired = new Date(plan.expiresAt).getTime() < Date.now();

  const confirm = (e: FormEvent) => {
    e.preventDefault();
    if (!matches) return;
    m.mutate({ data: { planId: plan.id, confirmation: typed, idempotencyKey: idem.key } }, {
      onSuccess: (s) => { idem.rotate(); void invalidate(); toast({ title: 'Staged copy created', description: `${s.target} · checksum ${s.checksum.slice(0, 12)}…` }); onDone(); },
    });
  };

  return (
    <Panel title="02 · Review and confirm" meta={plan.dryRun ? <Tag tone="seal">dry run</Tag> : undefined}>
      <dl className="mb-5 grid grid-cols-[110px_1fr] gap-y-2 text-sm">
        <dt className="text-muted-foreground">Plan</dt><dd className="font-mono text-xs">{plan.id}</dd>
        <dt className="text-muted-foreground">Backup</dt><dd className="font-mono text-xs">{plan.backupId}</dd>
        <dt className="text-muted-foreground">Target</dt><dd className="font-mono text-xs">{plan.target}</dd>
        <dt className="text-muted-foreground">Checksum</dt><dd><Hash value={plan.checksum} n={14} /></dd>
        <dt className="text-muted-foreground">Size</dt><dd className="font-mono text-xs">{fmtBytes(plan.bytes)}</dd>
        <dt className="text-muted-foreground">Plan expires</dt><dd className={cn('text-xs', expired && 'text-destructive')}>{fmtDate(plan.expiresAt)} ({relTime(plan.expiresAt)})</dd>
      </dl>
      <form onSubmit={confirm} className="space-y-3">
        <div className="rounded-md border border-primary/25 bg-primary/5 p-3">
          <div className="eyebrow mb-1">Type this phrase exactly</div>
          <code className="select-none break-all font-mono text-sm text-primary" data-testid="text-confirmation-phrase">{plan.confirmation}</code>
        </div>
        <Input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onPaste={(e) => e.preventDefault()}
          autoComplete="off"
          spellCheck={false}
          className={cn('font-mono', typed && (matches ? 'border-verdigris' : 'border-ochre'))}
          placeholder="Type the confirmation phrase"
          data-testid="input-confirmation"
        />
        {expired && <p className="text-xs text-destructive">This plan has expired. Start over to request a fresh one.</p>}
        <InlineError error={m.error} />
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onDone} data-testid="button-cancel-plan">Discard plan</Button>
          <Button type="submit" className="flex-1" disabled={!matches || expired || m.isPending} data-testid="button-confirm-restore"><ShieldCheck className="mr-1.5 h-4 w-4" />{m.isPending ? 'Staging' : 'Confirm and stage'}</Button>
        </div>
      </form>
    </Panel>
  );
}

function StagesPanel() {
  const st = useListStages({ query: { ...qopts } });
  const rows = [...(st.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <Panel title="03 · Staged copies">
      {st.isLoading ? <RowsSkeleton /> : st.error ? <ErrorPanel error={st.error} onRetry={() => void st.refetch()} /> : !rows.length ? (
        <Empty title="No staged recoveries">Confirmed plans create isolated staging copies listed here.</Empty>
      ) : (
        <ul className="divide-y divide-border">{rows.map((s) => <StageRow key={s.id} stage={s} />)}</ul>
      )}
    </Panel>
  );
}

function StageRow({ stage }: { stage: Stage }) {
  const qc = useQueryClient();
  const [requested, setRequested] = useState(false);
  const [rbOpen, setRbOpen] = useState(false);
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const { toast } = useToast();
  const rb = useRollbackStage();
  const key = getGetStageDataQueryKey(stage.id);
  const ex = useGetStageData(stage.id, { query: { queryKey: key, enabled: requested, retry: 0, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false } });
  const handled = useRef(false);

  useEffect(() => {
    if (!requested || !ex.data || handled.current) return;
    handled.current = true;
    const blob = new Blob([JSON.stringify(ex.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${stage.target}-${stage.id}.json`; a.click();
    URL.revokeObjectURL(url);
    setRequested(false);
    qc.removeQueries({ queryKey: key });
  }, [requested, ex.data, stage.id, stage.target, qc, key]);

  return (
    <li className="py-3" data-testid={`row-stage-${stage.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-sm">{stage.target}</div>
          <div className="text-xs text-muted-foreground">{fmtDate(stage.createdAt)} · backup <span className="font-mono">{stage.backupId.slice(0, 8)}</span> · <Hash value={stage.checksum} n={6} /></div>
        </div>
        <div className="flex items-center gap-1.5">
          <Tag tone={stage.status === 'staged' ? 'good' : 'neutral'}>{stage.status.replace('_', ' ')}</Tag>
          {stage.status === 'staged' && (
            <>
              <Button size="sm" variant="outline" disabled={requested && ex.isFetching} onClick={() => { handled.current = false; setRequested(true); if (ex.error) void ex.refetch(); }} data-testid={`button-export-${stage.id}`}>
                <Download className="mr-1 h-3.5 w-3.5" />{requested && ex.isFetching ? 'Exporting' : 'Export JSON'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRbOpen(true)} data-testid={`button-rollback-${stage.id}`}><Undo2 className="mr-1 h-3.5 w-3.5" />Roll back</Button>
            </>
          )}
        </div>
      </div>
      {requested && ex.error && <div className="mt-2"><InlineError error={ex.error} /></div>}
      <AlertDialog open={rbOpen} onOpenChange={setRbOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display font-medium">Roll back staging copy {stage.target}?</AlertDialogTitle>
            <AlertDialogDescription>The staged copy is discarded. The original backup and its manifest stay intact, and the action is written to the ledger.</AlertDialogDescription>
          </AlertDialogHeader>
          <InlineError error={rb.error} />
          <AlertDialogFooter>
            <AlertDialogCancel>Keep staged</AlertDialogCancel>
            <AlertDialogAction disabled={rb.isPending} data-testid={`button-confirm-rollback-${stage.id}`} onClick={(e) => {
              e.preventDefault();
              rb.mutate({ id: stage.id, data: { idempotencyKey: idem.key } }, { onSuccess: () => { idem.rotate(); void invalidate(); setRbOpen(false); toast({ title: 'Staging rolled back', description: stage.target }); } });
            }}>{rb.isPending ? 'Rolling back' : 'Roll back'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
