import { Capacitor } from "@capacitor/core";
import { defineCustomElements as defineJeepSqliteCustomElements } from "jeep-sqlite/loader";
import { initializeMunchlingDatabase } from "~/utils/database/client";

export default defineNuxtPlugin(async () => {
	if (Capacitor.getPlatform() === "web") {
		defineJeepSqliteCustomElements(window);

		if (!document.querySelector("jeep-sqlite")) {
			document.body.appendChild(document.createElement("jeep-sqlite"));
		}
	}

	await initializeMunchlingDatabase({ seedTestData: import.meta.dev });
});
