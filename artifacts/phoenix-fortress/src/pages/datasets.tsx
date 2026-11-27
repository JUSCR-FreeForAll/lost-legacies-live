import { useState, type FormEvent } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { useListDatasets, useRegisterDataset, useUpdatePolicy, type Dataset } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Empty, ErrorPanel, Field, InlineError, PageHeader, Panel, RowsSkeleton, Tag, selectCls } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';
import { INTERVAL_OPTIONS, fmtDate, intervalLabel, qopts, relTime, useIdempotencyKey, useInvalidateAll } from '@/lib/vault';

type IntervalV = 0 | 60 | 360 | 1440 | 10080;

function IntervalSelect({ value, onChange, id }: { value: IntervalV; onChange: (v: IntervalV) => void; id: string }) {
  return (
    <>
      <select id={id} data-testid={`select-${id}`} className={selectCls} value={value} onChange={(e) => onChange(Number(e.target.value) as IntervalV)}>
        {INTERVAL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </>
  );
}
const scheduleHint = 'This server runs no scheduler. Your external application must push fresh data; the interval only marks the dataset due or overdue.';

export default function DatasetsPage() {
  const ds = useListDatasets({ query: { ...qopts } });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Dataset | null>(null);

  return (
    <>
      <PageHeader eyebrow="Registry" title="Datasets" actions={<Button onClick={() => setCreating(true)} data-testid="button-register-dataset"><Plus className="mr-1.5 h-4 w-4" />Register dataset</Button>}>
        A dataset is a logical, user-owned JSON source. The vault never fetches from it; your application pushes snapshots of up to 256 KiB.
      </PageHeader>
      <Panel title="Registered sources" meta={ds.data ? `${ds.data.length} total` : undefined}>
        {ds.isLoading ? <RowsSkeleton /> : ds.error ? <ErrorPanel error={ds.error} onRetry={() => void ds.refetch()} /> : !ds.data?.length ? (
          <Empty title="Nothing registered" action={<Button size="sm" onClick={() => setCreating(true)}>Register the first dataset</Button>}>You must confirm ownership of each source.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="eyebrow text-left [&>th]:pb-2 [&>th]:pr-4 [&>th]:font-normal"><th>Name</th><th>Source</th><th>Retention</th><th>Expected push</th><th>Next due</th><th>Policy v</th><th /></tr></thead>
              <tbody className="divide-y divide-border">
                {ds.data.map((d) => {
                  const overdue = d.nextDueAt && new Date(d.nextDueAt).getTime() < Date.now();
                  return (
                    <tr key={d.id} className="[&>td]:py-2.5 [&>td]:pr-4" data-testid={`row-dataset-${d.id}`}>
                      <td className="font-medium">{d.name}<div className="font-mono text-[10px] text-muted-foreground">{d.id}</div></td>
                      <td className="max-w-[200px] truncate font-mono text-xs">{d.source}</td>
                      <td>{d.retentionDays} d</td>
                      <td className="text-xs">{intervalLabel(d.intervalMinutes)}</td>
                      <td>{d.nextDueAt == null ? <Tag>untracked</Tag> : overdue ? <Tag tone="warn">overdue</Tag> : <span className="text-xs" title={fmtDate(d.nextDueAt)}>{relTime(d.nextDueAt)}</span>}</td>
                      <td className="font-mono text-xs">{d.version}</td>
                      <td><Button size="sm" variant="ghost" onClick={() => setEditing(d)} data-testid={`button-edit-policy-${d.id}`}><Pencil className="mr-1 h-3.5 w-3.5" />Policy</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <RegisterDialog open={creating} onOpenChange={setCreating} />
      {editing && <PolicyDialog key={editing.id} dataset={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function RegisterDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [name, setName] = useState('');
  const [source, setSource] = useState('');
  const [retention, setRetention] = useState('30');
  const [interval, setInterval] = useState<IntervalV>(1440);
  const [owned, setOwned] = useState(false);
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const { toast } = useToast();
  const m = useRegisterDataset();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate(
      { data: { name: name.trim(), source: source.trim(), retentionDays: Number(retention), intervalMinutes: interval, ownershipConfirmed: owned, idempotencyKey: idem.key } },
      {
        onSuccess: (d) => {
          idem.rotate(); void invalidate();
          toast({ title: 'Dataset registered', description: d.name });
          setName(''); setSource(''); setOwned(false); m.reset(); onOpenChange(false);
        },
      },
    );
  };
  const r = Number(retention);
  const valid = name.trim() && source.trim() && owned && r >= 1 && r <= 365 && Number.isInteger(r);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="font-display text-xl font-medium">Register a dataset</DialogTitle><DialogDescription>Only sources you own. The vault stores what you push, nothing more.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Name" htmlFor="ds-name"><Input id="ds-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} data-testid="input-dataset-name" /></Field>
          <Field label="Source identifier" htmlFor="ds-source" hint="A logical label for your application data, e.g. billing-service/settings. Never fetched."><Input id="ds-source" maxLength={120} value={source} onChange={(e) => setSource(e.target.value)} data-testid="input-dataset-source" /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Retention (days, 1–365)" htmlFor="ds-ret"><Input id="ds-ret" type="number" min={1} max={365} value={retention} onChange={(e) => setRetention(e.target.value)} data-testid="input-dataset-retention" /></Field>
            <Field label="Expected external push" htmlFor="ds-interval"><IntervalSelect id="ds-interval" value={interval} onChange={setInterval} /></Field>
          </div>
          <p className="text-[11px] text-muted-foreground">{scheduleHint}</p>
          <label className="flex items-start gap-2.5 rounded-md border border-border bg-muted/50 p-3 text-sm">
            <input type="checkbox" checked={owned} onChange={(e) => setOwned(e.target.checked)} className="mt-0.5 accent-[hsl(var(--primary))]" data-testid="checkbox-ownership" />
            <span>I confirm this source is application data I own or am authorized to back up.</span>
          </label>
          <InlineError error={m.error} />
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={!valid || m.isPending} data-testid="button-submit-dataset">{m.isPending ? 'Registering' : m.error ? 'Retry registration' : 'Register'}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PolicyDialog({ dataset, onClose }: { dataset: Dataset; onClose: () => void }) {
  const [retention, setRetention] = useState(String(dataset.retentionDays));
  const [interval, setInterval] = useState<IntervalV>((INTERVAL_OPTIONS.some((o) => o.value === dataset.intervalMinutes) ? dataset.intervalMinutes : 0) as IntervalV);
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const { toast } = useToast();
  const m = useUpdatePolicy();
  const r = Number(retention);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate(
      { id: dataset.id, data: { retentionDays: r, intervalMinutes: interval, idempotencyKey: idem.key } },
      { onSuccess: (d) => { idem.rotate(); void invalidate(); toast({ title: 'Policy updated', description: `${d.name} now at policy v${d.version}` }); onClose(); } },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="font-display text-xl font-medium">Policy for {dataset.name}</DialogTitle><DialogDescription>Current policy version {dataset.version}. Changes are recorded in the audit ledger.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Retention (days, 1–365)" htmlFor="p-ret" hint="Applied when new backups arrive or an administrator runs a retention sweep. Manifest metadata is kept."><Input id="p-ret" type="number" min={1} max={365} value={retention} onChange={(e) => setRetention(e.target.value)} data-testid="input-policy-retention" /></Field>
          <Field label="Expected external push" htmlFor="p-int" hint={scheduleHint}><IntervalSelect id="p-int" value={interval} onChange={setInterval} /></Field>
          <InlineError error={m.error} />
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={!(r >= 1 && r <= 365 && Number.isInteger(r)) || m.isPending} data-testid="button-save-policy">{m.isPending ? 'Saving' : 'Save policy'}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
