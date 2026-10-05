import { createServerDatabase } from "../database/connection";
import { migrateServerDatabase } from "../database/migrations";
import { clearServerDatabase, installServerDatabase } from "../database/runtime";

export default defineNitroPlugin(async (app) => {
	// Building/prerendering and native previews never connect to production DB.
	if (import.meta.prerender) return;
	const config = useRuntimeConfig();
	if (config.serverEnabled !== true && String(config.serverEnabled) !== "true") return;
	const value = config.mariaDb;
	const database = createServerDatabase({ host: value.host, port: Number(value.port), user: value.user, password: value.password, database: value.database, connectionLimit: Number(value.connectionLimit) });
	try { await migrateServerDatabase(database, value.database); }
	catch {
		await database.close();
		console.error(JSON.stringify({ event: "database_startup_failed", code: "DB_BOOTSTRAP_FAILED" }));
		throw new Error("Server database startup failed; inspect configuration and migration status.");
	}
	installServerDatabase(database);
	app.hooks.hook("close", async () => { clearServerDatabase(); await database.close(); });
});
