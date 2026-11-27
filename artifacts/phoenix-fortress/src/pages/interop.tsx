import { useState } from 'react';
import { Link } from 'wouter';
import { Anchor as AnchorIcon, FileInput } from 'lucide-react';
import {
  useListInteropRecords, useImportJsonLd, useImportSeamcraft, useListAnchors, usePrepareAnchor, useRecordAnchor,
  type Anchor, type AnchorRecordInputNetwork,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Empty, ErrorPanel, Field, Hash, PageHeader, Panel, RowsSkeleton, Tag, selectCls } from '@/components/kit';
import { CopyButton, JsonInput, MutationError, isConsentError, parseObject } from '@/components/vault-kit';
import { fmtDate, qopts, relTime, useIdempotencyKey, useInvalidateAll } from '@/lib/vault';

export default function InteropPage() {
  return (
    <>
      <PageHeader eyebrow="Interop" title="Bring records in, anchor hashes out">
        Import structured records from other tools, and optionally publish a checkpoint hash to a public chain with your own wallet. Each path needs its own consent.
      </PageHeader>
      <Tabs defaultValue="import">
        <TabsList className="mb-4">
          <TabsTrigger value="import" data-testid="tab-import">Imports</TabsTrigger>
          <TabsTrigger value="juscr" data-testid="tab-juscr">JUSCR ingest</TabsTrigger>
          <TabsTrigger value="anchors" data-testid="tab-anchors">Solana anchors</TabsTrigger>
        </TabsList>
        <TabsContent value="import"><Imports /></TabsContent>
        <TabsContent value="juscr"><Juscr /></TabsContent>
        <TabsContent value="anchors"><Anchors /></TabsContent>
      </Tabs>
    </>
  );
}

function Imports() {
  const q = useListInteropRecords({ query: { ...qopts } });
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <ImportBox kind="jsonld" />
        <ImportBox kind="seamcraft" />
      </div>
      <Panel title="Imported records" meta={q.data && `${q.data.length}`}>
        {q.isLoading ? <RowsSkeleton /> : q.error ? (isConsentError(q.error) ? <MutationError error={q.error} /> : <ErrorPanel error={q.error} onRetry={() => void q.refetch()} />) : !q.data?.length ? (
          <Empty title="Nothing imported yet" />
        ) : (
          <ul className="divide-y divide-border">
            {q.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm" data-testid={`row-interop-${r.id}`}>
                <Tag tone="seal">{r.adapter}</Tag>
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{r.objectRef}</span>
                {r.replay && <Tag>replay</Tag>}
                <span className="font-mono text-xs text-muted-foreground">ledger #{r.eventIdx}</span>
                <span className="text-xs text-muted-foreground">{relTime(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function ImportBox({ kind }: { kind: 'jsonld' | 'seamcraft' }) {
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const jl = useImportJsonLd();
  const sc = useImportSeamcraft();
  const m = kind === 'jsonld' ? jl : sc;
  const [text, setText] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const p = parseObject(text);
  const ok = (r: { objectRef: string }) => { idem.rotate(); setText(''); setDone(r.objectRef); void invalidate(); };
  const submit = () => {
    if (!p.ok) return;
    if (kind === 'jsonld') jl.mutate({ data: { document: p.value, idempotencyKey: idem.key } }, { onSuccess: ok });
    else sc.mutate({ data: { envelope: p.value, idempotencyKey: idem.key } }, { onSuccess: ok });
  };
  return (
    <Panel title={kind === 'jsonld' ? 'JSON-LD document' : 'Seamcraft envelope'}>
      <p className="mb-3 text-xs text-muted-foreground">
        {kind === 'jsonld' ? 'Contexts must be inline. Documents referencing remote @context URLs are refused; the server never fetches them.' : 'A signed envelope from a Seamcraft sender you have trusted under Resilience.'}
      </p>
      <JsonInput value={text} onChange={(v) => { setText(v); setDone(null); }} testId={`import-${kind}`} />
      <div className="mt-3 space-y-2">
        <MutationError error={m.error} />
        <Button disabled={!p.ok || m.isPending} onClick={submit} data-testid={`button-import-${kind}`}><FileInput className="mr-1.5 h-4 w-4" />{m.isPending ? 'Importing' : 'Import'}</Button>
        {done && <p className="text-xs text-verdigris">Imported as <span className="font-mono">{done}</span>.</p>}
      </div>
    </Panel>
  );
}

function Juscr() {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const curl = `curl -X POST ${origin}/api/v1/ingest/backups \\\n  -H "Authorization: Bearer $PF_INGEST_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{"data": {"entries": []}, "idempotencyKey": "run-2024-11-03T02:00Z"}'`;
  return (
    <Panel title="Pushing from JUSCR or any scheduler">
      <ol className="space-y-3 text-sm">
        <li><b>1.</b> Grant <span className="font-mono text-xs">juscr_ingest</span> in <Link href="/privacy" className="text-primary underline underline-offset-2">Privacy &amp; safety</Link>.</li>
        <li><b>2.</b> Issue an <i>ingest</i> credential for the dataset in <Link href="/settings" className="text-primary underline underline-offset-2">Settings</Link>. Copy the token when shown; it appears once.</li>
        <li><b>3.</b> POST JSON to <span className="font-mono text-xs">/api/v1/ingest/backups</span> with the token as a Bearer header and a body of <span className="font-mono text-xs">{'{data, idempotencyKey}'}</span>. Reuse the same key when retrying the same snapshot.</li>
      </ol>
      <div className="relative mt-4">
        <pre className="overflow-auto rounded-md bg-sidebar p-4 font-mono text-[11px] leading-relaxed text-sidebar-foreground">{curl}</pre>
        <div className="absolute right-2 top-2"><CopyButton value={curl} testId="button-copy-curl" /></div>
      </div>
    </Panel>
  );
}

function Anchors() {
  const q = useListAnchors({ query: { ...qopts } });
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const m = usePrepareAnchor();
  const d = q.data;
  return (
    <div className="space-y-6">
      <div className="rise rounded-md border border-border bg-card p-4 text-sm">
        <p>Anchors contain <b>only hashes</b> of a signed checkpoint, never vault contents. You write the memo using <b>your own wallet</b>; this server holds no keys and sends no transactions. Recorded anchors are stored as <Tag tone="warn">recorded unverified</Tag>: the server does not check the chain.</p>
      </div>
      <Panel title="Anchors" meta={d && (
        <span className="flex items-center gap-2"><Tag tone={d.enabled ? 'good' : 'neutral'}>{d.enabled ? 'enabled' : 'disabled'}</Tag><Tag tone={d.consent === 'granted' ? 'good' : 'warn'}>consent {d.consent.replace('_', ' ')}</Tag></span>
      )}>
        {q.isLoading ? <RowsSkeleton /> : q.error ? <ErrorPanel error={q.error} onRetry={() => void q.refetch()} /> : d && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Button disabled={!d.enabled || m.isPending} onClick={() => m.mutate({ data: { idempotencyKey: idem.key } }, { onSuccess: () => { idem.rotate(); void invalidate(); } })} data-testid="button-prepare-anchor"><AnchorIcon className="mr-1.5 h-4 w-4" />{m.isPending ? 'Preparing' : 'Prepare anchor for latest checkpoint'}</Button>
              {!d.enabled && <span className="text-xs text-muted-foreground">Anchoring is disabled on this installation.</span>}
            </div>
            <MutationError error={m.error} />
            {!d.anchors.length ? <Empty title="No anchors">Prepare one to get a memo you can write on-chain.</Empty> : (
              <ul className="space-y-3">{d.anchors.map((a) => <AnchorRow key={a.id} a={a} />)}</ul>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}

function AnchorRow({ a }: { a: Anchor }) {
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const m = useRecordAnchor();
  const [sig, setSig] = useState('');
  const [network, setNetwork] = useState<AnchorRecordInputNetwork>('mainnet-beta');
  return (
    <li className="rounded-md border border-border p-4" data-testid={`row-anchor-${a.id}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Tag tone={a.status === 'prepared' ? 'neutral' : 'warn'}>{a.status.replace('_', ' ')}</Tag>
        <span>checkpoint <Hash value={a.checkpointHash} n={10} /></span>
        <span className="ml-auto text-muted-foreground">{fmtDate(a.createdAt)}</span>
      </div>
      <div className="mt-3">
        <div className="eyebrow mb-1">Memo to write</div>
        <div className="flex items-start gap-2"><code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1.5 font-mono text-[11px]" data-testid={`text-anchor-memo-${a.id}`}>{a.memo}</code><CopyButton value={a.memo} testId={`button-copy-memo-${a.id}`} /></div>
      </div>
      {a.status === 'prepared' ? (
        <form className="mt-3 grid gap-2 sm:grid-cols-[1fr_150px_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); m.mutate({ id: a.id, data: { txSignature: sig.trim(), network, idempotencyKey: idem.key } }, { onSuccess: () => { idem.rotate(); setSig(''); void invalidate(); } }); }}>
          <Field label="Transaction signature" htmlFor={`tx-${a.id}`}><Input id={`tx-${a.id}`} className="font-mono text-xs" value={sig} onChange={(e) => setSig(e.target.value)} data-testid={`input-tx-${a.id}`} /></Field>
          <Field label="Network" htmlFor={`net-${a.id}`}>
            <select id={`net-${a.id}`} className={selectCls} value={network} onChange={(e) => setNetwork(e.target.value as AnchorRecordInputNetwork)} data-testid={`select-network-${a.id}`}>
              <option value="mainnet-beta">mainnet-beta</option><option value="devnet">devnet</option><option value="testnet">testnet</option>
            </select>
          </Field>
          <Button type="submit" disabled={sig.trim().length < 80 || sig.trim().length > 90 || m.isPending} data-testid={`button-record-anchor-${a.id}`}>{m.isPending ? 'Recording' : 'Record'}</Button>
          <div className="sm:col-span-3"><MutationError error={m.error} /></div>
        </form>
      ) : (
        <div className="mt-3 text-xs text-muted-foreground">{a.network} · tx <Hash value={a.txSignature ?? ''} n={10} /> · recorded {fmtDate(a.recordedAt)} · not verified by this server</div>
      )}
    </li>
  );
}
