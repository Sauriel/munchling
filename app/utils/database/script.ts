import type { SqlChanges, SqlDriver } from "./executor";

// SQLite script boundaries, not a general SQL rewriter. Keep published DDL,
// literals and trigger bodies byte-for-byte; the native execute bridge splits
// on ;\n and cannot reconstruct multi-statement BEGIN ... END triggers.
export function splitSqlStatements(script: string): string[] {
	const statements: string[] = [], prefix: string[] = [];
	let start = 0, index = 0, hasSql = false, trigger = false, body = false, cases = 0;
	const emit = (end: number) => {
		if (hasSql) statements.push(script.slice(start, end).trim());
		start = end; hasSql = false; trigger = false; body = false; cases = 0; prefix.length = 0;
	};
	while (index < script.length) {
		const char = script[index]!;
		if (char === "-" && script[index + 1] === "-") { const end = script.indexOf("\n", index + 2); index = end < 0 ? script.length : end + 1; continue; }
		if (char === "/" && script[index + 1] === "*") { const end = script.indexOf("*/", index + 2); if (end < 0) throw new Error("Unterminated SQL comment."); index = end + 2; continue; }
		if (["'", '"', "`", "["].includes(char)) {
			hasSql = true; const closing = char === "[" ? "]" : char; let closed = false; index++;
			while (index < script.length) {
				if (script[index] === closing) {
					if (char !== "[" && script[index + 1] === closing) { index += 2; continue; }
					index++; closed = true; break;
				}
				index++;
			}
			if (!closed) throw new Error("Unterminated SQL literal or identifier."); continue;
		}
		if (/[A-Za-z_]/.test(char)) {
			const from = index++; while (index < script.length && /[A-Za-z0-9_$]/.test(script[index]!)) index++;
			const word = script.slice(from, index).toUpperCase(); hasSql = true;
			if (prefix.length < 3) prefix.push(word);
			if (prefix[0] === "CREATE" && (prefix[1] === "TRIGGER" || ["TEMP", "TEMPORARY"].includes(prefix[1] ?? "") && prefix[2] === "TRIGGER")) trigger = true;
			if (trigger) {
				if (word === "BEGIN" && !body) body = true;
				else if (body && word === "CASE") cases++;
				else if (body && word === "END") { if (cases > 0) cases--; else body = false; }
			}
			continue;
		}
		index++;
		if (char === ";") { if (!body) emit(index); }
		else if (!/\s/.test(char)) hasSql = true;
	}
	if (body || cases > 0) throw new Error("Unterminated SQL trigger.");
	emit(script.length); return statements;
}

export function createSqlScriptExecutor(driver: Pick<SqlDriver, "run" | "begin" | "commit" | "rollback">) {
	let unusable = false;
	return async (script: string, transaction = true): Promise<SqlChanges> => {
		if (unusable) throw new Error("SQL script connection requires reopening after rollback failure.");
		const statements = splitSqlStatements(script); // validate all boundaries before any SQL
		if (!statements.length) return { changes: { changes: 0 } };
		if (transaction) await driver.begin();
		let changes = 0, lastId: number | undefined;
		try {
			for (const statement of statements) {
				const result = await driver.run(statement, []);
				changes += result.changes?.changes ?? 0; lastId = result.changes?.lastId;
			}
			if (transaction) await driver.commit();
			return { changes: { changes, ...(lastId === undefined ? {} : { lastId }) } };
		} catch (error) {
			if (transaction) try { await driver.rollback(); } catch (rollbackError) { unusable = true; throw new AggregateError([error, rollbackError], "SQL script and rollback failed."); }
			throw error;
		}
	};
}
