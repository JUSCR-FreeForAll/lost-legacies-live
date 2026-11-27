import { Fragment, type ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { useGetGuide } from '@workspace/api-client-react';
import { ErrorPanel, PageHeader, Panel, RowsSkeleton } from '@/components/kit';
import { qopts } from '@/lib/vault';

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
  let last = 0; let m: RegExpExecArray | null; let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('`')) out.push(<code key={k++} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{t.slice(1, -1)}</code>);
    else if (t.startsWith('**')) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>);
    else {
      const mm = /\[([^\]]+)\]\(([^)]+)\)/.exec(t)!;
      const safe = /^(https?:\/\/|\/)/.test(mm[2]) ? mm[2] : '#';
      out.push(<a key={k++} href={safe} className="text-primary underline underline-offset-2" target={safe.startsWith('http') ? '_blank' : undefined} rel="noreferrer">{mm[1]}</a>);
    }
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Markdown({ src }: { src: string }) {
  const lines = src.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0; let k = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.startsWith('```')) {
      const buf: string[] = []; i++;
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
      i++;
      blocks.push(<pre key={k++} className="overflow-x-auto rounded-md bg-sidebar p-4 font-mono text-xs leading-relaxed text-sidebar-foreground">{buf.join('\n')}</pre>);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)/.exec(l);
    if (h) {
      const lvl = h[1].length;
      const cls = lvl === 1 ? 'font-display text-3xl mt-2' : lvl === 2 ? 'font-display text-2xl mt-8 border-t border-border pt-6' : 'text-base font-semibold mt-5';
      blocks.push(<div key={k++} className={cls} role="heading" aria-level={lvl}>{inline(h[2])}</div>);
      i++; continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''));
      const Tag = ordered ? 'ol' : 'ul';
      blocks.push(<Tag key={k++} className={`${ordered ? 'list-decimal' : 'list-disc'} space-y-1 pl-5`}>{items.map((it, j) => <li key={j}>{inline(it)}</li>)}</Tag>);
      continue;
    }
    if (!l.trim()) { i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#|```|\s*([-*]|\d+\.)\s)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={k++}>{inline(para.join(' '))}</p>);
  }
  return <div className="space-y-3 text-[15px] leading-relaxed">{blocks.map((b, j) => <Fragment key={j}>{b}</Fragment>)}</div>;
}

export default function DocsPage() {
  const g = useGetGuide({ query: { ...qopts } });
  return (
    <>
      <PageHeader eyebrow="Integration & operations" title="Guide" actions={
        <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted" data-testid="link-openapi">
          Raw OpenAPI spec <ExternalLink className="h-3.5 w-3.5" />
        </a>
      }>Served live by the API, so it matches the limits this server actually enforces.</PageHeader>
      <Panel>
        {g.isLoading ? <RowsSkeleton rows={10} /> : g.error ? <ErrorPanel error={g.error} onRetry={() => void g.refetch()} /> : g.data?.markdown.trim() ? (
          <article className="mx-auto max-w-3xl" data-testid="text-guide"><Markdown src={g.data.markdown} /></article>
        ) : <p className="text-sm text-muted-foreground">The server returned an empty guide.</p>}
      </Panel>
    </>
  );
}
