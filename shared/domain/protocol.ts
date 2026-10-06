import type { ServerAggregate } from "./server";
import type { SyncEntity } from "./sync";

export const syncProtocolVersion = 1;
export const syncLimits = {
	pushBytes: 25 * 1024 * 1024, batchBytes: 32 * 1024 * 1024,
	defaultPageBytes: 256 * 1024, minPageBytes: 64 * 1024, maxPageBytes: 1024 * 1024,
	maxPullBatches: 100, snapshotMinutes: 30, maxSnapshots: 4,
	maxSnapshotBytes: 256 * 1024 * 1024, maxSnapshotPages: 4096, maxSnapshotRecords: 1_000_000,
} as const;
export type ServerBinding = { serverInstanceId: string; serverEpoch: string };
export type ServerInfo = ServerBinding & {
	protocolVersion: number; schemaVersion: number; cursor: string;
	counts: { entity: string; active: number; deleted: number }[];
	capabilities: { authentication: "none"; fullAggregates: true; manualConflicts: true; atomicBatches: true };
	limits: typeof syncLimits;
};
export type SnapshotIdentity = { uuid: string; entity: SyncEntity; aggregateUuid: string; version: number; deletedAt: string | null };
export type SnapshotFragment = { aggregates: ServerAggregate[]; identities: SnapshotIdentity[] };
export type SnapshotPage = ServerBinding & SnapshotFragment & {
	protocolVersion: number; snapshotId: string; cursor: string; expiresAt: string;
	page: number; pageCount: number; nextPage: number | null;
};
export type ChangeBatch = { batchId: string; firstCursor: string; lastCursor: string; changes: { cursor: string; aggregate: ServerAggregate }[] };
export type ChangePage = ServerBinding & { protocolVersion: number; fromCursor: string; cursor: string; highWaterCursor: string; hasMore: boolean; batches: ChangeBatch[] };
export type ProtocolCode = "cursorInvalid" | "snapshotExpired" | "snapshotBusy" | "snapshotLimit" | "batchTooLarge" | "protocolMismatch" | "invalidRequest" | "DB_READ_FAILED";
export class ServerProtocolError extends Error {
	constructor(public readonly code: ProtocolCode) { super(code); this.name = "ServerProtocolError"; }
}
export type SyncApiError = { error: { code: string; field?: string; current?: ServerAggregate[]; resync: boolean; retryable: boolean } };
