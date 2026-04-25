import { createRoot } from "react-dom/client";
import App from "./App";
import { installApiAuth } from "./lib/api-auth";
import "./index.css";

// Wire NIP-98 signed-request auth into the shared API client BEFORE the
// React tree mounts so the first data-fetching query carries an
// Authorization header.
installApiAuth();

createRoot(document.getElementById("root")!).render(<App />);
