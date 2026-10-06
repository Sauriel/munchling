import { Capacitor } from "@capacitor/core";
import { createHttpDataService } from "~/utils/data/http";
export default defineNuxtPlugin(async () => {
	if (useRuntimeConfig().public.dataMode === "online") {
		if (Capacitor.isNativePlatform()) throw new Error("Online build must not be installed as the offline native app.");
		return { provide: { munchlingData: createHttpDataService(window.location.origin, window.localStorage) } };
	}
	// Do not initialize/import SQLite or register jeep-sqlite in online mode.
	const [{ initializeMunchlingDatabase }, { databaseSql }, { createLocalDataService }] = await Promise.all([import("~/utils/database/client"), import("~/utils/database/sql"), import("~/utils/data/local")]);
	if (Capacitor.getPlatform() === "web") {
		const { defineCustomElements } = await import("jeep-sqlite/loader"); defineCustomElements(window);
		if (!document.querySelector("jeep-sqlite")) {
			const element = document.createElement("jeep-sqlite"); element.setAttribute("wasmpath", `${useRuntimeConfig().app.baseURL.replace(/\/$/, "")}/assets`); document.body.appendChild(element);
		}
		await customElements.whenDefined("jeep-sqlite");
	}
	await initializeMunchlingDatabase({ seedTestData: import.meta.dev });
	return { provide: { munchlingData: createLocalDataService(databaseSql) } };
});
