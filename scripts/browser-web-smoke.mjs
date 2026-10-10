import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
let base;
try { base = new URL(process.argv[2] ?? ""); } catch { throw new Error("Pass the isolated loopback Nitro URL"); }
if (base.protocol !== "http:" || base.hostname !== "127.0.0.1" || base.username || base.password || base.pathname !== "/" || base.search || base.hash) throw new Error("Smoke test requires an isolated loopback Nitro URL");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "munchling-web-smoke-"));
let browser, socket;
const exceptions = [], requests = [];
try {
	browser = spawn(process.env.CHROMIUM_BIN ?? "/usr/bin/chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check", "--lang=en-US", "--remote-debugging-port=0", `--user-data-dir=${temporary}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
	const ws = await new Promise((resolve, reject) => {
		let stderr = ""; const timer = setTimeout(() => reject(new Error("Chromium startup timeout")), 15_000);
		browser.once("error", error => { clearTimeout(timer); reject(error); }); browser.once("exit", code => { clearTimeout(timer); reject(new Error(`Chromium exited ${code}`)); });
		browser.stderr.on("data", data => { stderr += data; const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
	});
	const debuggerUrl = new URL(ws); if (debuggerUrl.hostname !== "127.0.0.1") throw new Error("Unexpected debugger host");
	const targets = await (await fetch(`http://${debuggerUrl.host}/json`)).json(); socket = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
	await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
	let sequence = 0; const jobs = new Map();
	socket.addEventListener("message", event => {
		const message = JSON.parse(event.data);
		if (message.id) { const job = jobs.get(message.id); if (!job) return; clearTimeout(job.timer); jobs.delete(message.id); if (message.error) job.reject(new Error(JSON.stringify(message.error))); else job.resolve(message.result); }
		else if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
		else if (message.method === "Network.requestWillBeSent") requests.push(message.params.request.url);
	});
	const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence, timer = setTimeout(() => { jobs.delete(id); reject(new Error(`CDP timeout ${method}`)); }, 15_000); jobs.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
	const evaluate = async expression => { const result = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
	const wait = async (expression, label) => { for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(`Timeout ${label}`); };
	await cdp("Runtime.enable"); await cdp("Page.enable"); await cdp("Network.enable");
	await cdp("Page.navigate", { url: `${base.origin}/profiles` }); await wait('Boolean(document.querySelector("form input"))', "profiles mounted");
	await evaluate('(() => { const input = document.querySelector("form input"); input.value = "Browser household"; input.dispatchEvent(new Event("input", { bubbles: true })); document.querySelector("form").requestSubmit(); })()');
	await wait('[...document.querySelectorAll("article")].some(node => node.textContent.includes("Browser household"))', "profile persisted");
	console.log("PASS: website creates a profile in MariaDB");
	await evaluate('(() => { const article = [...document.querySelectorAll("article")].find(node => node.textContent.includes("Browser household")); const button = [...article.querySelectorAll("button")].find(node => node.textContent.trim() === "Edit"); if (!button) throw new Error("Edit button missing"); button.click(); })()');
	await evaluate('(() => { const input = document.querySelector("form input"); input.value = "Browser updated"; input.dispatchEvent(new Event("input", { bubbles: true })); document.querySelector("form").requestSubmit(); })()');
	await wait('[...document.querySelectorAll("article")].some(node => node.textContent.includes("Browser updated"))', "profile updated");
	await cdp("Page.reload"); await wait('[...document.querySelectorAll("article")].some(node => node.textContent.includes("Browser updated"))', "server data after reload");
	console.log("PASS: versioned website edit survives reload");
	const mergeSeed = await evaluate(`(async () => {
		const info = await (await fetch('/api/sync/info',{ headers: { 'X-Munchling-Protocol': '1' } })).json(); window.mergeBinding = { serverInstanceId: info.serverInstanceId, serverEpoch: info.serverEpoch };
		const rows = ['Merge source','Merge target','Merge mismatch'].map((name,i) => { const id = crypto.randomUUID(); return { operationId: crypto.randomUUID(),entity: 'foods',entityUuid: id,baseRevision: 0,operation: 'upsert',payload: { id,name_de: name,name_en: name,brand: null,ean: null,calories_per_100g: i === 2 ? 101 : 100,fat_per_100g: 0,carbs_per_100g: 0,sugar_per_100g: 0,protein_per_100g: 0,fiber_per_100g: 0,salt_per_100g: 0,is_custom: 1,portion_size_grams: i === 0 ? 25 : 50,created_at: new Date().toISOString(),updated_at: null } }; });
		window.mergeIds = rows.map(row => row.entityUuid); const response = await fetch('/api/sync/push',{ method: 'POST',headers: { 'Content-Type': 'application/json','X-Munchling-Protocol': '1' },body: JSON.stringify({ ...window.mergeBinding,batchId: crypto.randomUUID(),operations: rows }) }); if (!response.ok) throw new Error('Merge fixture failed'); return { binding: window.mergeBinding,ids: window.mergeIds };
	})()`);
	await cdp('Emulation.setDeviceMetricsOverride', { width: 390,height: 780,deviceScaleFactor: 1,mobile: true });
	await cdp('Page.navigate', { url: `${base.origin}/foods` });
	await wait('Boolean(document.querySelector("details summary"))', 'merge panel mounted');
	await evaluate('document.querySelector("details").open = true');
	await wait('document.querySelectorAll("details select option").length >= 8', 'merge choices');
	const choose = async (index,name) => evaluate(`(() => { const select = document.querySelectorAll('details select')[${index}]; select.value = [...select.options].find(row => row.textContent.startsWith(${JSON.stringify(name)})).value; select.dispatchEvent(new Event('change',{ bubbles: true })); })()`);
	await choose(0,'Merge source'); await choose(1,'Merge mismatch');
	await evaluate('[...document.querySelectorAll("details button")].find(b => b.textContent.trim() === "Review preview").click()');
	await wait('document.querySelector("details").textContent.includes("Nutrients differ")', 'different nutrients blocked');
	await choose(1,'Merge target');
	await evaluate('[...document.querySelectorAll("details button")].find(b => b.textContent.trim() === "Review preview").click()');
	await wait('Boolean(document.querySelector("details input[type=checkbox]"))', 'explicit merge preview');
	if (!await evaluate('document.documentElement.scrollWidth <= innerWidth + 1')) throw new Error('Merge preview overflows mobile viewport');
	if (!await evaluate('[...document.querySelectorAll("details button")].find(b => b.textContent.trim() === "Apply confirmed merge").disabled')) throw new Error('Merge lacked confirmation gate');
	await evaluate('document.querySelector("details input[type=checkbox]").click()');
	await evaluate('[...document.querySelectorAll("details button")].find(b => b.textContent.trim() === "Apply confirmed merge").click()');
	await wait('document.querySelector("details").textContent.includes("Merge confirmed")', 'merge committed');
	await evaluate(`(async () => { const seed = ${JSON.stringify(mergeSeed)}, query = new URLSearchParams(seed.binding), state = await (await fetch('/api/sync/view?'+query,{ headers: { 'X-Munchling-Protocol': '1' } })).json(); const source = state.snapshot.aggregates.find(row => row.id === seed.ids[0]), target = state.snapshot.aggregates.find(row => row.id === seed.ids[1]); if (source.data !== null || !source.deletedAt || target.version !== 2 || target.data.portion_size_grams !== 50) throw new Error('Wrong merge result'); })()`);
	console.log('PASS: website merge blocks differing nutrients, requires preview/confirmation and preserves target');
	if (!await evaluate('document.querySelector("jeep-sqlite") === null')) throw new Error("Online website initialized jeep-sqlite");
	if (requests.some(url => /(?:assets\/sql-wasm\.wasm|jeep-sqlite)/.test(url))) throw new Error("Online website requested local SQLite runtime");
	if (exceptions.length) throw new Error(`Uncaught browser exception: ${exceptions[0]}`);
	console.log("PASS: no browser SQLite initialization or uncaught exceptions");
} finally {
	if (socket) socket.close();
	if (browser && browser.exitCode === null) { const exited = new Promise(resolve => browser.once("exit", resolve)); browser.kill("SIGTERM"); await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]); if (browser.exitCode === null) browser.kill("SIGKILL"); }
	fs.rmSync(temporary, { recursive: true, force: true });
}
