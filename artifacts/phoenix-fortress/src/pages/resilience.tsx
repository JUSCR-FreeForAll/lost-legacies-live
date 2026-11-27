import { useState, type FormEvent } from 'react';
import { ChevronRight, Stamp, ShieldAlert, ShieldCheck } from 'lucide-react';
import {
  useGetIntegrity, useResolveIntegrity, useListCheckpoints, useCreateCheckpoint, useListSigners, useAddSigner, useRevokeSigner,
  useSubmitWitness, useCountersignCheckpoint, useImportCheckpoint, useGetRevocations, useMergeRevocations,
  type Checkpoint, type SignedCheckpoint, type WitnessSignature, type ImportResult, type MergeResult,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Empty, ErrorPanel, Field, Hash, PageHeader, Panel, RowsSkeleton, Tag, selectCls } from '@/components/kit';
import { CopyButton, JsonInput, JsonView, MutationError, parseObject } from '@/components/vault-kit';
import { useIdentity } from '@/components/identity';
import { cn } from '@/lib/utils';
import { fmtDate, qopts, relTime, useIdempotencyKey, useInvalidateAll } from '@/lib/vault';

export default function ResiliencePage() {
  return (
    <>
      <PageHeader eyebrow="Resilience" title="Integrity & peers">
        Signed checkpoints let another installation, or a person you trust, vouch for the state of this ledger. If someone rewrites history, the signatures stop matching.
      </PageHeader>
      <div className="space-y-6">
        <IntegrityPanel />
        <Tabs defaultValue="checkpoints">
          <TabsList className="mb-4 flex-wrap">
            <TabsTrigger value="checkpoints" data-testid="tab-checkpoints">Checkpoints</TabsTrigger>
            <TabsTrigger value="signers" data-testid="tab-signers">Trusted signers</TabsTrigger>
            <TabsTrigger value="exchange" data-testid="tab-exchange">Exchange with peers</TabsTrigger>
            <TabsTrigger value="revocations" data-testid="tab-revocations">Revocations</TabsTrigger>
          </TabsList>
          <TabsContent value="checkpoints"><Checkpoints /></TabsContent>
          <TabsContent value="signers"><Signers /></TabsContent>
          <TabsContent value="exchange"><Exchange /></TabsContent>
          <TabsContent value="revocations"><Revocations /></TabsContent>
        </Tabs>
      </div>
    </>
  );
}

function IntegrityPanel() {
  const q = useGetIntegrity({ query: { ...qopts } });
  const { refetch } = useIdentity();
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const m = useResolveIntegrity();
  const [armed, setArmed] = useState(false);
  if (q.isLoading) return <RowsSkeleton rows={2} />;
  if (q.error) return <ErrorPanel error={q.error} onRetry={() => void q.refetch()} />;
  const s = q.data;
  if (!s) return null;
  const open = s.conditions.filter((c) => !c.resolvedAt);
  return (
    <section className={cn('rise rounded-md border p-5', s.recoveryRequired ? 'border-2 border-destructive/40 bg-destructive/5' : open.length ? 'border-ochre/40 bg-ochre/5' : 'border-verdigris/30 bg-verdigris/5')} data-testid="status-integrity">
      <div className="flex items-start gap-3">
        {s.recoveryRequired || open.length ? <ShieldAlert className={cn('mt-0.5 h-5 w-5', s.recoveryRequired ? 'text-destructive' : 'text-ochre')} /> : <ShieldCheck className="mt-0.5 h-5 w-5 text-verdigris" />}
        <div className="flex-1">
          <div className="font-medium">{s.recoveryRequired ? 'RECOVERY_REQUIRED' : open.length ? `${open.length} open condition${open.length === 1 ? '' : 's'}` : 'No open integrity conditions'}</div>
          <p className="mt-0.5 text-sm text-muted-foreground">{s.recoveryRequired ? 'Writes are paused until you review the conditions below and resolve them.' : 'Conditions are raised by the server when stored hashes or signatures do not line up.'}</p>
        </div>
      </div>
      {s.conditions.length > 0 && (
        <ul className="mt-4 space-y-2">
          {s.conditions.map((c) => (
            <li key={c.id} className="rounded border border-border bg-card p-3 text-sm" data-testid={`row-condition-${c.id}`}>
              <div className="flex flex-wrap items-center gap-2"><Tag tone={c.resolvedAt ? 'neutral' : 'bad'}>{c.code}</Tag><Tag>{c.scope}</Tag><span className="text-xs text-muted-foreground">detected {fmtDate(c.detectedAt)}{c.resolvedAt && `, resolved ${fmtDate(c.resolvedAt)}`}</span></div>
              <pre className="mt-2 max-h-32 overflow-auto font-mono text-[11px] text-muted-foreground">{JSON.stringify(c.detail, null, 2)}</pre>
            </li>
          ))}
        </ul>
      )}
      {open.length > 0 && (
        <div className="mt-4 space-y-2">
          {armed && <p className="text-xs">Resolving records that you reviewed these conditions. It does not repair data; it acknowledges what the server found and lifts the write pause. The acknowledgement is itself recorded in the ledger.</p>}
          <MutationError error={m.error} />
          <div className="flex gap-2">
            <Button size="sm" variant={armed ? 'default' : 'outline'} disabled={m.isPending} data-testid="button-resolve-integrity"
              onClick={() => { if (!armed) { setArmed(true); return; } m.mutate({ data: { idempotencyKey: idem.key } }, { onSuccess: () => { idem.rotate(); setArmed(false); void invalidate(); refetch(); } }); }}>
              {m.isPending ? 'Resolving' : armed ? 'I have reviewed these; resolve' : 'Resolve conditions'}
            </Button>
            {armed && <Button size="sm" variant="ghost" onClick={() => setArmed(false)}>Cancel</Button>}
          </div>
        </div>
      )}
    </section>
  );
}

function Checkpoints() {
  const q = useListCheckpoints({ query: { ...qopts } });
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const m = useCreateCheckpoint();
  return (
    <Panel title="Signed checkpoints" meta={<Button size="sm" disabled={m.isPending} onClick={() => m.mutate({ data: { idempotencyKey: idem.key } }, { onSuccess: () => { idem.rotate(); void invalidate(); } })} data-testid="button-create-checkpoint"><Stamp className="mr-1.5 h-3.5 w-3.5" />{m.isPending ? 'Signing' : 'Sign checkpoint now'}</Button>}>
      <MutationError error={m.error} />
      {q.isLoading ? <RowsSkeleton /> : q.error ? <ErrorPanel error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.length ? (
        <Empty title="No checkpoints yet">A checkpoint signs the current ledger height and tip hash with this installation's key.</Empty>
      ) : (
        <ul className="divide-y divide-border">{[...q.data].sort((a, b) => b.height - a.height).map((c) => <CheckpointRow key={c.id} c={c} />)}</ul>
      )}
    </Panel>
  );
}

function CheckpointRow({ c }: { c: Checkpoint }) {
  const [open, setOpen] = useState(false);
  return (
    <li data-testid={`row-checkpoint-${c.id}`}>
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-center gap-3 py-2.5 text-left hover:bg-muted/40">
        <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <span className="w-16 font-mono text-xs">h{c.height}</span>
        <Tag tone={c.source === 'local' ? 'seal' : 'neutral'}>{c.source}</Tag>
        <span className="font-mono text-xs text-muted-foreground">{c.origin}</span>
        <span className="text-xs text-muted-foreground">{c.witnesses.length} witness{c.witnesses.length === 1 ? '' : 'es'}</span>
        <span className="ml-auto text-xs text-muted-foreground">{relTime(c.createdAt)}</span>
      </button>
      {open && (
        <div className="mb-3 ml-6 space-y-3 rounded-md bg-muted/40 p-3 text-xs">
          <div className="flex flex-wrap gap-x-6 gap-y-1"><span>tip <Hash value={c.tipHash} n={12} /></span><span>checkpoint <Hash value={c.checkpointHash} n={12} /></span><span>signer <Hash value={c.signer} n={12} /></span></div>
          {c.witnesses.length > 0 && <ul className="space-y-1">{c.witnesses.map((w, i) => <li key={i} className="font-mono text-[11px]">witness <Hash value={w.witness} n={10} /> sig <Hash value={w.signature} n={8} /></li>)}</ul>}
          <div><div className="eyebrow mb-1">Signed checkpoint (send to a peer or witness)</div><JsonView value={c.signed} /></div>
        </div>
      )}
    </li>
  );
}

function Signers() {
  const q = useListSigners({ query: { ...qopts } });
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const add = useAddSigner();
  const revoke = useRevokeSigner();
  const [keyId, setKeyId] = useState('');
  const [kind, setKind] = useState<'peer' | 'witness' | 'seamcraft_sender'>('peer');
  const [label, setLabel] = useState('');
  const valid = /^ed25519:[A-Za-z0-9_-]{43}$/.test(keyId.trim()) && label.trim();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate({ data: { keyId: keyId.trim(), kind, label: label.trim(), idempotencyKey: idem.key } }, { onSuccess: () => { idem.rotate(); setKeyId(''); setLabel(''); void invalidate(); } });
  };
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
      <Panel title="Add a trusted key">
        <form onSubmit={submit} className="space-y-3">
          <Field label="Key ID" htmlFor="sg-key" hint="Format ed25519: followed by 43 characters. Get it from the other party over a channel you trust.">
            <Input id="sg-key" className="font-mono text-xs" value={keyId} onChange={(e) => setKeyId(e.target.value)} placeholder="ed25519:..." data-testid="input-signer-key" />
          </Field>
          <Field label="Kind" htmlFor="sg-kind">
            <select id="sg-kind" className={selectCls} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} data-testid="select-signer-kind">
              <option value="peer">Peer installation</option><option value="witness">Witness</option><option value="seamcraft_sender">Seamcraft sender</option>
            </select>
          </Field>
          <Field label="Label" htmlFor="sg-label"><Input id="sg-label" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} data-testid="input-signer-label" /></Field>
          <MutationError error={add.error} />
          <Button type="submit" disabled={!valid || add.isPending} data-testid="button-add-signer">{add.isPending ? 'Adding' : 'Trust this key'}</Button>
        </form>
      </Panel>
      <Panel title="Keys" meta={q.data && <span className="inline-flex items-center gap-1">this install <Hash value={q.data.installationKey} n={10} testId="text-installation-key" /></span>}>
        <MutationError error={revoke.error} />
        {q.isLoading ? <RowsSkeleton /> : q.error ? <ErrorPanel error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.signers.length ? (
          <Empty title="No trusted keys">Add a peer or witness key to accept their signatures.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {q.data.signers.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2.5" data-testid={`row-signer-${s.id}`}>
                <div className="min-w-0"><div className="text-sm font-medium">{s.label} <Tag>{s.kind}</Tag></div><Hash value={s.keyId} n={14} /></div>
                {s.revokedAt ? <Tag tone="bad">revoked</Tag> : (
                  <Button size="sm" variant="ghost" className="text-destructive" disabled={revoke.isPending} onClick={() => revoke.mutate({ id: s.id, data: { idempotencyKey: idem.key } }, { onSuccess: () => { idem.rotate(); void invalidate(); } })} data-testid={`button-revoke-signer-${s.id}`}>Revoke</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Exchange() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Countersign />
      <SubmitWitness />
      <ImportCheckpoint />
    </div>
  );
}

function Countersign() {
  const m = useCountersignCheckpoint();
  const [text, setText] = useState('');
  const [sig, setSig] = useState<WitnessSignature | null>(null);
  const p = parseObject(text);
  return (
    <Panel title="Countersign a peer's checkpoint">
      <p className="mb-3 text-xs text-muted-foreground">Paste the signed checkpoint a peer sent you. If it verifies against a trusted key, this installation signs it as witness; send the result back to them.</p>
      <JsonInput value={text} onChange={(v) => { setText(v); setSig(null); }} testId="countersign" placeholder='{"checkpoint": {...}, "checkpoint_hash": "...", "signature": "..."}' />
      <div className="mt-3 space-y-3">
        <MutationError error={m.error} />
        <Button disabled={!p.ok || m.isPending} onClick={() => p.ok && m.mutate({ data: { signed: p.value as unknown as SignedCheckpoint } }, { onSuccess: setSig })} data-testid="button-countersign">{m.isPending ? 'Verifying' : 'Verify and countersign'}</Button>
        {sig && <div data-testid="text-witness-signature"><div className="eyebrow mb-1">Witness signature (copy back to the peer)</div><JsonView value={sig} max="max-h-40" /></div>}
      </div>
    </Panel>
  );
}

function SubmitWitness() {
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const m = useSubmitWitness();
  const [text, setText] = useState('');
  const [ok, setOk] = useState(false);
  const p = parseObject(text);
  return (
    <Panel title="Attach a witness signature">
      <p className="mb-3 text-xs text-muted-foreground">Paste the witness JSON a peer returned for one of your checkpoints.</p>
      <JsonInput value={text} onChange={(v) => { setText(v); setOk(false); }} testId="witness" rows={5} placeholder='{"witness": "ed25519:...", "checkpoint_hash": "...", "signature": "..."}' />
      <div className="mt-3 space-y-2">
        <MutationError error={m.error} />
        <Button disabled={!p.ok || m.isPending} onClick={() => p.ok && m.mutate({ data: { witness: p.value as unknown as WitnessSignature, idempotencyKey: idem.key } }, { onSuccess: () => { idem.rotate(); setText(''); setOk(true); void invalidate(); } })} data-testid="button-submit-witness">{m.isPending ? 'Verifying' : 'Attach witness'}</Button>
        {ok && <p className="text-xs text-verdigris">Witness signature verified and attached.</p>}
      </div>
    </Panel>
  );
}

function ImportCheckpoint() {
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const m = useImportCheckpoint();
  const [text, setText] = useState('');
  const [origin, setOrigin] = useState('');
  const [res, setRes] = useState<ImportResult | null>(null);
  const p = parseObject(text);
  return (
    <Panel title="Import a peer checkpoint" className="lg:col-span-2">
      <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
        <JsonInput value={text} onChange={(v) => { setText(v); setRes(null); }} testId="import-checkpoint" placeholder="Signed checkpoint JSON" />
        <div className="space-y-3">
          <Field label="Origin" htmlFor="imp-origin" hint="Where it came from, e.g. the peer's name."><Input id="imp-origin" maxLength={80} value={origin} onChange={(e) => setOrigin(e.target.value)} data-testid="input-import-origin" /></Field>
          <MutationError error={m.error} />
          <Button disabled={!p.ok || !origin.trim() || m.isPending} onClick={() => p.ok && m.mutate({ data: { signed: p.value as unknown as SignedCheckpoint, origin: origin.trim(), idempotencyKey: idem.key } }, { onSuccess: (r) => { idem.rotate(); setRes(r); void invalidate(); } })} data-testid="button-import-checkpoint">{m.isPending ? 'Checking' : 'Import and compare'}</Button>
          {res && <p className="rounded border border-verdigris/30 bg-verdigris/10 px-3 py-2 text-xs" data-testid="status-import-result"><b>{res.status}</b> at height {res.height} (local {res.localHeight}). <Hash value={res.checkpointHash} n={8} /></p>}
        </div>
      </div>
    </Panel>
  );
}

function Revocations() {
  const q = useGetRevocations({ query: { ...qopts } });
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const m = useMergeRevocations();
  const [text, setText] = useState('');
  const [res, setRes] = useState<MergeResult | null>(null);
  const p = parseObject(text);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="This installation's revocations" meta={q.data && `${Object.keys(q.data.state).length} tombstones`}>
        <p className="mb-3 text-xs text-muted-foreground">Revoked credentials, contacts, consents and keys. Share this with peers so a revocation here is honoured there.</p>
        {q.isLoading ? <RowsSkeleton rows={3} /> : q.error ? <ErrorPanel error={q.error} onRetry={() => void q.refetch()} /> : q.data && (
          <>
            <JsonView value={q.data} max="max-h-72" />
            <div className="mt-2"><CopyButton value={JSON.stringify(q.data)} label="Copy state JSON" testId="button-copy-revocations" /></div>
          </>
        )}
      </Panel>
      <Panel title="Merge a peer's revocations">
        <p className="mb-3 text-xs text-muted-foreground">Paste the state from a peer. Merging only ever adds revocations; it cannot un-revoke anything.</p>
        <JsonInput value={text} onChange={(v) => { setText(v); setRes(null); }} testId="merge-revocations" placeholder='{"origin": "...", "state": {...}}' />
        <div className="mt-3 space-y-2">
          <MutationError error={m.error} />
          <Button disabled={!p.ok || m.isPending} onClick={() => {
            if (!p.ok) return;
            const v = p.value;
            const state = (v.state && typeof v.state === 'object' ? v.state : v) as Record<string, unknown>;
            m.mutate({ data: { state, idempotencyKey: idem.key } }, { onSuccess: (r) => { idem.rotate(); setRes(r); setText(''); void invalidate(); } });
          }} data-testid="button-merge-revocations">{m.isPending ? 'Merging' : 'Merge'}</Button>
          {res && <p className="text-xs" data-testid="status-merge-result">{res.added} added, {res.applied} applied, {res.total} total.</p>}
        </div>
      </Panel>
    </div>
  );
}
