import { useState, type FormEvent } from 'react';
import { KeyRound, UserPlus } from 'lucide-react';
import {
  useListCredentials, useIssueCredential, useRevokeCredential, useListMembers, useSetMember, useListDatasets,
  type Credential, type CredentialIssued,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Empty, ErrorPanel, Field, InlineError, PageHeader, Panel, Restricted, RowsSkeleton, Tag, selectCls } from '@/components/kit';
import { useIdentity } from '@/components/identity';
import { SecretBox } from '@/components/vault-kit';
import { useToast } from '@/hooks/use-toast';
import { fmtDate, qopts, useIdempotencyKey, useInvalidateAll } from '@/lib/vault';

export default function SettingsPage() {
  const { isAdmin, isLoading } = useIdentity();
  if (isLoading) return <RowsSkeleton />;
  if (!isAdmin) return <><PageHeader eyebrow="Administration" title="Settings" /><Restricted what="Credential and membership management" /></>;
  return (
    <>
      <PageHeader eyebrow="Administration" title="Credentials & members">
        Dataset-bound credentials: ingest tokens let your scheduler push JSON; export tokens are short-lived for encrypted downloads. Members are added by their sign-in provider user ID and always join as operators.
      </PageHeader>
      <div className="space-y-6">
        <Credentials />
        <Members />
      </div>
    </>
  );
}

function Credentials() {
  const cr = useListCredentials({ query: { ...qopts } });
  const ds = useListDatasets({ query: { ...qopts } });
  const [issuing, setIssuing] = useState(false);
  const [revoking, setRevoking] = useState<Credential | null>(null);
  const name = (id: string) => ds.data?.find((d) => d.id === id)?.name ?? id;
  return (
    <Panel title="API credentials" meta={<Button size="sm" onClick={() => setIssuing(true)} disabled={!ds.data?.length} data-testid="button-issue-credential"><KeyRound className="mr-1.5 h-3.5 w-3.5" />Issue credential</Button>}>
      {cr.isLoading ? <RowsSkeleton /> : cr.error ? <ErrorPanel error={cr.error} onRetry={() => void cr.refetch()} /> : !cr.data?.length ? (
        <Empty title="No credentials issued">{ds.data?.length ? 'Issue a credential for your application scheduler to push backups.' : 'Register a dataset before issuing credentials.'}</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="eyebrow text-left [&>th]:pb-2 [&>th]:pr-3 [&>th]:font-normal"><th>Name</th><th>Prefix</th><th>Dataset</th><th>Kind</th><th>Used</th><th>Expires</th><th>State</th><th /></tr></thead>
            <tbody className="divide-y divide-border">
              {cr.data.map((c) => {
                const expired = new Date(c.expiresAt).getTime() < Date.now();
                return (
                  <tr key={c.id} className="[&>td]:py-2 [&>td]:pr-3" data-testid={`row-credential-${c.id}`}>
                    <td className="font-medium">{c.name}</td>
                    <td className="font-mono text-xs">{c.prefix}…</td>
                    <td className="text-xs">{name(c.datasetId)}</td>
                    <td><Tag tone={c.kind === 'export' ? 'warn' : 'neutral'}>{c.kind}</Tag></td>
                    <td className="whitespace-nowrap text-xs text-muted-foreground">{c.useCount ? `${c.useCount}x, last ${fmtDate(c.usedAt)}` : 'never'}</td>
                    <td className="whitespace-nowrap text-xs">{fmtDate(c.expiresAt)}</td>
                    <td>{c.revoked ? <Tag tone="bad">revoked</Tag> : expired ? <Tag tone="warn">expired</Tag> : <Tag tone="good">active</Tag>}</td>
                    <td>{!c.revoked && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setRevoking(c)} data-testid={`button-revoke-${c.id}`}>Revoke</Button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {issuing && <IssueDialog onClose={() => setIssuing(false)} />}
      {revoking && <RevokeDialog cred={revoking} onClose={() => setRevoking(null)} />}
    </Panel>
  );
}

function IssueDialog({ onClose }: { onClose: () => void }) {
  const ds = useListDatasets({ query: { ...qopts } });
  const [name, setName] = useState('');
  const [datasetId, setDatasetId] = useState('');
  const [kind, setKind] = useState<'export' | 'ingest'>('ingest');
  const [minutes, setMinutes] = useState('43200');
  const [issued, setIssued] = useState<CredentialIssued | null>(null);
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const m = useIssueCredential();
  const max = kind === 'export' ? 15 : 129600;
  const n = Number(minutes);
  const valid = name.trim() && datasetId && Number.isInteger(n) && n >= 1 && n <= max;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate({ data: { name: name.trim(), datasetId, kind, expiresInMinutes: n, idempotencyKey: idem.key } }, {
      onSuccess: (r) => { idem.rotate(); setIssued(r); void invalidate(); },
    });
  };
  const close = () => { setIssued(null); onClose(); };

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-lg" onInteractOutside={(e) => issued && e.preventDefault()}>
        {issued ? (
          <>
            <DialogHeader><DialogTitle className="font-display text-xl font-medium">Credential issued</DialogTitle><DialogDescription>{issued.credential.name} · {issued.credential.kind} · expires {fmtDate(issued.credential.expiresAt)}</DialogDescription></DialogHeader>
            {issued.token ? (
              <SecretBox title="Bearer token" note="Shown once and not stored in this browser. If lost, revoke and issue a new one." values={[issued.token]} onDismiss={close} dismissLabel="I have stored it" testId="credential-token" />
            ) : (
              <p className="rounded-md border border-ochre/30 bg-ochre/10 p-3 text-sm text-ochre">This was a repeated request, so the server did not return the token again. Revoke this credential and issue a new one if you did not keep it.</p>
            )}
            {!issued.token && <div className="flex justify-end"><Button onClick={close}>Close</Button></div>}
          </>
        ) : (
          <>
            <DialogHeader><DialogTitle className="font-display text-xl font-medium">Issue credential</DialogTitle><DialogDescription>Bound to a single dataset. Export credentials live 15 minutes at most; ingest credentials up to 90 days.</DialogDescription></DialogHeader>
            <form onSubmit={submit} className="space-y-4">
              <Field label="Name" htmlFor="c-name"><Input id="c-name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="nightly-journal-push" data-testid="input-credential-name" /></Field>
              <Field label="Dataset" htmlFor="c-ds">
                <select id="c-ds" className={selectCls} value={datasetId} onChange={(e) => setDatasetId(e.target.value)} data-testid="select-credential-dataset">
                  <option value="">Choose a dataset</option>
                  {ds.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </Field>
              <Field label="Kind" hint={kind === 'ingest' ? 'Lets a scheduler push JSON to POST /api/v1/ingest/backups.' : 'Short-lived: lets a tool fetch encrypted exports of this dataset.'}>
                <div className="flex gap-2">
                  {(['ingest', 'export'] as const).map((k) => (
                    <label key={k} className="flex cursor-pointer items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                      <input type="radio" name="kind" className="accent-[hsl(var(--primary))]" checked={kind === k} onChange={() => { setKind(k); setMinutes(k === 'export' ? '15' : '43200'); }} data-testid={`radio-kind-${k}`} />{k}
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="Expires in (minutes)" htmlFor="c-min" hint={`1 to ${max.toLocaleString()} minutes${kind === 'ingest' ? ' (43,200 = 30 days)' : ''}`}><Input id="c-min" type="number" min={1} max={max} value={minutes} onChange={(e) => setMinutes(e.target.value)} data-testid="input-credential-minutes" /></Field>
              <InlineError error={m.error} />
              <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={close}>Cancel</Button><Button type="submit" disabled={!valid || m.isPending} data-testid="button-submit-credential">{m.isPending ? 'Issuing' : 'Issue'}</Button></div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RevokeDialog({ cred, onClose }: { cred: Credential; onClose: () => void }) {
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const { toast } = useToast();
  const m = useRevokeCredential();
  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle className="font-display font-medium">Revoke {cred.name}?</AlertDialogTitle><AlertDialogDescription>Requests using prefix {cred.prefix} will be rejected immediately. This cannot be reversed.</AlertDialogDescription></AlertDialogHeader>
        <InlineError error={m.error} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={m.isPending} data-testid="button-confirm-revoke" onClick={(e) => { e.preventDefault(); m.mutate({ id: cred.id, data: { idempotencyKey: idem.key } }, { onSuccess: () => { void invalidate(); toast({ title: 'Credential revoked', description: cred.name }); onClose(); } }); }}>{m.isPending ? 'Revoking' : 'Revoke'}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Members() {
  const mb = useListMembers({ query: { ...qopts } });
  const { identity } = useIdentity();
  const [userId, setUserId] = useState('');
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const { toast } = useToast();
  const m = useSetMember();
  const set = (uid: string, role: 'operator' | 'removed', reset?: boolean) =>
    m.mutate({ data: { userId: uid, role, idempotencyKey: idem.key } }, { onSuccess: (r) => { idem.rotate(); void invalidate(); if (reset) setUserId(''); toast({ title: role === 'removed' ? 'Member removed' : 'Operator added', description: r.userId }); } });

  return (
    <Panel title="Operator membership">
      <form onSubmit={(e) => { e.preventDefault(); if (userId.trim()) set(userId.trim(), 'operator', true); }} className="mb-5 flex flex-col gap-2 sm:flex-row">
        <Input value={userId} maxLength={100} onChange={(e) => setUserId(e.target.value)} placeholder="Provider user ID, e.g. user_2abc…" className="font-mono" data-testid="input-member-id" />
        <Button type="submit" disabled={!userId.trim() || m.isPending} data-testid="button-add-member"><UserPlus className="mr-1.5 h-4 w-4" />Add as operator</Button>
      </form>
      <InlineError error={m.error} />
      {mb.isLoading ? <RowsSkeleton /> : mb.error ? <ErrorPanel error={mb.error} onRetry={() => void mb.refetch()} /> : !mb.data?.length ? (
        <Empty title="No members listed">Operators you add appear here.</Empty>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {mb.data.map((x) => (
            <li key={x.userId} className="flex items-center justify-between gap-2 py-2.5" data-testid={`row-member-${x.userId}`}>
              <span className="truncate font-mono text-xs">{x.userId}{x.userId === identity?.userId && <span className="ml-2 text-muted-foreground">(you)</span>}</span>
              <div className="flex items-center gap-2">
                <Tag tone={x.role === 'admin' ? 'seal' : x.role === 'operator' ? 'good' : 'neutral'}>{x.role === 'admin' ? 'admin · owner' : x.role}</Tag>
                {x.role === 'operator' && <Button size="sm" variant="ghost" className="text-destructive" disabled={m.isPending} onClick={() => set(x.userId, 'removed')} data-testid={`button-remove-member-${x.userId}`}>Remove</Button>}
                {x.role === 'removed' && <Button size="sm" variant="ghost" disabled={m.isPending} onClick={() => set(x.userId, 'operator')} data-testid={`button-restore-member-${x.userId}`}>Re-add</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
