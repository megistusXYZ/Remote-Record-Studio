import { lazy, Suspense, useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import LandingPage from "./pages/landing";
import { MobileNavLayout } from "./components/MobileNavLayout";
import { AppUpdatePrompt } from "./components/AppUpdatePrompt";
import { RouteFallback } from "./components/RouteFallback";

// The landing page is the only screen most visitors ever see, so it is the
// only one in the first bundle. Everything else loads when its route is
// opened; the service worker precaches the chunks, so a returning user pays
// nothing extra and the first visit no longer downloads the whole studio.
const Onboarding = lazy(() => import("./pages/onboarding"));
const Home = lazy(() => import("./pages/home"));
const Vault = lazy(() => import("./pages/vault"));
const Settings = lazy(() => import("./pages/settings"));
const NewSession = lazy(() => import("./pages/session-new"));
const SessionStudio = lazy(() => import("./pages/session-studio"));
const Join = lazy(() => import("./pages/join"));
const ShareView = lazy(() => import("./pages/share-view"));
const ReceiptPage = lazy(() => import("./pages/receipt"));
const RevokeTrackPage = lazy(() => import("./pages/revoke-track"));
const Privacy = lazy(() => import("./pages/privacy"));
const Terms = lazy(() => import("./pages/terms"));
const HowItWorks = lazy(() => import("./pages/how-it-works"));
const RecordPage = lazy(() => import("./pages/record"));

const queryClient = new QueryClient();

function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [location]);
  return null;
}

function Router() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Switch>
        <Route path="/" component={LandingPage} />
        <Route path="/start" component={Onboarding} />
        <Route path="/home">{() => <MobileNavLayout><Home /></MobileNavLayout>}</Route>
        <Route path="/vault">{() => <MobileNavLayout><Vault /></MobileNavLayout>}</Route>
        <Route path="/settings">{() => <MobileNavLayout><Settings /></MobileNavLayout>}</Route>
        <Route path="/session/new">{() => <MobileNavLayout><NewSession /></MobileNavLayout>}</Route>
        <Route path="/session/:id" component={SessionStudio} />
        <Route path="/record">{() => <MobileNavLayout><RecordPage /></MobileNavLayout>}</Route>
        <Route path="/join/:inviteCode" component={Join} />
        <Route path="/s/:pointer" component={ShareView} />
        <Route path="/r/:pointer" component={ReceiptPage} />
        <Route path="/revoke/:archiveId" component={RevokeTrackPage} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/terms" component={Terms} />
        <Route path="/how-it-works" component={HowItWorks} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <ScrollToTop />
          <Router />
        </WouterRouter>
        <AppUpdatePrompt />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
