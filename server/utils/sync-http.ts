import { defineEventHandler, getHeader, getMethod, setHeader, setResponseStatus, sendNoContent, type H3Event } from "h3";
import { ServerWriteError } from "../../shared/domain/server";
import { ServerProtocolError, syncLimits, syncProtocolVersion, type SyncApiError } from "../../shared/domain/protocol";
import { DomainValidationError } from "../../shared/domain/validation";
import { serverTables } from "../database/schema";
import { ServerStorageError } from "../services/write";

const safeFields = new Set(["id", "batch", "fields", "operation", "payload", "operations", "guards", "source", "ingredients", "profiles", "batchId", "operationId", "entityUuid", "baseRevision", "serverInstanceId", "serverEpoch", "deviceId", ...Object.keys(serverTables), ...Object.values(serverTables).flatMap((table) => [...table.columns])]);
class HttpError extends Error {
	constructor(readonly status: number, readonly code: string) { super(code); }
}
function originUrl(text: string) {
	try {
		const url = new URL(text);
		if (!["http:", "https:", "capacitor:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash || url.pathname && url.pathname !== "/") throw new Error();
		return url;
	} catch { throw new HttpError(503, "API_NOT_CONFIGURED"); }
}
function guard(event: H3Event, protocol: boolean) {
	setHeader(event, "Cache-Control", "no-store"); setHeader(event, "X-Content-Type-Options", "nosniff"); setHeader(event, "Vary", "Origin");
	const config = useRuntimeConfig().sync;
	if (!config?.publicOrigin) throw new HttpError(503, "API_NOT_CONFIGURED");
	const publicUrl = originUrl(config.publicOrigin);
	if (publicUrl.protocol === "capacitor:") throw new HttpError(503, "API_NOT_CONFIGURED");
	// Check the actual Host, not untrusted X-Forwarded-Host. This prevents
	// DNS-rebinding requests to an attacker's domain from becoming same-origin.
	const host = getHeader(event, "host"); let actual: URL;
	try { actual = new URL(`${publicUrl.protocol}//${host ?? ""}`); } catch { throw new HttpError(403, "ORIGIN_DENIED"); }
	if (actual.host !== publicUrl.host || actual.username || actual.password || actual.pathname !== "/") throw new HttpError(403, "ORIGIN_DENIED");
	const allowed = new Set([publicUrl.origin]);
	for (const item of String(config.allowedOrigins || "").split(",").map((value) => value.trim()).filter(Boolean)) {
		const url = originUrl(item); allowed.add(url.protocol === "capacitor:" ? `${url.protocol}//${url.host}` : url.origin);
	}
	const origin = getHeader(event, "origin");
	if (origin !== undefined) {
		if (!allowed.has(origin)) throw new HttpError(403, "ORIGIN_DENIED");
		setHeader(event, "Access-Control-Allow-Origin", origin);
	}
	if (getMethod(event) === "OPTIONS") {
		const method = getHeader(event, "access-control-request-method");
		const headers = String(getHeader(event, "access-control-request-headers") || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
		if (!origin || !["GET", "POST", "DELETE"].includes(method || "") || headers.some((name) => !["content-type", "x-munchling-protocol"].includes(name))) throw new HttpError(403, "ORIGIN_DENIED");
		setHeader(event, "Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS"); setHeader(event, "Access-Control-Allow-Headers", "Content-Type, X-Munchling-Protocol");
		setHeader(event, "Access-Control-Max-Age", 600); sendNoContent(event, 204); return false;
	}
	if (protocol && getHeader(event, "x-munchling-protocol") !== String(syncProtocolVersion)) throw new ServerProtocolError("protocolMismatch");
	return true;
}
function errorResponse(event: H3Event, error: unknown): SyncApiError {
	let code = "DB_UNAVAILABLE", status = 503, resync = false, retryable = true;
	let current: SyncApiError["error"]["current"], field: string | undefined;
	if (error instanceof HttpError) { code = error.code; status = error.status; retryable = status >= 500 || status === 408; }
	else if (error instanceof ServerWriteError) { code = error.code; status = 409; resync = code === "serverChanged"; retryable = false; current = error.current; }
	else if (error instanceof DomainValidationError) { code = error.code; status = code === "backupLimit" ? 413 : 422; retryable = false; /* Only fixed schema field names; never echo attacker-supplied keys. */ field = safeFields.has(error.field) ? error.field : "payload"; }
	else if (error instanceof ServerProtocolError) {
		code = error.code; retryable = code === "snapshotBusy" || code === "DB_READ_FAILED";
		status = ({ cursorInvalid: 409, snapshotExpired: 410, snapshotBusy: 429, snapshotLimit: 413, batchTooLarge: 413, protocolMismatch: 426, invalidRequest: 400, DB_READ_FAILED: 503 })[error.code];
		resync = code === "cursorInvalid" || code === "snapshotExpired";
	} else if (error instanceof ServerStorageError) code = error.code;
	if (status >= 500) console.error(JSON.stringify({ event: "sync_request_failed", code }));
	setResponseStatus(event, status);
	if (status === 429) setHeader(event, "Retry-After", 60);
	return { error: { code, resync, retryable, ...(current ? { current } : {}), ...(field ? { field } : {}) } };
}
export function syncEndpoint(action: (event: H3Event) => Promise<unknown> | unknown, protocol = true) {
	return defineEventHandler(async (event) => {
		try { if (!guard(event, protocol)) return null; return await action(event); }
		catch (error) { event.node.req.resume(); return errorResponse(event, error); }
	});
}
export async function syncJsonBody(event: H3Event): Promise<unknown> {
	const type = String(getHeader(event, "content-type") || "").toLowerCase();
	if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/.test(type) || ![undefined, "identity"].includes(getHeader(event, "content-encoding"))) throw new HttpError(415, "JSON_REQUIRED");
	const length = getHeader(event, "content-length");
	if (length && (!/^\d+$/.test(length) || Number(length) > syncLimits.pushBytes)) { setHeader(event, "Connection", "close"); throw new HttpError(413, "BODY_TOO_LARGE"); }
	const bytes = await new Promise<Buffer>((resolve, reject) => {
		const req = event.node.req; const chunks: Buffer[] = []; let size = 0;
		const cleanup = () => { clearTimeout(timer); req.off("data", data); req.off("end", end); req.off("error", aborted); req.off("aborted", aborted); };
		const fail = (error: HttpError) => { cleanup(); req.once("error", () => {}); req.resume(); setHeader(event, "Connection", "close"); reject(error); };
		const data = (chunk: Buffer) => { size += chunk.length; if (size > syncLimits.pushBytes) fail(new HttpError(413, "BODY_TOO_LARGE")); else chunks.push(chunk); };
		const end = () => { cleanup(); resolve(Buffer.concat(chunks)); };
		const aborted = () => fail(new HttpError(400, "REQUEST_ABORTED"));
		const timer = setTimeout(() => fail(new HttpError(408, "REQUEST_TIMEOUT")), 15_000);
		req.on("data", data); req.once("end", end); req.once("error", aborted); req.once("aborted", aborted);
		if (req.readableEnded) end();
	});
	try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw new HttpError(400, "INVALID_JSON"); }
}
