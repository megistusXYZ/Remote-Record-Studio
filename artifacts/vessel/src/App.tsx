import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import Onboarding from "./pages/onboarding";
import Home from "./pages/home";
import Vault from "./pages/vault";
import Settings from "./pages/settings";
import NewSession from "./pages/session-new";
import SessionStudio from "./pages/session-studio";
import Join from "./pages/join";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Onboarding} />
      <Route path="/home" component={Home} />
      <Route path="/vault" component={Vault} />
      <Route path="/settings" component={Settings} />
      <Route path="/session/new" component={NewSession} />
      <Route path="/session/:id" component={SessionStudio} />
      <Route path="/join/:inviteCode" component={Join} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
