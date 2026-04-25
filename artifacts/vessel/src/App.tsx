import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import LandingPage from "./pages/landing";
import Onboarding from "./pages/onboarding";
import Home from "./pages/home";
import Vault from "./pages/vault";
import Settings from "./pages/settings";
import NewSession from "./pages/session-new";
import SessionStudio from "./pages/session-studio";
import Join from "./pages/join";
import ShareView from "./pages/share-view";
import Privacy from "./pages/privacy";
import Terms from "./pages/terms";

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
    <Switch>
      <Route path="/" component={LandingPage} />
      <Route path="/start" component={Onboarding} />
      <Route path="/home" component={Home} />
      <Route path="/vault" component={Vault} />
      <Route path="/settings" component={Settings} />
      <Route path="/session/new" component={NewSession} />
      <Route path="/session/:id" component={SessionStudio} />
      <Route path="/join/:inviteCode" component={Join} />
      <Route path="/s/:pointer" component={ShareView} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/terms" component={Terms} />
      <Route component={NotFound} />
    </Switch>
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
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
