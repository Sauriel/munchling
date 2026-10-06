import type { SnapshotPage, ServerBinding } from "./protocol";
import { syncLimits } from "./protocol";
import { SyncClientError, replySnapshot, validated } from "./replies";
import { completeSnapshot } from "./snapshot";
import { syncEntities, type SyncEntity } from "./sync";
export type WebViewId = { entity: SyncEntity; uuid: string; id: number };
// A single consistent read, not a leased/resumable sync download.
export type WebState = { snapshot: SnapshotPage; viewIds: WebViewId[] };
export function replyWebState(input: unknown, binding: ServerBinding): WebState {
	return validated(() => {
		const value = input as WebState;
		if (!value || !Array.isArray(value.viewIds)) throw new SyncClientError("invalidResponse");
		const snapshot = replySnapshot(value.snapshot, binding, 0); completeSnapshot([snapshot]);
		if (value.viewIds.length > syncLimits.maxSnapshotRecords) throw new SyncClientError("responseTooLarge");
		const registry = new Map(snapshot.identities.map(row => [row.uuid, row])), uuids = new Set<string>(), ids = new Set<string>();
		for (const row of value.viewIds) {
			const meta = row && registry.get(row.uuid), key = `${row?.entity}:${row?.id}`;
			if (!meta || meta.entity !== row.entity || !syncEntities.includes(row.entity) || !Number.isSafeInteger(row.id) || row.id <= 0 || ids.has(key) || uuids.has(row.uuid)) throw new SyncClientError("invalidResponse");
			ids.add(key); uuids.add(row.uuid);
		}
		for (const meta of snapshot.identities) if (meta.deletedAt === null && !uuids.has(meta.uuid)) throw new SyncClientError("invalidResponse");
		return { snapshot, viewIds: value.viewIds };
	});
}
