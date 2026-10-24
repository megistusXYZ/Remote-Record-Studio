import { createRoot } from "react-dom/client";
import App from "./App";
import { installApiAuth } from "./lib/api-auth";
import { setupAppUpdates } from "./lib/pwa-update";
import { applyTheme, followDevice, getThemePreference, resolveTheme } from "./lib/theme";
import "./index.css";

// Wire NIP-98 signed-request auth into the shared API client BEFORE the
// React tree mounts so the first data-fetching query carries an
// Authorization header.
installApiAuth();
setupAppUpdates();

applyTheme(resolveTheme(getThemePreference()));
followDevice();

createRoot(document.getElementById("root")!).render(<App />);
