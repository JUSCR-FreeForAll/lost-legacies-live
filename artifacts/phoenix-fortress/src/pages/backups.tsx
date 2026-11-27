import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'wouter';
import { Upload, Trash2, FileDown } from 'lucide-react';
import { downloadText } from '@/components/vault-kit';
import { useListBackups, useListDatasets, useCreateBackup, useApplyRetention, createEncryptedExport, issueCredential, revokeCredential } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Empty, ErrorPanel, Field, Hash, InlineError, PageHeader, Panel, RowsSkeleton, Tag, selectCls } from '@/components/kit';
import { useIdentity } from '@/components/identity';
import { useToast } from '@/hooks/use-toast';
import { MAX_PAYLOAD_BYTES, fmtBytes, fmtDate, qopts, useIdempotencyKey, useInvalidateAll } from '@/lib/vault';

export default function BackupsPage() {
  const bk = useListBackups({ query: { ...qopts } });
  const ds = useListDatasets({ query: { ...qopts } });
  const { isAdmin } = useIdentity();
  const [filter, setFilter] = useState('');
  const rows = useMemo(() => [...(bk.data ?? [])].filter((b) => !filter || b.datasetId === filter).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [bk.data, filter]);

  return (
    <>
      <PageHeader eyebrow="Intake & manifests" title="Backups" actions={isAdmin ? <RetentionSweep /> : undefined}>
        Submit a JSON snapshot manually or let your application push through a scoped credential. Each accepted payload gets a checksum and a manifest version.
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <SubmitPanel />
        <Panel title="Manifests" meta={
          <select className={`${selectCls} h-7 w-44 text-xs`} value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="select-filter-dataset">
            <option value="">All datasets</option>
            {ds.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        }>
          {bk.isLoading ? <RowsSkeleton rows={6} /> : bk.error ? <ErrorPanel error={bk.error} onRetry={() => void bk.refetch()} /> : !rows.length ? (
            <Empty title={filter ? 'No backups for this dataset' : 'No backups recorded'}>Nothing has been pushed yet. The list fills only from real submissions.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="eyebrow text-left [&>th]:pb-2 [&>th]:pr-3 [&>th]:font-normal"><th>Dataset</th><th>Ver</th><th>Checksum</th><th>Size</th><th>Created</th><th>Expires</th><th>Status</th><th /></tr></thead>
                <tbody className="divide-y divide-border">
                  {rows.map((b) => (
                    <tr key={b.id} className="[&>td]:py-2 [&>td]:pr-3" data-testid={`row-backup-${b.id}`}>
                      <td className="max-w-[140px] truncate">{b.datasetName}</td>
                      <td className="font-mono text-xs">v{b.version}<span className="text-muted-foreground">/m{b.manifestVersion}</span></td>
                      <td><Hash value={b.checksum} n={7} /></td>
                      <td className="font-mono text-xs">{fmtBytes(b.bytes)}</td>
                      <td className="whitespace-nowrap text-xs">{fmtDate(b.createdAt)}</td>
                      <td className="whitespace-nowrap text-xs">{fmtDate(b.expiresAt)}</td>
                      <td><Tag tone={b.status === 'retained' ? 'good' : b.status === 'expired' ? 'warn' : 'neutral'}>{b.status}</Tag></td>
                      <td>{b.status === 'retained' && <ExportButton id={b.id} datasetId={b.datasetId} name={b.datasetName} version={b.version} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

function SubmitPanel() {
  const ds = useListDatasets({ query: { ...qopts } });
  const [datasetId, setDatasetId] = useState('');
  const [text, setText] = useState('');
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const { toast } = useToast();
  const m = useCreateBackup();

  const parsed = useMemo(() => {
    if (!text.trim()) return { ok: false as const, msg: 'Paste or load a JSON document.' };
    try {
      const value: unknown = JSON.parse(text);
      const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
      if (bytes > MAX_PAYLOAD_BYTES) return { ok: false as const, msg: `Payload is ${fmtBytes(bytes)}; the limit is 256 KiB.`, bytes };
      return { ok: true as const, value, bytes };
    } catch (e) {
      return { ok: false as const, msg: `Invalid JSON: ${(e as Error).message}` };
    }
  }, [text]);

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_PAYLOAD_BYTES * 2) { toast({ title: 'File too large', description: 'Limit is 256 KiB of JSON.', variant: 'destructive' }); return; }
    void f.text().then((t) => { setText(t); idem.rotate(); });
    e.target.value = '';
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!parsed.ok || !datasetId) return;
    m.mutate({ data: { datasetId, data: parsed.value, idempotencyKey: idem.key } }, {
      onSuccess: (b) => { idem.rotate(); void invalidate(); setText(''); m.reset(); toast({ title: `Backup v${b.version} accepted`, description: `${fmtBytes(b.bytes)} · checksum ${b.checksum.slice(0, 12)}…` }); },
    });
  };

  return (
    <Panel title="Submit JSON snapshot" meta="max 256 KiB">
      {ds.isLoading ? <RowsSkeleton rows={3} /> : ds.error ? <ErrorPanel error={ds.error} onRetry={() => void ds.refetch()} /> : !ds.data?.length ? (
        <Empty title="Register a dataset first" action={<Button asChild size="sm"><Link href="/datasets">Go to datasets</Link></Button>}>Backups must belong to a registered, owned dataset.</Empty>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Dataset" htmlFor="b-ds">
            <select id="b-ds" className={selectCls} value={datasetId} onChange={(e) => { setDatasetId(e.target.value); idem.rotate(); }} data-testid="select-backup-dataset">
              <option value="">Choose a dataset</option>
              {ds.data.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="JSON payload" htmlFor="b-json" hint="Held in memory only until submitted. Not saved in the browser.">
            <Textarea id="b-json" rows={12} spellCheck={false} value={text} onChange={(e) => { setText(e.target.value); }} className="font-mono text-xs" placeholder='{"settings": {...}}' data-testid="input-backup-json" />
          </Field>
          <div className="flex items-center justify-between text-xs">
            <span className={parsed.ok ? 'text-verdigris' : 'text-muted-foreground'} data-testid="text-payload-status">{parsed.ok ? `Valid JSON · ${fmtBytes(parsed.bytes)}` : parsed.msg}</span>
            <label className="inline-flex cursor-pointer items-center gap-1 rounded px-2 py-1 hover:bg-muted">
              <Upload className="h-3.5 w-3.5" /> Load .json
              <input type="file" accept="application/json,.json" className="hidden" onChange={onFile} data-testid="input-backup-file" />
            </label>
          </div>
          <InlineError error={m.error} />
          <Button type="submit" className="w-full" disabled={!parsed.ok || !datasetId || m.isPending} data-testid="button-submit-backup">
            {m.isPending ? 'Submitting' : m.error ? 'Retry with same idempotency key' : 'Submit backup'}
          </Button>
        </form>
      )}
    </Panel>
  );
}

function RetentionSweep() {
  const [open, setOpen] = useState(false);
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const { toast } = useToast();
  const m = useApplyRetention();
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} data-testid="button-retention-sweep"><Trash2 className="mr-1.5 h-4 w-4" />Retention sweep</Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display font-medium">Purge expired payloads?</AlertDialogTitle>
            <AlertDialogDescription>Payloads past their dataset's retention window are deleted. Manifest metadata and ledger entries stay. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <InlineError error={m.error} />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-retention"
              disabled={m.isPending}
              onClick={(e) => {
                e.preventDefault();
                m.mutate({ data: { idempotencyKey: idem.key } }, { onSuccess: (r) => { idem.rotate(); void invalidate(); setOpen(false); m.reset(); toast({ title: 'Retention sweep complete', description: `${r.purged} payload${r.purged === 1 ? '' : 's'} purged` }); } });
              }}
            >{m.isPending ? 'Sweeping' : 'Run sweep'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * The export endpoint only accepts a dataset-scoped export credential, never
 * a user session. Issue a 5-minute credential, use it once, then revoke it.
 */
function ExportButton({ id, datasetId, name, version }: { id: string; datasetId: string; name: string; version: number }) {
  const { toast } = useToast();
  const invalidate = useInvalidateAll();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    let credentialId: string | null = null;
    try {
      const cred = await issueCredential({
        name: `browser export v${version}`.slice(0, 60), datasetId, kind: 'export', expiresInMinutes: 5, idempotencyKey: crypto.randomUUID(),
      });
      credentialId = cred.credential.id;
      if (!cred.token) throw new Error('No export credential was issued.');
      const r = await createEncryptedExport({ backupId: id }, { headers: { Authorization: `Bearer ${cred.token}` } });
      downloadText(`${name.replace(/[^A-Za-z0-9_.-]+/g, '-')}-v${version}.encrypted.json`, JSON.stringify(r, null, 2), 'application/json');
    } catch (e) {
      toast({ title: 'Export failed', description: e instanceof Error ? e.message : 'Request failed', variant: 'destructive' });
    } finally {
      if (credentialId) {
        await revokeCredential(credentialId, { idempotencyKey: crypto.randomUUID() }).catch(() => {
          toast({ title: 'Export credential still active', description: 'It expires on its own within 5 minutes. You can revoke it on the Credentials page.' });
        });
      }
      setBusy(false);
      void invalidate();
    }
  };
  return (
    <Button size="sm" variant="ghost" disabled={busy} title="Download as encrypted JSON" aria-label={`Export ${name} version ${version} as encrypted JSON`} data-testid={`button-export-${id}`}
      onClick={() => void run()}>
      <FileDown className="h-4 w-4" />
    </Button>
  );
}
