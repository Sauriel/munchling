import { Capacitor } from "@capacitor/core";
import { defineCustomElements as defineJeepSqliteCustomElements } from "jeep-sqlite/loader";
import { initializeMunchlingDatabase } from "~/utils/database/client";
import { databaseSql } from "~/utils/database/sql";
import { createLocalDataService } from "~/utils/data/local";

export default defineNuxtPlugin(async () => {
	if (Capacitor.getPlatform() === "web") {
		defineJeepSqliteCustomElements(window);

		if (!document.querySelector("jeep-sqlite")) {
			const element = document.createElement("jeep-sqlite");
			// Use the matching jeep-sqlite WASM, separate from the newer BLS runtime.
			// Stencil exposes this attribute as 'wasmpath', not 'wasm-path'.
			element.setAttribute("wasmpath", `${useRuntimeConfig().app.baseURL.replace(/\/$/, "")}/assets`);
			document.body.appendChild(element);
		}
		await customElements.whenDefined("jeep-sqlite");
	}

	await initializeMunchlingDatabase({ seedTestData: import.meta.dev });
	return { provide: { munchlingData: createLocalDataService(databaseSql) } };
});
