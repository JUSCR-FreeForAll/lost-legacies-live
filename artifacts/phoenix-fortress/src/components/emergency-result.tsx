import { useEffect, useRef } from 'react';
import { Link } from 'wouter';
import type { EmergencyResult } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { SecretBox, today } from '@/components/vault-kit';
import { fmtDate } from '@/lib/vault';

/**
 * Outcome of an account-takeover reset (recovery code or contact ceremony).
 * The replacement key and codes exist only in the caller's state and are
 * cleared on dismiss; the server never returns them again.
 */
export function EmergencyResultView({ res, onChange }: { res: EmergencyResult; onChange: (next: EmergencyResult) => void }) {
  // Keep keyboard and screen reader focus on whatever needs attention next:
  // the key, then the codes, then the completion message. The button that
  // caused each step disappears, so focus would otherwise fall to the page.
  const ref = useRef<HTMLDivElement>(null);
  const hasKey = Boolean(res.recoveryKey);
  const hasCodes = res.newCodes.length > 0;
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const target = root.querySelector<HTMLElement>('[data-secret-box]') ?? root.querySelector<HTMLElement>('[data-result-done]');
    target?.focus();
  }, [hasKey, hasCodes]);
  return (
    <div ref={ref} className="space-y-4" data-testid="status-emergency-result">
      <div className="grid gap-px overflow-hidden rounded-md border border-border bg-border text-sm sm:grid-cols-3">
        <div className="bg-card p-3"><div className="eyebrow">Method</div><div className="mt-1 font-mono text-xs">{res.method}</div></div>
        <div className="bg-card p-3"><div className="eyebrow">Sessions</div><div className="mt-1">{res.sessionsRevoked ? 'All signed out' : 'Unchanged'}</div></div>
        <div className="bg-card p-3"><div className="eyebrow">Credentials revoked</div><div className="mt-1 font-mono">{res.credentialsRevoked}</div></div>
      </div>
      {res.providerRevocationPending && (
        <p className="rounded-md border border-border bg-muted/40 p-3 text-sm" role="status" data-testid="text-provider-pending">
          Other sessions are already blocked here, but the sign-in provider has not confirmed ending all of them yet. It keeps retrying automatically.
        </p>
      )}
      {res.recoveryKey && (
        <SecretBox title="Replacement recovery key" testId="emergency-recovery-key" values={[res.recoveryKey]}
          note={<>Fingerprint {res.fingerprint}. Confirm it on the Recovery key page before {fmtDate(res.expiresAt)}.</>}
          focusOnMount={false} onDismiss={() => onChange({ ...res, recoveryKey: null })} />
      )}
      {res.newCodes.length > 0 && (
        <SecretBox title="New recovery codes" numbered testId="emergency-codes" values={res.newCodes} filename={`phoenix-fortress-codes-${today()}.txt`}
          note="Your previous codes no longer work. Store these somewhere the lost device cannot reach." focusOnMount={false} onDismiss={() => onChange({ ...res, newCodes: [] })} />
      )}
      {!res.recoveryKey && res.newCodes.length === 0 && (
        <div className="flex items-center justify-between gap-3">
          <p tabIndex={-1} data-result-done className="text-sm text-muted-foreground focus:outline-none">Recovery complete. {res.fingerprint ? 'Finish confirming your replacement key next.' : ''}</p>
          <Button asChild variant="outline" size="sm"><Link href="/recovery-key" data-testid="link-confirm-replacement-key">Go to recovery key</Link></Button>
        </div>
      )}
    </div>
  );
}
