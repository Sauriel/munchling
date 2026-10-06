import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import * as Vue from "vue";
import { parse, compileScript } from "vue/compiler-sfc";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import { describe, it, expect, vi } from "vitest";
import { SyncClientError } from "../../shared/domain/replies";

// Compile only this fixed repository SFC, no template/DOM dependency. The real
// setup hooks execute under Vue's renderer; a child reproduces the busy event
// before its parent's mounted hook. No real SQL, filesystem or HTTP services.
function component() {
	const state = { url: "https://bound.test", cursor: "0", localEpoch: "local", serverInstanceId: "server", serverEpoch: "epoch", seeded: false, enabled: false };
	const readAddress = vi.fn(async () => state.url), readStatus = vi.fn(async () => ({ state, pending: 28, uncertain: false, blocked: 0 }));
	const stage = { progress: async () => null, state: async () => state }, network = vi.fn();
	const imports: Record<string, unknown> = {
		vue: Vue,
		"@capacitor/core": { Capacitor: { isNativePlatform: () => true } },
		"~/utils/database/sql": { databaseSql: {} },
		"~/utils/sync/staging": { createSnapshotStaging: () => stage },
		"~/utils/sync/http": { createSyncHttpClient: network },
		"~/utils/sync/address": { createSyncAddressSettings: () => ({ read: readAddress }) },
		"~/utils/sync/runner": { createManualSyncRunner: () => ({ status: readStatus }) },
		"../../shared/domain/replies": { SyncClientError },
	};
	const localRefresh = async () => {};
	const data = { refreshProfiles: localRefresh, refreshFoods: localRefresh, refreshRecipes: localRefresh, refreshMealLogs: localRefresh, selectedRecipe: Vue.ref(null), initializeCurrentProfile: localRefresh };
	const text = readFileSync(new URL("../../app/components/SyncPreparation.client.vue", import.meta.url), "utf8");
	const compiled = compileScript(parse(text).descriptor, { id: "sync-settings-mount-test", genDefaultAs: "Settings" }).content;
	const output = transpileModule(`${compiled}\nexports.Settings = Settings;`, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
	const exports: Record<string, any> = {};
	new Script(output, { filename: "fixed-sync-settings-test.cjs" }).runInNewContext({
		exports, require: (name: string) => { if (!(name in imports)) throw new Error("Unexpected SFC test dependency"); return imports[name]; },
		ref: Vue.ref, shallowRef: Vue.shallowRef, computed: Vue.computed, watch: Vue.watch, onMounted: Vue.onMounted, onBeforeUnmount: Vue.onBeforeUnmount,
		useI18n: () => ({ t: (key: string) => key, te: () => false }), useProfiles: () => data, useFoods: () => data, useRecipes: () => data, useMealLogs: () => data, useCurrentProfile: () => data,
		AbortController,
	});
	return { Settings: exports.Settings, readAddress, readStatus, network };
}

describe("native settings mounted lifecycle", () => {
	it("loads persistent address and runner state even when its child mounted hook reports busy first", async () => {
		const { Settings, readAddress, readStatus, network } = component();
		const Child = Vue.defineComponent({ emits: ["busy"], setup(_props, { emit }) { Vue.onMounted(() => emit("busy", true)); return () => Vue.h("child"); } });
		Settings.render = function (this: any) { const parent = this.$; return Vue.h(Child, { onBusy: (value: boolean) => { parent.setupState.decisionBusy = value; } }); };
		const renderer = Vue.createRenderer<any, any>({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText: () => {}, setElementText: () => {}, parentNode: () => null, nextSibling: () => null, insert: () => {}, remove: () => {}, patchProp: () => {} });
		const app = renderer.createApp(Settings);
		try {
			app.mount({}); await vi.waitFor(() => expect(readStatus).toHaveBeenCalledOnce()); await Vue.nextTick();
			expect(readAddress).toHaveBeenCalledOnce(); expect(network).not.toHaveBeenCalled();
			const setup = app._instance!.setupState;
			expect(setup.address).toBe("https://bound.test"); expect(setup.boundUrl).toBe("https://bound.test"); expect(setup.manual.pending).toBe(28);
			expect(setup.decisionBusy).toBe(true); expect(setup.busy).toBe(false);
		} finally { app.unmount(); }
	});
});
