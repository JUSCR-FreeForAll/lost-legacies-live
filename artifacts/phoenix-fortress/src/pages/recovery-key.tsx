import { useState, type FormEvent } from 'react';
import { Download, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  useGetRecoveryStatus, useSetupRecoveryKey, useConfirmRecoveryKey, useRotateRecoveryKey, useConfirmRecoveryRotation,
  useRegenerateRecoveryCodes, useListSigners, downloadRecoveryPackage, type RecoveryKeyIssued,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorPanel, Field, Hash, InlineError, PageHeader, Panel, RowsSkeleton, Tag } from '@/components/kit';
import { CopyButton, SecretBox, downloadBlob, today } from '@/components/vault-kit';
import { useToast } from '@/hooks/use-toast';
import { fmtDate, qopts, relTime, useIdempotencyKey, useInvalidateAll } from '@/lib/vault';

export default function RecoveryKeyPage() {
  const st = useGetRecoveryStatus({ query: { ...qopts } });
  const s = st.data;
  return (
    <>
      <PageHeader eyebrow="Recovery" title="Recovery key & codes">
        Your recovery key and one-time codes are how you get back in if this device is lost. They are shown once, never stored in readable form, and cannot be retrieved later.
      </PageHeader>
      {st.isLoading ? <RowsSkeleton rows={5} /> : st.error ? <ErrorPanel error={st.error} onRetry={() => void st.refetch()} /> : s && (
        <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
          <div className="space-y-6">
            <Panel title="Recovery key" meta={<Tag tone={s.status === 'active' ? 'good' : s.status === 'pending' ? 'warn' : 'neutral'} testId="status-recovery-key">{s.status}</Tag>}>
              <KeyLifecycle status={s.status} pendingMode={s.pendingMode} pendingExpiresAt={s.pendingExpiresAt} fingerprint={s.fingerprint} />
            </Panel>
            <Panel title="One-time recovery codes" meta={s.codesTotal ? `${s.codesRemaining} of ${s.codesTotal} unused` : 'none issued'}>
              <Codes remaining={s.codesRemaining} total={s.codesTotal} createdAt={s.codesCreatedAt} />
            </Panel>
          </div>
          <div className="space-y-6">
            <PackagePanel />
            <Panel title="Contact quorum">
              <p className="text-sm text-muted-foreground">
                {s.policy.activeContacts} active contact{s.policy.activeContacts === 1 ? '' : 's'}; {s.policy.threshold} approval{s.policy.threshold === 1 ? '' : 's'} required, then a {s.policy.delayHours}-hour waiting period.
              </p>
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}

function KeyLifecycle({ status, pendingMode, pendingExpiresAt, fingerprint }: { status: string; pendingMode: string | null; pendingExpiresAt: string | null; fingerprint: string | null }) {
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const { toast } = useToast();
  const setup = useSetupRecoveryKey();
  const confirm = useConfirmRecoveryKey();
  const rotate = useRotateRecoveryKey();
  const confirmRot = useConfirmRecoveryRotation();
  const [issued, setIssued] = useState<RecoveryKeyIssued | null>(null);
  const [stage, setStage] = useState<'idle' | 'show' | 'retype'>('idle');
  const [retype, setRetype] = useState('');
  const [current, setCurrent] = useState('');
  const [rotating, setRotating] = useState(false);

  const mode = issued?.status === 'pending_rotation' || pendingMode === 'rotation' ? 'rotation' : 'setup';
  const onIssued = (r: RecoveryKeyIssued) => { idem.rotate(); setIssued(r); setStage('show'); setCurrent(''); setRotating(false); void invalidate(); };
  const done = () => { idem.rotate(); setIssued(null); setRetype(''); setStage('idle'); void invalidate(); toast({ title: 'Recovery key active', description: 'Keep it somewhere only you can reach.' }); };

  const submitConfirm = (e: FormEvent) => {
    e.preventDefault();
    const body = { data: { recoveryKey: retype.trim(), idempotencyKey: idem.key } };
    if (mode === 'rotation') confirmRot.mutate(body, { onSuccess: done });
    else confirm.mutate(body, { onSuccess: done });
  };

  if (stage === 'show' && issued) {
    return (
      <div className="space-y-4">
        <SecretBox title="Your recovery key" testId="recovery-key" values={[issued.recoveryKey]}
          note={<>Write it down or store it in a password manager now. Fingerprint {issued.fingerprint}. It must be confirmed before {fmtDate(issued.expiresAt)}, or it lapses.</>}
          dismissLabel="I have written it down" onDismiss={() => { setIssued({ ...issued, recoveryKey: '' }); setStage('retype'); }} />
      </div>
    );
  }

  // Server state wins: a rotation left pending (for example by an emergency
  // recovery on another page or device) must still be confirmable here.
  if (stage === 'retype' || status === 'pending' || pendingMode === 'rotation') {
    return (
      <form onSubmit={submitConfirm} className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {mode === 'rotation' ? 'A replacement key is pending. Your current key keeps working until you confirm it.' : 'Setup is pending.'} Type the key from where you stored it. This proves you kept a usable copy; it is not activated until you do.
          {pendingExpiresAt && <> Expires {relTime(pendingExpiresAt)}.</>}
        </p>
        <Field label="Re-type the recovery key" htmlFor="rk-retype">
          <Input id="rk-retype" autoComplete="off" spellCheck={false} value={retype} onChange={(e) => setRetype(e.target.value)} className="font-mono" placeholder="from your written copy" data-testid="input-recovery-key-confirm" />
        </Field>
        <InlineError error={confirm.error ?? confirmRot.error} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={retype.trim().length < 40 || confirm.isPending || confirmRot.isPending} data-testid="button-confirm-recovery-key"><ShieldCheck className="mr-1.5 h-4 w-4" />Confirm and activate</Button>
          {status === 'pending' && mode === 'setup' && <Button type="button" variant="ghost" onClick={() => setup.mutate(undefined, { onSuccess: onIssued })} disabled={setup.isPending} data-testid="button-reissue-recovery-key">Lost it? Issue a new one</Button>}
        </div>
        <InlineError error={setup.error} />
      </form>
    );
  }

  if (status === 'unconfigured') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">No recovery key yet. Creating one shows a long key exactly once; you will then type it back to prove you stored it.</p>
        <InlineError error={setup.error} />
        <Button onClick={() => setup.mutate(undefined, { onSuccess: onIssued })} disabled={setup.isPending} data-testid="button-setup-recovery-key"><KeyRound className="mr-1.5 h-4 w-4" />{setup.isPending ? 'Generating' : 'Create recovery key'}</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">Fingerprint</span>{fingerprint && <Hash value={fingerprint} n={12} testId="text-recovery-fingerprint" />}</div>
      {!rotating ? (
        <Button variant="outline" onClick={() => setRotating(true)} data-testid="button-start-rotate"><RefreshCw className="mr-1.5 h-4 w-4" />Rotate recovery key</Button>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); rotate.mutate({ data: { currentRecoveryKey: current.trim(), idempotencyKey: idem.key } }, { onSuccess: onIssued }); }} className="space-y-3 rounded-md border border-border bg-muted/40 p-4">
          <p className="text-xs text-muted-foreground">Rotation needs the current key. The old key keeps working until you confirm the new one.</p>
          <Field label="Current recovery key" htmlFor="rk-current"><Input id="rk-current" autoComplete="off" spellCheck={false} className="font-mono" value={current} onChange={(e) => setCurrent(e.target.value)} data-testid="input-current-recovery-key" /></Field>
          <InlineError error={rotate.error} />
          <div className="flex gap-2"><Button type="submit" disabled={current.trim().length < 40 || rotate.isPending} data-testid="button-rotate-recovery-key">{rotate.isPending ? 'Rotating' : 'Issue new key'}</Button><Button type="button" variant="ghost" onClick={() => { setRotating(false); setCurrent(''); }}>Cancel</Button></div>
        </form>
      )}
    </div>
  );
}

function Codes({ remaining, total, createdAt }: { remaining: number; total: number; createdAt: string | null }) {
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const m = useRegenerateRecoveryCodes();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [armed, setArmed] = useState(false);
  if (codes) {
    return <SecretBox title="Recovery codes" numbered testId="recovery-codes" values={codes} filename={`phoenix-fortress-codes-${today()}.txt`}
      note="Each code works once, for emergency sign-in from a new device. Any older codes stopped working just now." onDismiss={() => setCodes(null)} />;
  }
  return (
    <div className="space-y-3">
      {total > 0 && (
        <div>
          <div className="mb-1.5 flex gap-1">{Array.from({ length: total }).map((_, i) => <span key={i} className={`h-1.5 flex-1 rounded-full ${i < remaining ? 'bg-verdigris' : 'bg-border'}`} />)}</div>
          <p className="text-xs text-muted-foreground">Issued {fmtDate(createdAt)}. {remaining <= 3 && remaining > 0 ? 'Running low; consider a new set.' : remaining === 0 ? 'All used. Generate a new set.' : ''}</p>
        </div>
      )}
      {armed && total > 0 && <p className="rounded border border-ochre/30 bg-ochre/10 px-3 py-2 text-xs">Generating a new set immediately invalidates all {remaining} unused codes from the current set.</p>}
      <InlineError error={m.error} />
      <div className="flex gap-2">
        <Button variant={armed || total === 0 ? 'default' : 'outline'} disabled={m.isPending} data-testid="button-regenerate-codes"
          onClick={() => { if (total > 0 && !armed) { setArmed(true); return; } m.mutate({ data: { idempotencyKey: idem.key } }, { onSuccess: (r) => { idem.rotate(); setArmed(false); setCodes(r.codes); void invalidate(); } }); }}>
          {m.isPending ? 'Generating' : total === 0 ? 'Generate 10 codes' : armed ? 'Yes, replace my codes' : 'Generate a new set'}
        </Button>
        {armed && <Button variant="ghost" onClick={() => setArmed(false)}>Cancel</Button>}
      </div>
    </div>
  );
}

function PackagePanel() {
  const sg = useListSigners({ query: { ...qopts } });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const key = sg.data?.installationKey ?? '';
  const file = `phoenix-fortress-${today()}.pfr`;
  const cmd = `node pfr-verify.mjs ${file} --trust-key ${key || '<installation-key>'}`;
  const dl = async () => {
    setBusy(true); setErr(null);
    try { const b = await downloadRecoveryPackage({ responseType: 'blob' }); downloadBlob(file, b); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <Panel title="Offline recovery package">
      <p className="mb-3 text-sm text-muted-foreground">A signed file you can keep on a USB stick or print. It holds the signed ledger plus your backups and evidence, still encrypted. It can be verified without this server, and restored offline with your recovery key.</p>
      <Button onClick={() => void dl()} disabled={busy} data-testid="button-download-package"><Download className="mr-1.5 h-4 w-4" />{busy ? 'Preparing' : 'Download .pfr'}</Button>
      <div className="mt-2"><InlineError error={err} /></div>
      <div className="mt-5 space-y-3 border-t border-border pt-4">
        <div>
          <div className="eyebrow mb-1">Installation trust key</div>
          {sg.isLoading ? <RowsSkeleton rows={1} /> : sg.error ? <InlineError error={sg.error} /> : (
            <div className="flex items-center gap-2"><code className="min-w-0 flex-1 break-all font-mono text-xs" data-testid="text-installation-key">{key}</code><CopyButton value={key} testId="button-copy-trust-key" /></div>
          )}
        </div>
        <div>
          <div className="eyebrow mb-1">Verify offline</div>
          <div className="flex items-start gap-2"><code className="min-w-0 flex-1 break-all rounded bg-sidebar px-3 py-2 font-mono text-[11px] text-sidebar-foreground" data-testid="text-verify-command">{cmd}</code><CopyButton value={cmd} testId="button-copy-verify-command" /></div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">Record the trust key separately from the file. A package that verifies against a key you got from the same place proves little.</p>
        </div>
      </div>
    </Panel>
  );
}
