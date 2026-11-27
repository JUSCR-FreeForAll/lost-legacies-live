import { useEffect, useRef, type ComponentType, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Link, Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { setTenantId } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppShell, Mark } from '@/components/app-shell';
import { IdentityProvider } from '@/components/identity';
import NotFound from '@/pages/not-found';
import Landing from '@/pages/landing';
import OverviewPage from '@/pages/overview';
import DatasetsPage from '@/pages/datasets';
import BackupsPage from '@/pages/backups';
import RecoveryPage from '@/pages/recovery';
import AuditPage from '@/pages/audit';
import SettingsPage from '@/pages/settings';
import DiagnosticsPage from '@/pages/diagnostics';
import DocsPage from '@/pages/docs';
import RecoveryKeyPage from '@/pages/recovery-key';
import EmergencyPage from '@/pages/emergency';
import ContactsPage from '@/pages/contacts';
import PrivacyPage from '@/pages/privacy';
import EvidencePage from '@/pages/evidence';
import ResiliencePage from '@/pages/resilience';
import InteropPage from '@/pages/interop';
import { FloatingQuickExit, QuickExitListener } from '@/components/quick-exit';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 } },
});

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: 'hsl(8 62% 40%)',
    colorForeground: 'hsl(210 28% 14%)',
    colorMutedForeground: 'hsl(210 10% 38%)',
    colorDanger: 'hsl(356 66% 42%)',
    colorBackground: 'hsl(44 40% 98%)',
    colorInput: 'hsl(42 30% 96%)',
    colorInputForeground: 'hsl(210 28% 14%)',
    colorNeutral: 'hsl(210 28% 14%)',
    fontFamily: "'IBM Plex Sans', sans-serif",
    borderRadius: '0.375rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[hsl(44_40%_98%)] rounded-md w-[420px] max-w-full overflow-hidden border border-[hsl(38_18%_82%)] shadow-lg',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: "text-[hsl(210_28%_14%)] text-2xl font-medium [font-family:'Fraunces',serif]",
    headerSubtitle: 'text-[hsl(210_10%_38%)]',
    socialButtonsBlockButtonText: 'text-[hsl(210_28%_14%)]',
    formFieldLabel: 'text-[hsl(210_28%_14%)] font-medium',
    footerActionLink: 'text-[hsl(8_62%_40%)] font-medium',
    footerActionText: 'text-[hsl(210_10%_38%)]',
    dividerText: 'text-[hsl(210_10%_38%)]',
    identityPreviewEditButton: 'text-[hsl(8_62%_40%)]',
    formFieldSuccessText: 'text-[hsl(174_42%_30%)]',
    alertText: 'text-[hsl(210_28%_14%)]',
    logoBox: 'justify-center',
    logoImage: 'h-10 w-10',
    socialButtonsBlockButton: 'border border-[hsl(38_18%_80%)] bg-[hsl(44_40%_98%)]',
    formButtonPrimary: 'bg-[hsl(8_62%_40%)] text-[hsl(40_45%_97%)] shadow-none',
    formFieldInput: 'border border-[hsl(38_16%_76%)] bg-[hsl(42_30%_96%)] text-[hsl(210_28%_14%)]',
    footerAction: 'justify-center',
    dividerLine: 'bg-[hsl(38_18%_82%)]',
    alert: 'border border-[hsl(356_66%_42%/0.3)] bg-[hsl(356_66%_42%/0.06)]',
    otpCodeFieldInput: 'border border-[hsl(38_16%_76%)] text-[hsl(210_28%_14%)]',
    formFieldRow: 'gap-3',
    main: 'gap-5',
  },
};

function AuthFrame({ children, kicker }: { children: ReactNode; kicker: string }) {
  return (
    <div className="grid min-h-[100dvh] md:grid-cols-[1fr_1.1fr]">
      <div className="hidden flex-col justify-between bg-sidebar p-10 text-sidebar-foreground md:flex">
        <Link href="/" className="flex items-center gap-2.5"><Mark /><span className="font-display text-lg text-sidebar-accent-foreground">Phoenix Fortress</span></Link>
        <div>
          <div className="mb-4 font-mono text-[10px] uppercase tracking-[0.16em] text-sidebar-foreground/50">{kicker}</div>
          <p className="max-w-sm font-display text-3xl leading-snug text-sidebar-accent-foreground">Every restore begins as a plan you read, and ends as a copy you can inspect.</p>
        </div>
        <div className="font-mono text-[10px] text-sidebar-foreground/45">Production runtime not verified</div>
      </div>
      <div className="flex items-center justify-center px-4 py-10">{children}</div>
    </div>
  );
}

function SignInPage() {
  return <AuthFrame kicker="Operator sign-in"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></AuthFrame>;
}

function SignUpPage() {
  return <AuthFrame kicker="New vault"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></AuthFrame>;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        setTenantId(null);
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);
  return null;
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in"><Redirect to="/overview" /></Show>
      <Show when="signed-out"><Landing /><FloatingQuickExit /></Show>
    </>
  );
}

function protect(Page: ComponentType) {
  return function Protected() {
    return (
      <>
        <Show when="signed-in"><AppShell><Page /></AppShell></Show>
        <Show when="signed-out"><Redirect to="/" /></Show>
      </>
    );
  };
}

const Overview = protect(OverviewPage);
const Datasets = protect(DatasetsPage);
const Backups = protect(BackupsPage);
const Recovery = protect(RecoveryPage);
const Audit = protect(AuditPage);
const Settings = protect(SettingsPage);
const Diagnostics = protect(DiagnosticsPage);
const Docs = protect(DocsPage);
const RecoveryKey = protect(RecoveryKeyPage);
const Emergency = protect(EmergencyPage);
const Contacts = protect(ContactsPage);
const Privacy = protect(PrivacyPage);
const Evidence = protect(EvidencePage);
const Resilience = protect(ResiliencePage);
const Interop = protect(InteropPage);

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={HomeRedirect} />
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
        <Route path="/overview" component={Overview} />
        <Route path="/datasets" component={Datasets} />
        <Route path="/backups" component={Backups} />
        <Route path="/recovery" component={Recovery} />
        <Route path="/audit" component={Audit} />
        <Route path="/settings" component={Settings} />
        <Route path="/diagnostics" component={Diagnostics} />
        <Route path="/docs" component={Docs} />
        <Route path="/recovery-key" component={RecoveryKey} />
        <Route path="/emergency" component={Emergency} />
        <Route path="/contacts" component={Contacts} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/evidence" component={Evidence} />
        <Route path="/resilience" component={Resilience} />
        <Route path="/interop" component={Interop} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: { start: { title: 'Return to your vault', subtitle: 'Sign in to review evidence and stage recoveries' } },
        signUp: { start: { title: 'Open a vault', subtitle: 'A personal tenant is created with you as administrator' } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <QuickExitListener />
        <TooltipProvider>
          <IdentityProvider>
            <Router />
          </IdentityProvider>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
