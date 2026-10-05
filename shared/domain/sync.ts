export const syncEntities = ["profiles", "foods", "recipes", "recipe_ingredients", "meal_logs", "meal_log_profiles"] as const;
export type SyncEntity = typeof syncEntities[number];
export type SyncAggregate = "profiles" | "foods" | "recipes" | "meal_logs";
export type SyncIdentity = { entity: SyncEntity; localId: number; uuid: string };
export type SyncTombstone = { entity: SyncEntity; uuid: string; aggregateEntity: SyncAggregate; aggregateUuid: string; deletedAt: string };
export type OutboxOperation = {
	sequence: number; batchId: string; operationId: string;
	entity: SyncAggregate; entityUuid: string; operation: "upsert" | "delete";
	localRevision: number; baseRevision: number;
	payload: Record<string, unknown>; status: "pending" | "inflight";
};

export function isUuid(value: unknown): value is string {
	return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}
export function createUuid(): string {
	if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	bytes[6] = (bytes[6]! & 15) | 64;
	bytes[8] = (bytes[8]! & 63) | 128;
	const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
