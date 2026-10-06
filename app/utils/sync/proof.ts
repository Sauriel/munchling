import type { ServerBinding, SnapshotPage } from "../../../shared/domain/protocol";
import { completeSnapshot } from "../../../shared/domain/snapshot";
import { createSyncHttpClient } from "./http";
// Explicit user action only. Proofs are newly materialized server cuts; old
// staged pages alone must never authorize a stale manual decision.
export async function fetchDecisionProof(url: string, binding: ServerBinding, signal?: AbortSignal): Promise<SnapshotPage[]> {
	const client = createSyncHttpClient(url), pages: SnapshotPage[] = [];
	try {
		for await (const page of client.snapshotPages({ serverInstanceId: binding.serverInstanceId, serverEpoch: binding.serverEpoch }, signal)) pages.push(page);
		completeSnapshot(pages); return pages;
	} finally {
		if (pages[0]) try { await client.releaseSnapshot(pages[0], signal); } catch { /* Lease expiry is independent; no local rollback needed. */ }
	}
}
