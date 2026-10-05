import { copyFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
let jeep;
try {
	jeep = JSON.parse(await readFile(new URL("node_modules/jeep-sqlite/package.json", root), "utf8"));
} catch (cause) {
	throw new Error("Cannot read jeep-sqlite metadata; run pnpm install first.", { cause });
}
// jeep-sqlite 2.8.0 embeds the sql.js 1.11 JS runtime in its published bundle.
// It cannot load the newer WASM used by our separate BLS search runtime.
if (jeep.version !== "2.8.0") throw new Error("Check jeep-sqlite's embedded sql.js version before updating its WASM asset.");
const assets = [
	["node_modules/sql.js/dist/sql-wasm.wasm", "public/sql-wasm.wasm"],
	["node_modules/sql.js-jeep/dist/sql-wasm.wasm", "public/assets/sql-wasm.wasm"],
];
for (const [source, destination] of assets) {
	const output = new URL(destination, root);
	await mkdir(new URL("./", output), { recursive: true });
	await copyFile(new URL(source, root), output);
	console.log("Prepared " + fileURLToPath(output).replace(fileURLToPath(root), ""));
}
