import { useState } from 'react';
import { BellOff, CheckCheck, EyeOff, Languages } from 'lucide-react';
import { useListConsents, useSetConsent, useUpdateSafety, useListNotifications, useMarkNotificationsRead, type Consent, type SafetyInput } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Empty, ErrorPanel, InlineError, PageHeader, Panel, RowsSkeleton, Tag, selectCls } from '@/components/kit';
import { useIdentity } from '@/components/identity';
import { QuickExitButton } from '@/components/quick-exit';
import { cn } from '@/lib/utils';
import { fmtDate, qopts, relTime, useIdempotencyKey, useInvalidateAll } from '@/lib/vault';

const purposeTitle: Record<string, string> = {
  evidence_storage: 'Evidence storage', recovery_contacts: 'Recovery contacts', witness_sharing: 'Witness sharing',
  jsonld_import: 'JSON-LD import', seamcraft_import: 'Seamcraft import', juscr_ingest: 'JUSCR ingest', external_anchor: 'External anchoring',
};

export default function PrivacyPage() {
  return (
    <>
      <PageHeader eyebrow="Privacy & safety" title="What you have agreed to">
        Optional features stay off until you turn them on here, and you can withdraw at any time. Nothing on this site tracks you or asks for your location.
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <Consents />
        <div className="space-y-6"><SafetyPanel /><Notifications /></div>
      </div>
    </>
  );
}

function Consents() {
  const q = useListConsents({ query: { ...qopts } });
  return (
    <Panel title="Consent registry" meta="7 purposes">
      {q.isLoading ? <RowsSkeleton rows={7} /> : q.error ? <ErrorPanel error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.length ? <Empty title="No purposes reported" /> : (
        <ul className="divide-y divide-border">{q.data.map((c) => <ConsentRow key={c.purpose} c={c} />)}</ul>
      )}
    </Panel>
  );
}

function ConsentRow({ c }: { c: Consent }) {
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const m = useSetConsent();
  const granted = c.state === 'granted';
  const title = purposeTitle[c.purpose] ?? c.purpose;
  const [announce, setAnnounce] = useState('');
  // aria-disabled rather than disabled while saving: disabling the focused
  // switch would drop keyboard focus to the page body.
  const set = (on: boolean) => {
    if (m.isPending) return;
    m.mutate({ purpose: c.purpose, data: { state: on ? 'granted' : 'withdrawn', idempotencyKey: idem.key } }, {
      onSuccess: () => { idem.rotate(); void invalidate(); setAnnounce(`${title}: consent ${on ? 'granted' : 'withdrawn'}.`); },
    });
  };
  return (
    <li className="py-3.5" data-testid={`row-consent-${c.purpose}`}>
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{title}</span>
            <Tag tone={granted ? 'good' : c.state === 'withdrawn' ? 'warn' : 'neutral'}>{c.state.replace('_', ' ')}</Tag>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{c.description}</p>
          <div className="mt-1 font-mono text-[10px] text-muted-foreground">{c.purpose} · v{c.version}{c.updatedAt && ` · ${fmtDate(c.updatedAt)}`}</div>
        </div>
        <Switch checked={granted} aria-disabled={m.isPending || undefined} onCheckedChange={set} aria-label={`Consent for ${title}`} data-testid={`switch-consent-${c.purpose}`} />
      </div>
      <span role="status" className="sr-only">{announce}</span>
      <div className="mt-2"><InlineError error={m.error} /></div>
    </li>
  );
}

function SafetyPanel() {
  const { identity, refetch } = useIdentity();
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const m = useUpdateSafety();
  if (!identity) return <Panel title="Safety"><RowsSkeleton rows={3} /></Panel>;
  const save = (patch: Partial<Omit<SafetyInput, 'idempotencyKey'>>) => m.mutate({
    data: { safeMode: identity.safeMode, locale: identity.locale, notificationMode: identity.notificationMode, ...patch, idempotencyKey: idem.key },
  }, { onSuccess: () => { idem.rotate(); void invalidate(); refetch(); } });
  return (
    <Panel title="Safety">
      <div className="space-y-5">
        <Row icon={EyeOff} title="Safe Recovery mode" desc="Neutral page title ('Notes'), no notification counts, Quick exit kept prominent. For when someone may glance at your screen.">
          <Switch checked={identity.safeMode} aria-disabled={m.isPending || undefined} onCheckedChange={(v) => { if (!m.isPending) save({ safeMode: v }); }} aria-label="Safe Recovery mode" data-testid="switch-safe-mode" />
        </Row>
        <Row icon={Languages} title="Language" desc="Used for server messages and notices.">
          <select className={cn(selectCls, 'w-32')} value={identity.locale} disabled={m.isPending} onChange={(e) => save({ locale: e.target.value as 'en' | 'es' })} data-testid="select-locale">
            <option value="en">English</option><option value="es">Español</option>
          </select>
        </Row>
        <Row icon={BellOff} title="Notifications" desc="Suppressed keeps notices out of view entirely.">
          <select className={cn(selectCls, 'w-32')} value={identity.notificationMode} disabled={m.isPending} onChange={(e) => save({ notificationMode: e.target.value as 'in_app' | 'suppressed' })} data-testid="select-notification-mode">
            <option value="in_app">In app</option><option value="suppressed">Suppressed</option>
          </select>
        </Row>
        <InlineError error={m.error} />
        <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <div className="mb-2 flex items-center justify-between gap-2"><span className="font-medium text-foreground">Quick exit</span><QuickExitButton /></div>
          Press Escape twice, or use this button, to clear this tab's data and jump to a weather search. Back will not return here.
        </div>
      </div>
    </Panel>
  );
}

function Row({ icon: Icon, title, desc, children }: { icon: typeof EyeOff; title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-[10rem] flex-1"><div className="text-sm font-medium">{title}</div><p className="text-xs text-muted-foreground">{desc}</p></div>
      {children}
    </div>
  );
}

function Notifications() {
  const q = useListNotifications({ query: { ...qopts } });
  const idem = useIdempotencyKey();
  const invalidate = useInvalidateAll();
  const m = useMarkNotificationsRead();
  const [showRead, setShowRead] = useState(false);
  const unread = q.data?.filter((n) => !n.read).length ?? 0;
  const list = (q.data ?? []).filter((n) => showRead || !n.read);
  return (
    <Panel title="Notices" meta={<button type="button" className="hover:text-foreground" onClick={() => setShowRead(!showRead)} data-testid="button-toggle-read">{showRead ? 'Hide read' : 'Show read'}</button>}>
      {q.isLoading ? <RowsSkeleton rows={3} /> : q.error ? <ErrorPanel error={q.error} onRetry={() => void q.refetch()} /> : !list.length ? (
        <Empty title={unread ? 'Nothing to show' : 'All caught up'} />
      ) : (
        <ul className="divide-y divide-border">
          {list.map((n) => (
            <li key={n.id} className={cn('flex gap-3 py-2.5', n.read && 'opacity-60')} data-testid={`row-notification-${n.id}`}>
              <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read ? 'bg-border' : n.severity === 'critical' || n.severity === 'warning' ? 'bg-primary' : 'bg-verdigris')} />
              <div className="min-w-0 flex-1"><p className="text-sm">{n.text}</p><div className="text-[11px] text-muted-foreground">{relTime(n.createdAt)} · {n.severity}</div></div>
            </li>
          ))}
        </ul>
      )}
      <InlineError error={m.error} />
      {unread > 0 && (
        <Button size="sm" variant="outline" className="mt-3" disabled={m.isPending} onClick={() => m.mutate({ data: { idempotencyKey: idem.key } }, { onSuccess: () => { idem.rotate(); void invalidate(); } })} data-testid="button-mark-read">
          <CheckCheck className="mr-1.5 h-3.5 w-3.5" />Mark all read
        </Button>
      )}
    </Panel>
  );
}
