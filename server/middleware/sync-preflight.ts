import { defineEventHandler, getMethod } from "h3";
import { syncEndpoint } from "../utils/sync-http";
const preflight = syncEndpoint(() => null, false);
// Nitro's method-specific route can otherwise outrank an OPTIONS catch-all
// and fall through to the SPA renderer. Handle preflight before routing.
export default defineEventHandler((event) => {
	if (event.path.startsWith("/api/sync/") && getMethod(event) === "OPTIONS") return preflight(event);
});
