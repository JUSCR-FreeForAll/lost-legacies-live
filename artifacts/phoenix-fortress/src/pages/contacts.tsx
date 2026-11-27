import { useEffect, useState, type FormEvent } from 'react';
import { HandHelping, UserPlus, Users } from 'lucide-react';
import {
  useListContacts, useAddContact, useRemoveContact, useUpdateRecoveryPolicy, useGetRecoveryStatus,
  useListCeremonies, useStartCeremony, useCancelCeremony, useCompleteCeremony, useListHelperRequests, useApproveHelperRequest,
  type Ceremony, type Contact, type EmergencyResult,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Empty, ErrorPanel, Field, PageHeader, Panel, RowsSkeleton, Tag } from '@/components/kit';
import { Countdown, MutationError, isConsentError } from '@/components/vault-kit';
import { EmergencyResultView } from '@/components/emergency-result';
import { useToast } from '@/hooks/use-toast';
import { fmtDate, qopts, relTime, useIdempotencyKey, useInvalidateAll } from '@/lib/vault';

export default function ContactsPage() {
  return (
    <>
      <PageHeader eyebrow="Recovery" title="Recovery contacts">
        People you trust can jointly approve getting you back in, after a waiting period you choose. They never see your vault data, and they are not told if you remove them.
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6"><ContactList /><Ceremonies /></div>
        <div className="space-y-6"><Policy /><HelperRequests /></div>
      </div>
    </>
  );
}

function ContactList() {
  const q = useListContacts({ query: { ...qopts } });
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const { toast } = useToast();
  const add = useAddContact();
  const [label, setLabel] = useState('');
  const [uid, setUid] = useState('');
  const [removing, setRemoving] = useState<Contact | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate({ data: { label: label.trim(), contactUserId: uid.trim(), idempotencyKey: idem.key } }, {
      onSuccess: (c) => { idem.rotate(); setLabel(''); setUid(''); void invalidate(); toast({ title: 'Contact added', description: c.label }); },
    });
  };
  const active = q.data?.filter((c) => c.status === 'active') ?? [];
  return (
    <Panel title="Your contacts" meta={q.data ? `${active.length} active` : undefined}>
      <form onSubmit={submit} className="mb-5 grid gap-2 sm:grid-cols-[1fr_1.3fr_auto] sm:items-end">
        <Field label="Label (only you see this)" htmlFor="ct-label"><Input id="ct-label" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Sister, Marisol" data-testid="input-contact-label" /></Field>
        <Field label="Their user ID" htmlFor="ct-uid"><Input id="ct-uid" maxLength={120} value={uid} onChange={(e) => setUid(e.target.value)} placeholder="user_2abc…" className="font-mono" data-testid="input-contact-user-id" /></Field>
        <Button type="submit" disabled={!label.trim() || uid.trim().length < 3 || add.isPending} data-testid="button-add-contact"><UserPlus className="mr-1.5 h-4 w-4" />Add</Button>
      </form>
      <MutationError error={add.error} />
      {q.isLoading ? <RowsSkeleton /> : q.error ? (isConsentError(q.error) ? <MutationError error={q.error} /> : <ErrorPanel error={q.error} onRetry={() => void q.refetch()} />) : !q.data?.length ? (
        <Empty title="No contacts yet">Add two or three people you would call from a borrowed phone.</Empty>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {q.data.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2.5" data-testid={`row-contact-${c.id}`}>
              <div className="min-w-0"><div className="text-sm font-medium">{c.label}</div><div className="truncate font-mono text-[11px] text-muted-foreground">{c.contactUserId} · added {fmtDate(c.createdAt)}</div></div>
              <div className="flex items-center gap-2">
                <Tag tone={c.status === 'active' ? 'good' : 'neutral'}>{c.status}</Tag>
                {c.status === 'active' && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setRemoving(c)} data-testid={`button-remove-contact-${c.id}`}>Remove</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {removing && <RemoveContact c={removing} onClose={() => setRemoving(null)} />}
    </Panel>
  );
}

function RemoveContact({ c, onClose }: { c: Contact; onClose: () => void }) {
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const m = useRemoveContact();
  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle className="font-display font-medium">Remove {c.label}?</AlertDialogTitle>
          <AlertDialogDescription>They will no longer be able to approve a recovery. They are not notified. Any approval they gave to a pending ceremony stops counting.</AlertDialogDescription></AlertDialogHeader>
        <MutationError error={m.error} />
        <AlertDialogFooter><AlertDialogCancel>Keep</AlertDialogCancel>
          <AlertDialogAction disabled={m.isPending} data-testid="button-confirm-remove-contact" onClick={(e) => { e.preventDefault(); m.mutate({ id: c.id, data: { idempotencyKey: idem.key } }, { onSuccess: () => { idem.rotate(); void invalidate(); onClose(); } }); }}>{m.isPending ? 'Removing' : 'Remove quietly'}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Policy() {
  const st = useGetRecoveryStatus({ query: { ...qopts } });
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const { toast } = useToast();
  const m = useUpdateRecoveryPolicy();
  const [threshold, setThreshold] = useState('2');
  const [delay, setDelay] = useState('72');
  const p = st.data?.policy;
  useEffect(() => { if (p) { setThreshold(String(p.threshold)); setDelay(String(p.delayHours)); } }, [p?.threshold, p?.delayHours]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = Number(threshold), d = Number(delay);
  const valid = Number.isInteger(t) && t >= 1 && t <= 10 && Number.isInteger(d) && d >= 24 && d <= 720;
  return (
    <Panel title="Quorum policy">
      {st.isLoading ? <RowsSkeleton rows={2} /> : st.error ? <ErrorPanel error={st.error} onRetry={() => void st.refetch()} /> : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); m.mutate({ data: { threshold: t, delayHours: d, idempotencyKey: idem.key } }, { onSuccess: () => { idem.rotate(); void invalidate(); toast({ title: 'Policy saved' }); } }); }}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Approvals needed" htmlFor="pol-t" hint="1 to 10"><Input id="pol-t" type="number" min={1} max={10} value={threshold} onChange={(e) => setThreshold(e.target.value)} data-testid="input-policy-threshold" /></Field>
            <Field label="Waiting period (hours)" htmlFor="pol-d" hint="At least 24, at most 720"><Input id="pol-d" type="number" min={24} max={720} value={delay} onChange={(e) => setDelay(e.target.value)} data-testid="input-policy-delay" /></Field>
          </div>
          <p className="text-xs text-muted-foreground">The delay gives you time to notice and cancel a recovery you did not start. {p && t > p.activeContacts && <span className="text-ochre">You have only {p.activeContacts} active contact{p.activeContacts === 1 ? '' : 's'}.</span>}</p>
          <MutationError error={m.error} />
          <Button type="submit" disabled={!valid || m.isPending} data-testid="button-save-policy">{m.isPending ? 'Saving' : 'Save policy'}</Button>
        </form>
      )}
    </Panel>
  );
}

function Ceremonies() {
  const q = useListCeremonies({ query: { ...qopts } });
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const start = useStartCeremony();
  const pending = q.data?.some((c) => c.status === 'pending');
  // The completion result carries a replacement key and codes shown only once.
  const [result, setResult] = useState<EmergencyResult | null>(null);
  if (result) {
    return (
      <Panel title="Recovery completed">
        <EmergencyResultView res={result} onChange={setResult} />
        {!result.recoveryKey && result.newCodes.length === 0 && (
          <Button size="sm" variant="ghost" className="mt-3" onClick={() => setResult(null)} data-testid="button-close-ceremony-result">Back to ceremonies</Button>
        )}
      </Panel>
    );
  }
  return (
    <Panel title="Recovery ceremonies" meta={!pending && <Button size="sm" variant="outline" disabled={start.isPending} onClick={() => start.mutate({ data: { idempotencyKey: idem.key } }, { onSuccess: () => { idem.rotate(); void invalidate(); } })} data-testid="button-start-ceremony"><Users className="mr-1.5 h-3.5 w-3.5" />Start ceremony</Button>}>
      <MutationError error={start.error} />
      {q.isLoading ? <RowsSkeleton rows={2} /> : q.error ? (isConsentError(q.error) ? <MutationError error={q.error} /> : <ErrorPanel error={q.error} onRetry={() => void q.refetch()} />) : !q.data?.length ? (
        <Empty title="No ceremonies">Start one only when you cannot use your recovery key or codes. Your contacts then approve from their own accounts.</Empty>
      ) : (
        <ul className="space-y-3">{q.data.map((c) => <CeremonyRow key={c.id} c={c} onCompleted={setResult} />)}</ul>
      )}
    </Panel>
  );
}

function CeremonyRow({ c, onCompleted }: { c: Ceremony; onCompleted: (r: EmergencyResult) => void }) {
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const cancel = useCancelCeremony();
  const complete = useCompleteCeremony();
  const ready = c.approvals >= c.threshold && new Date(c.readyAt).getTime() <= Date.now();
  const tone = c.status === 'completed' ? 'good' : c.status === 'pending' ? 'warn' : 'neutral';
  const ok = () => { idem.rotate(); void invalidate(); };
  return (
    <li className="rounded-md border border-border p-3" data-testid={`row-ceremony-${c.id}`}>
      <div className="flex items-center justify-between gap-2"><Tag tone={tone}>{c.status}</Tag><span className="text-xs text-muted-foreground">started {relTime(c.createdAt)}</span></div>
      <div className="mt-3 flex items-center gap-3">
        <div className="flex gap-1">{Array.from({ length: c.threshold }).map((_, i) => <span key={i} className={`h-2.5 w-6 rounded-sm ${i < c.approvals ? 'bg-verdigris' : 'bg-border'}`} />)}</div>
        <span className="font-mono text-xs" data-testid={`text-approvals-${c.id}`}>{c.approvals}/{c.threshold} approvals</span>
      </div>
      {c.status === 'pending' && (
        <>
          <div className="mt-2 text-xs text-muted-foreground">Waiting period ends in <Countdown to={c.readyAt} /> · expires {fmtDate(c.expiresAt)}</div>
          <MutationError error={cancel.error ?? complete.error} />
          <div className="mt-3 flex gap-2">
            <Button size="sm" disabled={!ready || complete.isPending} onClick={() => complete.mutate({ id: c.id, data: { idempotencyKey: idem.key } }, { onSuccess: (r) => { ok(); onCompleted(r); } })} data-testid={`button-complete-ceremony-${c.id}`}>Complete recovery</Button>
            <Button size="sm" variant="ghost" className="text-destructive" disabled={cancel.isPending} onClick={() => cancel.mutate({ id: c.id, data: { idempotencyKey: idem.key } }, { onSuccess: ok })} data-testid={`button-cancel-ceremony-${c.id}`}>Cancel</Button>
          </div>
        </>
      )}
      {c.completedAt && <div className="mt-2 text-xs text-muted-foreground">Completed {fmtDate(c.completedAt)}</div>}
    </li>
  );
}

function HelperRequests() {
  const q = useListHelperRequests({ query: { ...qopts } });
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const m = useApproveHelperRequest();
  return (
    <Panel title={<span className="inline-flex items-center gap-2"><HandHelping className="h-4 w-4 text-primary" />Requests for my help</span>}>
      <p className="mb-3 text-xs text-muted-foreground">When someone named you as a contact starts a recovery, it appears here. Only approve if they asked you directly, by a channel you trust.</p>
      <MutationError error={m.error} />
      {q.isLoading ? <RowsSkeleton rows={2} /> : q.error ? <ErrorPanel error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.length ? (
        <Empty title="Nobody needs you right now" />
      ) : (
        <ul className="divide-y divide-border">
          {q.data.map((h) => (
            <li key={h.ceremonyId} className="flex items-center justify-between gap-3 py-2.5" data-testid={`row-helper-${h.ceremonyId}`}>
              <div className="min-w-0 text-sm"><div className="font-medium">{h.contactLabel}</div><div className="text-[11px] text-muted-foreground">{h.status} · ready {relTime(h.readyAt)} · expires {fmtDate(h.expiresAt)}</div></div>
              {h.approved ? <Tag tone="good">approved</Tag> : (
                <Button size="sm" disabled={m.isPending} onClick={() => m.mutate({ id: h.ceremonyId, data: { idempotencyKey: idem.key } }, { onSuccess: () => { idem.rotate(); void invalidate(); } })} data-testid={`button-approve-${h.ceremonyId}`}>Approve</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
