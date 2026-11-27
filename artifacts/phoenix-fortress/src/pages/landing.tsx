import { Link } from 'wouter';
import { ArrowRight } from 'lucide-react';
import { Mark } from '@/components/app-shell';

const steps = [
  { n: '01', t: 'Register', d: 'Declare a user-owned JSON source, its retention window, and the cadence you expect your scheduler to push.' },
  { n: '02', t: 'Push', d: 'Your application sends JSON snapshots up to 256 KiB with a scoped credential. Each one gets a checksum and manifest.' },
  { n: '03', t: 'Plan', d: 'Request a dry-run restore plan. Review checksum, size and target before anything is written.' },
  { n: '04', t: 'Confirm', d: 'Type the exact phrase the plan returns. Nothing is staged by default, and nothing is staged silently.' },
  { n: '05', t: 'Stage', d: 'The payload lands in a new staging area. Export it as JSON or roll it back. Your source is never overwritten.' },
];

const limits = [
  ['Payloads', 'JSON only, 256 KiB maximum, from sources you have registered and confirmed you own.'],
  ['Scheduling', 'This server runs no scheduler and fetches nothing. Your application pushes; the vault marks datasets due or overdue.'],
  ['Retention', 'Applied when backups arrive or when an administrator runs a sweep. Manifest metadata is never deleted.'],
  ['Recovery', 'Staging only. No promotion to production, no overwrite of the source system.'],
  ['Integrity', 'Hash-chained ledger, checked on demand. The interface reports a result only after a verification runs.'],
  ['Production', 'Not verified. Diagnostics report this plainly until a separate production verification is recorded.'],
];

export default function Landing() {
  return (
    <div className="min-h-[100dvh]">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 md:px-10">
        <div className="flex items-center gap-2.5"><Mark /><span className="font-display text-lg">Phoenix Fortress</span></div>
        <nav className="flex items-center gap-2 text-sm">
          <Link href="/sign-in" className="rounded-md px-3 py-2 hover:bg-muted" data-testid="link-sign-in">Sign in</Link>
          <Link href="/sign-up" className="rounded-md bg-primary px-3.5 py-2 text-primary-foreground hover:opacity-90" data-testid="link-sign-up">Create vault</Link>
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl gap-10 px-5 pb-20 pt-12 md:grid-cols-[1.25fr_1fr] md:px-10 md:pt-20">
        <div>
          <div className="eyebrow rise mb-5">Application-data backup vault</div>
          <h1 className="rise rise-1 font-display text-5xl leading-[1.02] md:text-7xl">Evidence first.<br /><span className="italic text-primary">Then</span> recovery.</h1>
          <p className="rise rise-2 mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
            A vault for the JSON your applications depend on. Every snapshot is checksummed, every action is chained into a ledger, and every restore starts as a dry run you have to read and confirm by hand.
          </p>
          <div className="rise rise-3 mt-8 flex flex-wrap gap-3">
            <Link href="/sign-up" className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-3 text-primary-foreground hover:opacity-90" data-testid="link-hero-sign-up">Open a vault <ArrowRight className="h-4 w-4" /></Link>
            <Link href="/sign-in" className="inline-flex items-center rounded-md border border-border px-5 py-3 hover:bg-muted" data-testid="link-hero-sign-in">I already have one</Link>
          </div>
        </div>
        <div className="rise rise-4 self-end rounded-md border border-sidebar-border bg-sidebar p-5 font-mono text-[12px] leading-relaxed text-sidebar-foreground shadow-xl">
          <div className="mb-3 flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-sidebar-foreground/50"><span>restore plan</span><span>dry run</span></div>
          <div className="space-y-1">
            <div><span className="text-sidebar-foreground/45">backup  </span>the version you chose</div>
            <div><span className="text-sidebar-foreground/45">target  </span>a new staging label</div>
            <div><span className="text-sidebar-foreground/45">sha256  </span>shown before any write</div>
            <div><span className="text-sidebar-foreground/45">expires </span>plans are short-lived</div>
          </div>
          <div className="mt-4 border-t border-sidebar-border pt-3 text-sidebar-foreground/60">type the confirmation phrase to stage</div>
          <div className="mt-1 text-sidebar-primary">&gt; _</div>
        </div>
      </section>

      <section className="border-y border-border bg-card">
        <div className="mx-auto max-w-6xl px-5 py-16 md:px-10">
          <div className="eyebrow mb-3">The procedure</div>
          <h2 className="max-w-2xl font-display text-3xl md:text-4xl">Five deliberate steps. None of them automatic.</h2>
          <ol className="mt-10 grid gap-px overflow-hidden rounded-md border border-border bg-border md:grid-cols-5">
            {steps.map((s) => (
              <li key={s.n} className="bg-background p-5">
                <div className="font-mono text-xs text-primary">{s.n}</div>
                <div className="mt-3 font-display text-xl">{s.t}</div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-10 px-5 py-20 md:grid-cols-[1fr_1.6fr] md:px-10">
        <div>
          <div className="eyebrow mb-3">Stated plainly</div>
          <h2 className="font-display text-3xl md:text-4xl">What this vault does not promise.</h2>
          <p className="mt-4 text-muted-foreground">Backups fail in the gaps between what a tool claims and what it does. These are the edges, written down before you rely on it.</p>
        </div>
        <dl className="divide-y divide-border border-y border-border">
          {limits.map(([k, v]) => (
            <div key={k} className="grid gap-1 py-4 sm:grid-cols-[140px_1fr]">
              <dt className="font-mono text-xs uppercase tracking-wider text-primary">{k}</dt>
              <dd className="text-sm leading-relaxed">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="bg-sidebar text-sidebar-foreground">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 md:grid-cols-2 md:px-10">
          <div>
            <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-sidebar-foreground/50">Integration</div>
            <h2 className="font-display text-3xl text-sidebar-accent-foreground">Your scheduler, our ledger.</h2>
            <p className="mt-4 text-sidebar-foreground/75">Issue a credential scoped to one dataset with read, backup or restore permissions, valid for 1 to 90 days. Every write carries an idempotency key, so a retried push never creates a duplicate.</p>
          </div>
          <pre className="overflow-x-auto rounded-md border border-sidebar-border bg-sidebar-accent p-5 font-mono text-[12px] leading-relaxed">{`POST /api/v1/backups
Authorization: Bearer <scoped credential>
Content-Type: application/json

{
  "datasetId": "<registered id>",
  "data": { ...your JSON },
  "idempotencyKey": "<uuid per logical push>"
}`}</pre>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-20 text-center md:px-10">
        <h2 className="font-display text-4xl md:text-5xl">Start with an empty vault.</h2>
        <p className="mx-auto mt-4 max-w-lg text-muted-foreground">Signing up creates a personal tenant with you as administrator. There is no sample data; everything you see afterwards is yours.</p>
        <Link href="/sign-up" className="mt-8 inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-primary-foreground hover:opacity-90" data-testid="link-footer-sign-up">Create your vault <ArrowRight className="h-4 w-4" /></Link>
      </section>
      <footer className="border-t border-border py-6 text-center font-mono text-[11px] text-muted-foreground">Phoenix Fortress · production runtime not verified</footer>
    </div>
  );
}
