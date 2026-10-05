import type { SyncAggregate } from "./sync";

// UUID-addressed full aggregate writes, shared by future web CRUD and sync.
// Stored payloads use the local outbox's snake_case snapshot fields. Technical
// timestamps are UTC; historical logged_at literals retain their timezone/wall-
// clock semantics. Numeric SQLite/view IDs are not identities.
export type ServerOperation = {
	operationId: string; entity: SyncAggregate; entityUuid: string;
	baseRevision: number; operation: "upsert" | "delete"; payload: Record<string, unknown>;
};
export type ServerGuard = { entity: SyncAggregate; entityUuid: string; baseRevision: number };
export type ServerWriteBatch = {
	batchId: string; serverInstanceId: string; serverEpoch: string; deviceId?: string;
	operations: ServerOperation[]; guards?: ServerGuard[];
};
export type ServerAggregate = { entity: SyncAggregate; id: string; version: number; deletedAt: string | null; data: Record<string, unknown> | null };
export type ServerReceipt = {
	batchId: string; serverInstanceId: string; serverEpoch: string; cursor: string;
	operations: { operationId: string; entity: SyncAggregate; entityUuid: string; serverRevision: number }[];
	changes: { entity: SyncAggregate; entityUuid: string; serverRevision: number }[];
};
export type ServerWriteCode = "versionConflict" | "dependencyConflict" | "identityConflict" | "idempotencyConflict" | "serverChanged";
export class ServerWriteError extends Error {
	constructor(public readonly code: ServerWriteCode, public readonly current: ServerAggregate[] = []) {
		super(code); this.name = "ServerWriteError";
	}
}
