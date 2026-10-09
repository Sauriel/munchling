import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import * as Vue from "vue";
import { parse, compileScript } from "vue/compiler-sfc";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import { describe, it, expect, vi } from "vitest";
import { SyncClientError } from "../../shared/domain/replies";
import { syncServerUrl } from '../../app/utils/sync/http';

// Compile only this fixed repository SFC, no template/DOM dependency. The real
// setup hooks execute under Vue's renderer; a child reproduces the busy event
// before its parent's mounted hook. No real SQL, filesystem or HTTP services.
function component(trusted = true) {
	const state = { url: "https://bound.test", cursor: "0", localEpoch: "local", serverInstanceId: "server", serverEpoch: "epoch", seeded: false, enabled: false };
	const readAddress = vi.fn(async () => state.url), readStatus = vi.fn(async () => ({ state, pending: 28, uncertain: false, blocked: 0 }));
	const stage = { progress: async () => null, state: async () => state }, network = vi.fn();
	const isTrusted = vi.fn(async (url: string) => trusted && url === state.url), trust = vi.fn(async (url: string) => { trusted = true; return url; }), revoke = vi.fn(async () => { trusted = false; });
	const imports: Record<string, unknown> = {
		vue: Vue,
		"@capacitor/core": { Capacitor: { isNativePlatform: () => true } },
		"~/utils/database/sql": { databaseSql: {} },
		"~/utils/sync/staging": { createSnapshotStaging: () => stage },
		"~/utils/sync/http": { createSyncHttpClient: network, syncServerUrl },
		"~/utils/sync/address": { createSyncAddressSettings: () => ({ read: readAddress, isTrusted, trust, revoke }) },
		"~/utils/sync/runner": { createManualSyncRunner: () => ({ status: readStatus }) },
		"../../shared/domain/replies": { SyncClientError },
	};
	const localRefresh = async () => {};
	const data = { refreshProfiles: localRefresh, refreshFoods: localRefresh, refreshRecipes: localRefresh, refreshMealLogs: localRefresh, refreshActivities: localRefresh, selectedRecipe: Vue.ref(null), initializeCurrentProfile: localRefresh };
	const text = readFileSync(new URL("../../app/components/SyncPreparation.client.vue", import.meta.url), "utf8");
	const compiled = compileScript(parse(text).descriptor, { id: "sync-settings-mount-test", genDefaultAs: "Settings" }).content;
	const output = transpileModule(`${compiled}\nexports.Settings = Settings;`, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
	const exports: Record<string, any> = {};
	new Script(output, { filename: "fixed-sync-settings-test.cjs" }).runInNewContext({
		exports, require: (name: string) => { if (!(name in imports)) throw new Error("Unexpected SFC test dependency"); return imports[name]; },
		ref: Vue.ref, shallowRef: Vue.shallowRef, computed: Vue.computed, watch: Vue.watch, onMounted: Vue.onMounted, onBeforeUnmount: Vue.onBeforeUnmount,
		useActivities: () => data,
		useI18n: () => ({ t: (key: string) => key, te: () => false }), useProfiles: () => data, useFoods: () => data, useRecipes: () => data, useMealLogs: () => data, useCurrentProfile: () => data,
		AbortController,
	});
	return { Settings: exports.Settings, readAddress, readStatus, network, isTrusted, trust, revoke };
}

function mount(Settings: any) {
	Settings.render = () => Vue.h('settings');
	const renderer = Vue.createRenderer<any, any>({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText: () => {}, setElementText: () => {}, parentNode: () => null, nextSibling: () => null, insert: () => {}, remove: () => {}, patchProp: () => {} });
	const app = renderer.createApp(Settings); app.mount({}); return app;
}
describe("native settings mounted lifecycle", () => {
	it('never invents approval on startup, persists explicit changes and revokes immediately on an address change', async () => {
		const c = component(false), app = mount(c.Settings);
		try {
			await vi.waitFor(() => expect(c.readStatus).toHaveBeenCalledOnce()); const setup = app._instance!.setupState;
			expect(setup.secure).toBe(false); expect(c.trust).not.toHaveBeenCalled(); expect(c.network).not.toHaveBeenCalled();
			await setup.setConsent(true); expect(c.trust).toHaveBeenCalledWith('https://bound.test'); expect(setup.secure).toBe(true);
			c.isTrusted.mockResolvedValueOnce(false); await setup.inspect(); expect(setup.secure).toBe(false); expect(c.network).not.toHaveBeenCalled();
			await setup.setConsent(true);
			setup.address = 'https://other.test'; expect(setup.secure).toBe(false); await Vue.nextTick(); expect(c.revoke).toHaveBeenCalledOnce();
			setup.address = 'https://bound.test'; expect(setup.secure).toBe(false); expect(c.network).not.toHaveBeenCalled();
			await setup.setConsent(true); await setup.setConsent(false); expect(setup.secure).toBe(false); expect(c.revoke).toHaveBeenCalledTimes(2);
		} finally { app.unmount(); }
	});
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
			expect(setup.decisionBusy).toBe(true); expect(setup.busy).toBe(false); expect(setup.secure).toBe(true);
		} finally { app.unmount(); }
	});
});
