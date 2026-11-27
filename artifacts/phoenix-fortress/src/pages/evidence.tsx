import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, FileLock2, Trash2 } from 'lucide-react';
import { useListEvidence, useStoreEvidence, useDeleteEvidence, useGetEvidenceData, getGetEvidenceDataQueryKey, type Evidence } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Empty, ErrorPanel, Field, Hash, PageHeader, Panel, RowsSkeleton, Tag } from '@/components/kit';
import { MutationError, isConsentError } from '@/components/vault-kit';
import { useToast } from '@/hooks/use-toast';
import { fmtBytes, fmtDate, qopts, useIdempotencyKey, useInvalidateAll } from '@/lib/vault';

export default function EvidencePage() {
  const q = useListEvidence({ query: { ...qopts } });
  const [deleting, setDeleting] = useState<Evidence | null>(null);
  return (
    <>
      <PageHeader eyebrow="Opt-in" title="Evidence locker">
        Notes, messages or logs you may need later, encrypted at rest and hashed into the ledger so you can show they were not changed. Contents stay closed until you open one.
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
        <StoreForm />
        <Panel title="Stored items" meta={q.data ? `${q.data.filter((e) => e.status === 'retained').length} retained` : undefined}>
          {q.isLoading ? <RowsSkeleton /> : q.error ? (isConsentError(q.error) ? <MutationError error={q.error} /> : <ErrorPanel error={q.error} onRetry={() => void q.refetch()} />) : !q.data?.length ? (
            <Empty title="Nothing stored">Items you save appear here by label only.</Empty>
          ) : (
            <ul className="divide-y divide-border">{q.data.map((e) => <EvidenceRow key={e.id} e={e} onDelete={() => setDeleting(e)} />)}</ul>
          )}
        </Panel>
      </div>
      {deleting && <DeleteDialog e={deleting} onClose={() => setDeleting(null)} />}
    </>
  );
}

function StoreForm() {
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const { toast } = useToast();
  const m = useStoreEvidence();
  const [label, setLabel] = useState('');
  const [content, setContent] = useState('');
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    m.mutate({ data: { label: label.trim(), content, idempotencyKey: idem.key } }, {
      onSuccess: (r) => { idem.rotate(); setLabel(''); setContent(''); void invalidate(); toast({ title: 'Stored and sealed', description: r.label }); },
    });
  };
  return (
    <Panel title="Store an item">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Label" htmlFor="ev-label" hint="Visible in the list. Keep it discreet if others might see your screen."><Input id="ev-label" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} data-testid="input-evidence-label" /></Field>
        <Field label="Content" htmlFor="ev-content" hint={`${content.length.toLocaleString()} / 100,000 characters`}><Textarea id="ev-content" rows={8} maxLength={100000} value={content} onChange={(e) => setContent(e.target.value)} data-testid="input-evidence-content" /></Field>
        <MutationError error={m.error} />
        <Button type="submit" disabled={!label.trim() || !content || m.isPending} data-testid="button-store-evidence"><FileLock2 className="mr-1.5 h-4 w-4" />{m.isPending ? 'Encrypting' : 'Encrypt and store'}</Button>
      </form>
    </Panel>
  );
}

function EvidenceRow({ e, onDelete }: { e: Evidence; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="py-3" data-testid={`row-evidence-${e.id}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{e.label}</div>
          <div className="flex flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground"><span>{fmtDate(e.createdAt)}</span><span className="font-mono">{fmtBytes(e.bytes)}</span><Hash value={e.checksum} n={8} /></div>
        </div>
        <div className="flex items-center gap-1.5">
          {e.status === 'deleted' ? <Tag>shredded</Tag> : (
            <>
              <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} data-testid={`button-view-evidence-${e.id}`}>{open ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}<span className="ml-1.5">{open ? 'Close' : 'Open'}</span></Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={onDelete} data-testid={`button-delete-evidence-${e.id}`}><Trash2 className="h-4 w-4" /></Button>
            </>
          )}
        </div>
      </div>
      {open && <EvidenceContent id={e.id} />}
    </li>
  );
}

function EvidenceContent({ id }: { id: string }) {
  const q = useGetEvidenceData(id, { query: { ...qopts, staleTime: 0, gcTime: 0, queryKey: getGetEvidenceDataQueryKey(id) } });
  if (q.isLoading) return <div className="mt-2"><RowsSkeleton rows={2} /></div>;
  if (q.error) return <div className="mt-2"><ErrorPanel error={q.error} onRetry={() => void q.refetch()} /></div>;
  if (!q.data) return null;
  return (
    <div className="rise mt-2 rounded-md border border-border bg-muted/40 p-3">
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-sm">{q.data.content}</pre>
      <div className="mt-2 font-mono text-[10px] text-muted-foreground">checksum {q.data.checksum}</div>
    </div>
  );
}

function DeleteDialog({ e, onClose }: { e: Evidence; onClose: () => void }) {
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const m = useDeleteEvidence();
  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle className="font-display font-medium">Shred "{e.label}"?</AlertDialogTitle>
          <AlertDialogDescription>The encryption key for this item is destroyed. The content becomes permanently unreadable, by you or anyone, including from backups. Only its checksum and the fact it existed remain in the ledger.</AlertDialogDescription></AlertDialogHeader>
        <MutationError error={m.error} />
        <AlertDialogFooter><AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction disabled={m.isPending} data-testid="button-confirm-delete-evidence" onClick={(ev) => { ev.preventDefault(); m.mutate({ id: e.id, data: { idempotencyKey: idem.key } }, { onSuccess: () => { idem.rotate(); void invalidate(); onClose(); } }); }}>{m.isPending ? 'Shredding' : 'Shred permanently'}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
