import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';

const EXIT_URL = 'https://www.google.com/search?q=weather';

export function quickExit(qc: QueryClient) {
  try { qc.clear(); } catch { /* ignore */ }
  try { sessionStorage.clear(); } catch { /* ignore */ }
  document.title = 'Weather';
  window.location.replace(EXIT_URL);
}

/** Global: pressing Escape twice within one second leaves immediately. */
export function QuickExitListener() {
  const qc = useQueryClient();
  const last = useRef(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const now = Date.now();
      if (now - last.current < 1000) quickExit(qc);
      last.current = now;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [qc]);
  return null;
}

export function QuickExitButton({ className, prominent }: { className?: string; prominent?: boolean }) {
  const qc = useQueryClient();
  return (
    <button
      type="button"
      onClick={() => quickExit(qc)}
      data-testid="button-quick-exit"
      title="Leave immediately (or press Esc twice)"
      aria-label="Quick exit: leave this site now. Shortcut: press Escape twice."
      className={cn(
        'inline-flex items-center gap-2 rounded-md border font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        prominent
          ? 'border-primary bg-primary px-3.5 py-2 text-sm text-primary-foreground hover:bg-primary/90'
          : 'border-border bg-card px-3 py-1.5 text-xs text-foreground hover:border-primary/50 hover:text-primary',
        className,
      )}
    >
      <LogOut className="h-3.5 w-3.5" />
      Quick exit
      <kbd aria-hidden="true" className={cn('hidden rounded border px-1 font-mono text-[9px] sm:inline', prominent ? 'border-primary-foreground/30' : 'border-border text-muted-foreground')}>Esc Esc</kbd>
    </button>
  );
}

/** Render this before the page content so it is the first Tab stop, even though it sits bottom-right. */
export function FloatingQuickExit() {
  return <div className="fixed bottom-4 right-4 z-[60] shadow-lg rounded-md"><QuickExitButton /></div>;
}
