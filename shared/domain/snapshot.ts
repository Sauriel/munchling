import type { ServerAggregate } from "./server";
import type { SnapshotIdentity, SnapshotPage } from "./protocol";
import { replyAggregate, replySnapshot, SyncClientError, validated } from "./replies";
import { validateRecipeGraph } from "./validation";
export type CompleteSnapshot = { first: SnapshotPage; aggregates: ServerAggregate[]; identities: SnapshotIdentity[] };
export function completeSnapshot(pages: SnapshotPage[]): CompleteSnapshot {
	return validated(() => {
		const first = pages[0]; if (!first || first.page !== 0 || pages.length !== first.pageCount) throw new SyncClientError("incompleteSnapshot");
		const aggregates: ServerAggregate[] = [], identities: SnapshotIdentity[] = [], ids = new Set<string>();
		for (let index = 0; index < pages.length; index++) {
			const page = replySnapshot(pages[index], first, index, first);
			for (const root of page.aggregates) { replyAggregate(root, ids); aggregates.push(root); }
			identities.push(...page.identities);
		}
		const roots = new Map(aggregates.map((root) => [root.id, root]));
		const registry = new Map(identities.map((row) => [row.uuid, row]));
		if (registry.size !== identities.length) throw new SyncClientError("invalidResponse");
		const checkReference = (id: unknown, entity: string) => { const root = roots.get(String(id)); if (!root || root.entity !== entity || root.deletedAt !== null) throw new SyncClientError("invalidResponse"); };
		const childRows = new Map<string, { entity: string; owner: string }>(); const edges: { recipeId: string; subRecipeId: string | null }[] = [], eans = new Set<string>();
		for (const root of aggregates) {
			const meta = registry.get(root.id);
			if (!meta || meta.entity !== root.entity || meta.aggregateUuid !== root.id || meta.version !== root.version || meta.deletedAt !== root.deletedAt) throw new SyncClientError("invalidResponse");
			if (!root.data) continue;
			if (root.entity === "foods" && root.data.ean !== null) { const ean = String(root.data.ean); if (eans.has(ean)) throw new SyncClientError("invalidResponse"); eans.add(ean); }
			if (root.entity === "recipes") for (const child of root.data.ingredients as Record<string, unknown>[]) {
				if (child.food_id !== null) checkReference(child.food_id, "foods"); if (child.sub_recipe_id !== null) checkReference(child.sub_recipe_id, "recipes");
				edges.push({ recipeId: root.id, subRecipeId: child.sub_recipe_id as string | null }); childRows.set(String(child.id), { entity: "recipe_ingredients", owner: root.id });
			}
			if (root.entity === "activity_logs") checkReference(root.data.profile_id, "profiles");
			if (root.entity === "meal_logs") {
				if (root.data.food_id !== null) checkReference(root.data.food_id, "foods"); if (root.data.recipe_id !== null) checkReference(root.data.recipe_id, "recipes");
				for (const child of root.data.profiles as Record<string, unknown>[]) { checkReference(child.profile_id, "profiles"); childRows.set(String(child.id), { entity: "meal_log_profiles", owner: root.id }); }
			}
		}
		for (const [id, child] of childRows) { const meta = registry.get(id); if (!meta || meta.entity !== child.entity || meta.aggregateUuid !== child.owner || meta.deletedAt !== null) throw new SyncClientError("invalidResponse"); }
		for (const meta of identities) {
			if (!roots.has(meta.aggregateUuid)) throw new SyncClientError("invalidResponse");
			const owner = roots.get(meta.aggregateUuid)!;
			if (meta.uuid !== meta.aggregateUuid && meta.entity !== (owner.entity === "recipes" ? "recipe_ingredients" : owner.entity === "meal_logs" ? "meal_log_profiles" : "")) throw new SyncClientError("invalidResponse");
			if (meta.deletedAt === null && !ids.has(meta.uuid)) throw new SyncClientError("invalidResponse");
		}
		validateRecipeGraph(edges); return { first, aggregates, identities };
	});
}
