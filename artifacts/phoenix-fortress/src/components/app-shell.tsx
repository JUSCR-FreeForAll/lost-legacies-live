import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { useClerk, useUser } from '@clerk/react';
import { Archive, BookOpen, Database, EyeOff, FileLock2, KeyRound, LayoutGrid, LogOut, Menu, ScrollText, Settings, ShieldCheck, Siren, Stethoscope, Undo2, Users, Waypoints, X } from 'lucide-react';
import { useGetOverview } from '@workspace/api-client-react';
import { QuickExitButton } from '@/components/quick-exit';
import { qopts } from '@/lib/vault';
import { cn } from '@/lib/utils';
import { useIdentity } from '@/components/identity';
import { ErrorPanel, selectCls } from '@/components/kit';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

type NavItem = { href: string; label: string; icon: typeof LayoutGrid; admin?: boolean; badge?: 'notices' };
const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Vault', items: [
    { href: '/overview', label: 'Overview', icon: LayoutGrid },
    { href: '/datasets', label: 'Datasets', icon: Database },
    { href: '/backups', label: 'Backups', icon: Archive },
    { href: '/recovery', label: 'Restore', icon: Undo2 },
    { href: '/evidence', label: 'Evidence locker', icon: FileLock2 },
  ] },
  { group: 'Get back in', items: [
    { href: '/emergency', label: 'Lost device', icon: Siren },
    { href: '/recovery-key', label: 'Recovery key', icon: KeyRound },
    { href: '/contacts', label: 'Recovery contacts', icon: Users },
  ] },
  { group: 'Proof', items: [
    { href: '/audit', label: 'Audit ledger', icon: ScrollText },
    { href: '/resilience', label: 'Integrity & peers', icon: ShieldCheck },
    { href: '/interop', label: 'Interop', icon: Waypoints },
  ] },
  { group: 'You', items: [
    { href: '/privacy', label: 'Privacy & safety', icon: EyeOff, badge: 'notices' },
    { href: '/settings', label: 'Settings', icon: Settings, admin: true },
    { href: '/diagnostics', label: 'Diagnostics', icon: Stethoscope, admin: true },
    { href: '/docs', label: 'Guide', icon: BookOpen },
  ] },
];
const TITLES: Record<string, string> = Object.fromEntries(NAV.flatMap((g) => g.items.map((i) => [i.href, i.label])));

export function Mark({ className }: { className?: string }) {
  return <img src={`${basePath}/logo.svg`} alt="" className={cn('h-7 w-7', className)} />;
}

export function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const { signOut } = useClerk();
  const { user } = useUser();
  const { identity, error, refetch, tenant, switchTenant, isAdmin } = useIdentity();
  const safe = identity?.safeMode ?? false;
  const ov = useGetOverview({ query: { ...qopts } });
  const unread = !safe && identity?.notificationMode !== 'suppressed' ? ov.data?.unreadNotifications ?? 0 : 0;
  useEffect(() => {
    document.title = safe ? 'Notes' : `${TITLES[location] ?? 'Vault'} · Phoenix Fortress`;
  }, [safe, location]);

  const sidebar = (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <Mark />
        <div>
          <div className="font-display text-[17px] leading-none text-sidebar-accent-foreground">Phoenix Fortress</div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-sidebar-foreground/50">JSON data vault</div>
        </div>
      </div>
      <div className="px-4 pb-2"><QuickExitButton className="w-full justify-center" prominent={safe} /></div>
      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-2">
        {NAV.map((g) => {
          const items = g.items.filter((n) => !n.admin || isAdmin);
          if (!items.length) return null;
          return (
            <div key={g.group}>
              <div className="mb-1 px-3 font-mono text-[9.5px] uppercase tracking-[0.18em] text-sidebar-foreground/35">{g.group}</div>
              <div className="space-y-0.5">
                {items.map((n) => {
                  const active = location === n.href;
                  return (
                    <Link
                      key={n.href}
                      href={n.href}
                      onClick={() => setOpen(false)}
                      data-testid={`link-nav-${n.href.slice(1)}`}
                      className={cn(
                        'group flex items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-colors',
                        active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                        n.href === '/emergency' && !active && 'text-sidebar-primary/90',
                      )}
                    >
                      <n.icon className={cn('h-4 w-4', active && 'text-sidebar-primary')} />
                      {n.label}
                      {n.badge === 'notices' && unread > 0 && <span className="ml-auto rounded-sm bg-sidebar-primary px-1.5 font-mono text-[10px] text-sidebar-primary-foreground" data-testid="badge-unread">{unread}</span>}
                      {active && !(n.badge === 'notices' && unread > 0) && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-sidebar-primary" />}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="space-y-3 border-t border-sidebar-border px-4 py-4 text-xs">
        {identity && identity.tenants.length > 1 && (
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-sidebar-foreground/50" htmlFor="tenant">Tenant</label>
            <select
              id="tenant"
              data-testid="select-tenant"
              className={cn(selectCls, 'h-8 border-sidebar-border bg-sidebar-accent text-xs text-sidebar-accent-foreground')}
              value={tenant ?? ''}
              onChange={(e) => switchTenant(e.target.value || null)}
            >
              <option value="">Default (personal)</option>
              {identity.tenants.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sidebar-accent-foreground" data-testid="text-user">{user?.primaryEmailAddress?.emailAddress ?? user?.username ?? identity?.userId ?? 'Signed in'}</div>
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-sidebar-foreground/50" data-testid="text-role">
              {identity ? `${identity.role} · ${shortT(identity.tenantId)}` : 'resolving role'}
            </div>
          </div>
          <button
            type="button"
            data-testid="button-sign-out"
            onClick={() => signOut({ redirectUrl: basePath || '/' })}
            className="rounded p-1.5 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
        <div className="rounded border border-sidebar-border px-2 py-1.5 font-mono text-[10px] leading-snug text-sidebar-foreground/55">
          Production runtime not verified. Treat evidence here as development-grade.
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-[100dvh]">
      <aside className="sticky top-0 hidden h-[100dvh] w-64 shrink-0 md:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-foreground/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72">{sidebar}</div>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-background/90 px-4 py-3 backdrop-blur md:hidden">
          <div className="flex items-center gap-2"><Mark className="h-6 w-6" /><span className="font-display">{safe ? 'Notes' : 'Phoenix Fortress'}</span></div>
          <div className="flex items-center gap-2"><QuickExitButton prominent={safe} />
          <button type="button" onClick={() => setOpen(!open)} data-testid="button-menu" className="rounded p-1.5 hover:bg-muted">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button></div>
        </div>
        <main className="mx-auto max-w-6xl px-4 py-8 md:px-10 md:py-10">
          {error ? (
            <ErrorPanel error={error} onRetry={refetch} label="Could not resolve your identity and tenant" />
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}

function shortT(t: string) {
  return t.length > 14 ? `${t.slice(0, 10)}…` : t;
}
