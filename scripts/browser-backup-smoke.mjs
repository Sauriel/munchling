import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Chromium DevTools smoke test against the generated SPA. Requires Node >= 22
// and Chromium (CHROMIUM_BIN can override its path), no browser npm dependency.
const root = fileURLToPath(new URL("../.output/public", import.meta.url));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "munchling-backup-smoke-"));
const downloads = path.join(temporary, "downloads");
fs.mkdirSync(downloads);
const mime = { ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".html": "text/html" };
const missing = [];
const server = http.createServer((request, response) => {
	try {
		let file = path.resolve(root, "." + decodeURIComponent(new URL(request.url, "http://local").pathname));
		if (file !== root && !file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
		if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
		if (!fs.existsSync(file)) {
			if (path.extname(file)) { missing.push(request.url); response.writeHead(404).end(); return; }
			file = path.join(root, "index.html");
		}
		response.setHeader("Content-Type", mime[path.extname(file)] ?? "application/octet-stream");
		fs.createReadStream(file).on("error", () => response.destroy()).pipe(response);
	} catch { response.writeHead(400).end(); }
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let browser, socket;
const exceptions = [];
const consoleErrors = [];

try {
	if (!fs.existsSync(path.join(root, "index.html"))) throw new Error("Run pnpm generate first.");
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const base = "http://127.0.0.1:" + server.address().port;
	browser = spawn(process.env.CHROMIUM_BIN ?? "/usr/bin/chromium", [
		"--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run",
		"--no-default-browser-check", "--lang=en-US", "--remote-debugging-port=0",
		"--user-data-dir=" + path.join(temporary, "profile"), "about:blank",
	], { stdio: ["ignore", "ignore", "pipe"] });
	const browserUrl = await new Promise((resolve, reject) => {
		let text = "";
		const timer = setTimeout(() => reject(new Error("Chromium startup timeout")), 15_000);
		const failed = (error) => { clearTimeout(timer); reject(error); };
		browser.once("error", failed);
		browser.once("exit", (code) => failed(new Error("Chromium exited: " + code)));
		browser.stderr.on("data", (chunk) => {
			text += chunk;
			const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
			if (match) { clearTimeout(timer); resolve(match[1]); }
		});
	});
	const targets = await (await fetch("http://" + new URL(browserUrl).host + "/json")).json();
	socket = new WebSocket(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.addEventListener("open", resolve, { once: true });
		socket.addEventListener("error", reject, { once: true });
	});
	let sequence = 0;
	const jobs = new Map();
	socket.addEventListener("message", (event) => {
		const message = JSON.parse(event.data);
		if (message.id) {
			const job = jobs.get(message.id);
			if (!job) return;
			jobs.delete(message.id);
			clearTimeout(job.timer);
			if (message.error) job.reject(new Error(JSON.stringify(message.error)));
			else job.resolve(message.result);
		} else if (message.method === "Runtime.exceptionThrown") {
			exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
		} else if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
			consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(" "));
		}
	});
	const cdp = (method, params = {}) => new Promise((resolve, reject) => {
		const id = ++sequence;
		const timer = setTimeout(() => { jobs.delete(id); reject(new Error("DevTools timeout: " + method)); }, 15_000);
		jobs.set(id, { resolve, reject, timer });
		socket.send(JSON.stringify({ id, method, params }));
	});
	const evaluate = async (expression) => {
		const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
		if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
		return result.result.value;
	};
	const wait = async (check, label) => {
		for (let i = 0; i < 120; i++) { if (await check()) return; await sleep(100); }
		throw new Error("Timeout: " + label);
	};
	await cdp("Runtime.enable");
	await cdp("Page.enable");
	await cdp("DOM.enable");
	await cdp("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
	const navigate = async (route) => {
		await cdp("Page.navigate", { url: base + route });
		await wait(() => evaluate('Boolean(document.querySelector("main"))'), "app mounted: " + route);
	};
	const click = (text) => evaluate(`(() => {
		const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)});
		if (!button || button.disabled) throw new Error('Button missing/disabled: ' + ${JSON.stringify(text)});
		button.click();
	})()`);
	const download = async (text) => {
		const before = new Set(fs.readdirSync(downloads));
		await click(text);
		await wait(async () => fs.readdirSync(downloads).some((file) => file.endsWith(".json") && !before.has(file)), "download: " + text);
		const name = fs.readdirSync(downloads).find((file) => file.endsWith(".json") && !before.has(file));
		const file = path.join(downloads, name);
		return { file, data: JSON.parse(fs.readFileSync(file, "utf8")) };
	};
	await navigate("/settings");
	await wait(() => evaluate('Boolean(document.querySelector("#backup-file"))'), "backup controls");
	const empty = await download("Export backup");
	if (empty.data.version !== 4 || empty.data.schemaVersion !== 4 || empty.data.identities.length !== 0 || empty.data.data.profiles.length !== 0) throw new Error("Expected an empty v4 backup.");
	console.log("PASS: browser exports the empty local database");

	await navigate("/profiles");
	await evaluate(`(() => {
		const inputs = [...document.querySelector('form').querySelectorAll('input')];
		inputs[0].value = 'Browser Smoke'; inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
		inputs[1].value = '2000'; inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
		document.querySelector('button[type=submit]').click();
	})()`);
	await wait(() => evaluate('document.body.textContent.includes("Browser Smoke")'), "profile saved");
	await navigate("/settings");
	const populated = await download("Export backup");
	if (populated.data.data.profiles.length !== 1 || populated.data.identities.length !== 1) throw new Error("The profile identity did not persist.");
	const originalUuid = populated.data.identities[0].uuid;
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(originalUuid)) throw new Error("Invalid generated UUID.");
	console.log("PASS: profile creation persists across navigation and export");

	const restoreFile = async (file) => {
		const doc = await cdp("DOM.getDocument");
		const node = await cdp("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#backup-file" });
		await cdp("DOM.setFileInputFiles", { nodeId: node.nodeId, files: [file] });
		await wait(() => evaluate('Boolean(document.querySelector("input[type=checkbox]"))'), "restore preview");
		await evaluate('document.querySelector("input[type=checkbox]").click()');
		await click("Restore");
		await wait(() => evaluate('document.body.textContent.includes("The backup was restored.")'), "restore success");
	};
	await restoreFile(empty.file);
	const after = await download("Export backup");
	if (after.data.data.profiles.length !== 0) throw new Error("Restore did not replace the data.");
	console.log("PASS: confirmed restore replaces the local data");

	const recovery = await download("Export latest safety backup");
	if (recovery.data.data.profiles[0]?.name !== "Browser Smoke") throw new Error("Safety backup lost the previous profile.");
	await cdp("Page.reload");
	await wait(() => evaluate('[...document.querySelectorAll("button")].some(b => b.textContent.trim() === "Export latest safety backup")'), "persistent safety backup");
	console.log("PASS: safety backup contains previous data and survives reload");
	await restoreFile(recovery.file);
	const restored = await download("Export backup");
	if (restored.data.identities[0]?.uuid !== originalUuid) throw new Error("Identity-preserving restore changed the profile UUID.");
	console.log("PASS: v3 restore preserves UUIDs");
	const legacyFile = path.join(downloads, "legacy-v1.json");
	fs.writeFileSync(legacyFile, JSON.stringify({ format: "munchling-backup", version: 1, schemaVersion: 1, exportedAt: populated.data.exportedAt, data: populated.data.data }));
	await restoreFile(legacyFile);
	await cdp("Page.reload");
	await wait(() => evaluate('Boolean(document.querySelector("#backup-file"))'), "settings after legacy restore");
	const legacyRestored = await download("Export backup");
	if (legacyRestored.data.version !== 4 || legacyRestored.data.data.profiles[0]?.name !== "Browser Smoke" || !legacyRestored.data.identities[0]?.uuid || legacyRestored.data.identities[0].uuid === originalUuid) throw new Error("Legacy restore did not create a new persistent identity.");
	console.log("PASS: legacy v1 restore creates persistent new UUIDs");
	if (exceptions.length) throw new Error("Uncaught browser exceptions: " + exceptions.join("; "));
	console.log("PASS: no uncaught browser exceptions");
} catch (error) {
	process.exitCode = 1;
	console.error("Browser smoke failed:", error.message);
	console.error("Browser exceptions:", exceptions.slice(-3));
	console.error("Browser errors:", consoleErrors.slice(-5));
	console.error("Missing assets:", missing.slice(-10));
	console.error("Diagnostic files:", temporary);
} finally {
	if (socket) socket.close();
	if (browser && browser.exitCode === null) {
		const exited = new Promise((resolve) => browser.once("exit", resolve));
		browser.kill("SIGTERM");
		await Promise.race([exited, sleep(3000)]);
		if (browser.exitCode === null) browser.kill("SIGKILL");
	}
	if (server.listening) await new Promise((resolve) => server.close(resolve));
	if (!process.exitCode) fs.rmSync(temporary, { recursive: true, force: true });
}
