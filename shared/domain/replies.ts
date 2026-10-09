import { aggregates, utcTimestamp, validatePayload } from "./server-validation";
import { assertRecord } from "./validation";
import { isUuid, syncEntities, type SyncAggregate } from "./sync";
import { syncLimits, syncProtocolVersion, type ChangePage, type ServerBinding, type ServerInfo, type SnapshotPage } from "./protocol";
import type { ServerAggregate, ServerReceipt, ServerWriteBatch } from "./server";
export class SyncClientError extends Error {
	constructor(readonly code: string, readonly resync = false, readonly retryable = false, readonly current: ServerAggregate[] = [], readonly status = 0) { super(code); this.name = "SyncClientError"; }
}
function check(value: unknown): asserts value { if (!value) throw new SyncClientError("invalidResponse"); }
export function wireCursor(value: unknown): string {
	check(typeof value === "string" && /^(0|[1-9][0-9]{0,15})$/.test(value) && Number.isSafeInteger(Number(value))); return value;
}
function positive(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function binding(value: Record<string, unknown>, expected?: ServerBinding) {
	check(isUuid(value.serverInstanceId) && isUuid(value.serverEpoch));
	if (expected && (value.serverInstanceId !== expected.serverInstanceId || value.serverEpoch !== expected.serverEpoch)) throw new SyncClientError("serverChanged", true);
}
function envelope(value: unknown, expected?: ServerBinding): asserts value is Record<string, unknown> {
	assertRecord(value); binding(value, expected);
	if (value.protocolVersion !== syncProtocolVersion) throw new SyncClientError("protocolMismatch");
}
export function validated<T>(read: () => T): T {
	try { return read(); } catch (error) { if (error instanceof SyncClientError) throw error; throw new SyncClientError("invalidResponse"); }
}
export function replyAggregate(value: unknown, ids = new Set<string>()): ServerAggregate {
	assertRecord(value); check(isUuid(value.id) && aggregates.includes(value.entity as SyncAggregate) && positive(value.version));
	if (value.deletedAt === null) { assertRecord(value.data); check(value.data.id === value.id); validatePayload(value.entity as SyncAggregate, value.data, ids); }
	else { check(value.data === null && utcTimestamp(value.deletedAt, "deletedAt") === value.deletedAt && !ids.has(value.id)); ids.add(value.id); }
	return value as ServerAggregate;
}
export function replyInfo(input: unknown): ServerInfo {
	return validated(() => {
		envelope(input); check(input.schemaVersion === 4); wireCursor(input.cursor);
		assertRecord(input.capabilities); check(input.capabilities.authentication === "none" && input.capabilities.fullAggregates === true && input.capabilities.atomicBatches === true && input.capabilities.manualConflicts === true);
		assertRecord(input.limits); for (const [key, limit] of Object.entries(syncLimits)) check(input.limits[key] === limit);
		check(Array.isArray(input.counts)); const names = new Set();
		for (const count of input.counts) { assertRecord(count); check(syncEntities.includes(count.entity as typeof syncEntities[number]) && !names.has(count.entity)); names.add(count.entity); check(Number.isSafeInteger(count.active) && Number(count.active) >= 0 && Number.isSafeInteger(count.deleted) && Number(count.deleted) >= 0); }
		return input as ServerInfo;
	});
}
export function replySnapshot(input: unknown, expected: ServerBinding, page: number, previous?: SnapshotPage): SnapshotPage {
	return validated(() => {
		envelope(input, expected); check(isUuid(input.snapshotId) && input.page === page && positive(input.pageCount) && input.pageCount <= syncLimits.maxSnapshotPages && page < input.pageCount);
		wireCursor(input.cursor); check(utcTimestamp(input.expiresAt, "expiresAt") === input.expiresAt);
		check(input.nextPage === (page + 1 < input.pageCount ? page + 1 : null));
		if (previous) check(input.snapshotId === previous.snapshotId && input.cursor === previous.cursor && input.pageCount === previous.pageCount && input.expiresAt === previous.expiresAt);
		check(Array.isArray(input.aggregates) && Array.isArray(input.identities)); const ids = new Set<string>(), registry = new Set<string>();
		for (const root of input.aggregates) replyAggregate(root, ids);
		for (const identity of input.identities) {
			assertRecord(identity); check(isUuid(identity.uuid) && isUuid(identity.aggregateUuid) && syncEntities.includes(identity.entity as typeof syncEntities[number]) && positive(identity.version) && !registry.has(identity.uuid)); registry.add(identity.uuid);
			check(identity.deletedAt === null || utcTimestamp(identity.deletedAt, "deletedAt") === identity.deletedAt);
		}
		return input as SnapshotPage;
	});
}
export function replyChanges(input: unknown, expected: ServerBinding, cursor: string): ChangePage {
	return validated(() => {
		envelope(input, expected); check(input.fromCursor === wireCursor(cursor)); const end = Number(wireCursor(input.cursor)), high = Number(wireCursor(input.highWaterCursor));
		check(end >= Number(cursor) && high >= end && input.hasMore === (end < high) && Array.isArray(input.batches) && input.batches.length <= syncLimits.maxPullBatches);
		let position = Number(cursor); const batches = new Set<string>(), revisions = new Map<string, number>();
		for (const batch of input.batches) {
			assertRecord(batch); check(isUuid(batch.batchId) && !batches.has(batch.batchId)); batches.add(batch.batchId);
			check(Number(wireCursor(batch.firstCursor)) === position + 1 && Array.isArray(batch.changes) && batch.changes.length > 0); const ids = new Set<string>();
			for (const change of batch.changes) {
				assertRecord(change); check(Number(wireCursor(change.cursor)) === ++position); const root = replyAggregate(change.aggregate, ids);
				check(root.version > (revisions.get(root.id) ?? 0)); revisions.set(root.id, root.version);
			}
			check(Number(wireCursor(batch.lastCursor)) === position);
		}
		check(position === end && (position > Number(cursor) || !input.hasMore)); return input as ChangePage;
	});
}
export function replyReceipt(input: unknown, request: ServerWriteBatch): ServerReceipt {
	return validated(() => {
		assertRecord(input); binding(input, request); check(input.batchId === request.batchId); wireCursor(input.cursor);
		check(Array.isArray(input.operations) && Array.isArray(input.changes) && input.operations.length === request.operations.length);
		const operations = new Map(request.operations.map((operation) => [operation.operationId, operation])); const changes = new Map<string, Record<string, unknown>>();
		for (const change of input.changes) { assertRecord(change); check(isUuid(change.entityUuid) && aggregates.includes(change.entity as SyncAggregate) && positive(change.serverRevision) && !changes.has(change.entityUuid)); changes.set(change.entityUuid, change); }
		for (const receipt of input.operations) {
			assertRecord(receipt); const operation = operations.get(String(receipt.operationId)); check(operation && receipt.entity === operation.entity && receipt.entityUuid === operation.entityUuid && positive(receipt.serverRevision) && receipt.serverRevision > operation.baseRevision);
			const change = changes.get(operation.entityUuid); check(change && change.entity === operation.entity && change.serverRevision === receipt.serverRevision); operations.delete(operation.operationId);
		}
		check(operations.size === 0); return input as ServerReceipt;
	});
}
