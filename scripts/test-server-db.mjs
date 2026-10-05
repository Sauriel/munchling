import { randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import mariadb from "mariadb";

// Always an isolated disposable container/database. Never use a production URL.
const name = `munchling-mariadb-test-${randomUUID()}`;
const password = randomBytes(24).toString("hex");
const docker = (args) => spawnSync("docker", args, { encoding: "utf8" });
let started = false;
function cleanup() { if (started) { docker(["rm", "-f", name]); started = false; } }
process.on("SIGINT", () => { cleanup(); process.exit(130); });
process.on("SIGTERM", () => { cleanup(); process.exit(143); });
try {
	const start = docker(["run", "-d", "--rm", "--name", name, "-p", "127.0.0.1::3306",
		"-e", `MARIADB_ROOT_PASSWORD=${password}`, "-e", `MARIADB_PASSWORD=${password}`,
		"-e", "MARIADB_USER=munchling_test", "-e", "MARIADB_DATABASE=munchling_test", "mariadb:11.4", "--max-allowed-packet=64M"]);
	if (start.status !== 0) throw new Error("Could not start disposable MariaDB 11.4; ensure Docker is running and the image is available.");
	started = true;
	const mapped = docker(["port", name, "3306/tcp"]).stdout.trim();
	const port = Number(mapped.split(":").at(-1));
	if (!Number.isInteger(port) || port <= 0) throw new Error("No loopback MariaDB test port.");
	let ready = false;
	for (let attempt = 0; attempt < 90; attempt++) {
		try { const connection = await mariadb.createConnection({ host: "127.0.0.1", port, user: "munchling_test", password, database: "munchling_test", connectTimeout: 1000 }); await connection.end(); ready = true; break; }
		catch { await new Promise((resolve) => setTimeout(resolve, 500)); }
	}
	if (!ready) throw new Error("Disposable MariaDB did not become ready.");
	console.log("MariaDB 11.4 ready (isolated loopback test database).");
	const code = await new Promise((resolve, reject) => {
		const child = spawn("pnpm", ["exec", "vitest", "run", "--config", "vitest.server.config.ts"], {
			stdio: "inherit", env: { ...process.env, MUNCHLING_TEST_DB_HOST: "127.0.0.1", MUNCHLING_TEST_DB_PORT: String(port), MUNCHLING_TEST_DB_PASSWORD: password },
		});
		child.on("error", reject); child.on("exit", (status) => resolve(status ?? 1));
	});
	process.exitCode = code;
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { cleanup(); }
