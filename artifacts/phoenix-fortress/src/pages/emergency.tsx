import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'wouter';
import { KeySquare, LogOut, Unplug } from 'lucide-react';
import { useEmergencyRecover, useRevokeSessions, useRevokeAllCredentials, type EmergencyResult, type SessionRevocation } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Field, InlineError, PageHeader, Panel } from '@/components/kit';
import { Consequences } from '@/components/vault-kit';
import { EmergencyResultView } from '@/components/emergency-result';
import { fmtDate, useIdempotencyKey, useInvalidateAll } from '@/lib/vault';

export default function EmergencyPage() {
  return (
    <>
      <PageHeader eyebrow="Lost or stolen device" title="Lock the vault down">
        Take these steps in order if a phone or laptop is out of your hands. Each one says exactly what it does before it runs. None of them delete your backups.
      </PageHeader>
      <ol className="space-y-6">
        <Step n="1" title="Sign out everywhere else"><SignOutOthers /></Step>
        <Step n="2" title="Revoke every API credential"><RevokeAll /></Step>
        <Step n="3" title="Recover with a saved code"><CodeRecovery /></Step>
      </ol>
      <p className="mt-8 text-sm text-muted-foreground">No codes? Your recovery contacts can approve a delayed recovery from <Link href="/contacts" className="text-primary underline underline-offset-2">Recovery contacts</Link>.</p>
    </>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <li className="rise grid gap-4 md:grid-cols-[56px_1fr]">
      <div className="hidden font-display text-4xl text-primary/70 md:block">{n}</div>
      <Panel title={<span><span className="mr-2 font-mono text-xs text-primary md:hidden">{n}</span>{title}</span>}>{children}</Panel>
    </li>
  );
}

function Confirm({ open, onOpenChange, title, body, action, pending, error, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; body: string; action: string; pending: boolean; error: unknown; onConfirm: () => void }) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle className="font-display font-medium">{title}</AlertDialogTitle><AlertDialogDescription>{body}</AlertDialogDescription></AlertDialogHeader>
        <InlineError error={error} />
        <AlertDialogFooter>
          <AlertDialogCancel>Not now</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={(e) => { e.preventDefault(); onConfirm(); }} data-testid="button-confirm-action">{pending ? 'Working' : action}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function SignOutOthers() {
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const m = useRevokeSessions();
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState<SessionRevocation | null>(null);
  return (
    <div className="space-y-4">
      <Consequences items={['Every other browser and device signed in to this account is signed out.', 'This browser stays signed in.', 'Anyone holding a stolen device would need your password again.']} />
      {res ? (
        <p className="rounded border border-verdigris/30 bg-verdigris/10 px-3 py-2 text-sm" data-testid="status-sessions-revoked">Done at {fmtDate(res.revokedAt)}. {res.providerSessionsRevoked} session{res.providerSessionsRevoked === 1 ? '' : 's'} ended via {res.provider}.</p>
      ) : (
        <Button onClick={() => setOpen(true)} data-testid="button-revoke-sessions"><LogOut className="mr-1.5 h-4 w-4" />Sign out everywhere else</Button>
      )}
      <Confirm open={open} onOpenChange={setOpen} title="Sign out all other sessions?" body="Other devices will be signed out immediately. You stay signed in here." action="Sign them out" pending={m.isPending} error={m.error}
        onConfirm={() => m.mutate({ data: { idempotencyKey: idem.key } }, { onSuccess: (r) => { idem.rotate(); setRes(r); setOpen(false); void invalidate(); } })} />
    </div>
  );
}

function RevokeAll() {
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const m = useRevokeAllCredentials();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  return (
    <div className="space-y-4">
      <Consequences items={['Every ingest and export token stops working at once.', 'Schedulers pushing backups will fail until you issue new credentials in Settings.', 'This cannot be undone; revoked tokens never come back.']} />
      {count !== null ? (
        <p className="rounded border border-verdigris/30 bg-verdigris/10 px-3 py-2 text-sm" data-testid="status-credentials-revoked">{count} credential{count === 1 ? '' : 's'} revoked.</p>
      ) : (
        <Button variant="outline" onClick={() => setOpen(true)} data-testid="button-revoke-all-credentials"><Unplug className="mr-1.5 h-4 w-4" />Revoke all credentials</Button>
      )}
      <Confirm open={open} onOpenChange={setOpen} title="Revoke every credential?" body="All active API tokens for this vault will be rejected from now on. Backups already stored are untouched." action="Revoke all" pending={m.isPending} error={m.error}
        onConfirm={() => m.mutate({ data: { idempotencyKey: idem.key } }, { onSuccess: (r) => { idem.rotate(); setCount(r.count); setOpen(false); void invalidate(); } })} />
    </div>
  );
}

function CodeRecovery() {
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const m = useEmergencyRecover();
  const [code, setCode] = useState('');
  const [res, setRes] = useState<EmergencyResult | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate({ data: { recoveryCode: code.trim(), idempotencyKey: idem.key } }, { onSuccess: (r) => { idem.rotate(); setCode(''); setRes(r); void invalidate(); } });
  };
  if (res) return <EmergencyResultView res={res} onChange={setRes} />;
  return (
    <form onSubmit={submit} className="space-y-4">
      <Consequences items={['Uses up one saved recovery code.', 'Signs out every session and revokes every API credential.', 'Issues a replacement recovery key and a fresh set of codes, each shown once.']} />
      <Field label="Recovery code" htmlFor="em-code" hint="From your printed or saved list. Spaces and dashes as written are fine.">
        <Input id="em-code" autoComplete="off" spellCheck={false} className="font-mono" value={code} onChange={(e) => setCode(e.target.value)} data-testid="input-recovery-code" />
      </Field>
      <InlineError error={m.error} />
      <Button type="submit" disabled={code.trim().length < 16 || m.isPending} data-testid="button-emergency-recover"><KeySquare className="mr-1.5 h-4 w-4" />{m.isPending ? 'Recovering' : 'Recover with this code'}</Button>
    </form>
  );
}
