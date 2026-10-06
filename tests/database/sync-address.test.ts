import { describe, it, expect } from "vitest";
import { createTestDatabase } from "../helpers/sqlite";
import { createSyncAddressSettings } from "../../app/utils/sync/address";

describe("remembered sync address", () => {
	it("persists a normalized draft across restart without binding, enabling or uploading", async () => {
		const a = await createTestDatabase(); let b: typeof a | undefined;
		try {
			const settings = createSyncAddressSettings(a.database);
			expect(await settings.remember(" https://munchling.homelab.lan/ ")).toBe("https://munchling.homelab.lan");
			b = await createTestDatabase({ bytes: a.exportBytes() });
			expect(await createSyncAddressSettings(b.database).read()).toBe("https://munchling.homelab.lan");
			expect(await b.database.query("SELECT enabled,server_url,server_instance_id,pull_cursor FROM sync_state;")).toEqual([{ enabled: 0, server_url: null, server_instance_id: null, pull_cursor: null }]);
			await expect(settings.remember("https://user:password@invalid.test/")).rejects.toThrow("invalidServerUrl");
			expect(await settings.read()).toBe("https://munchling.homelab.lan");
		} finally { a.close(); b?.close(); }
	});
	it("shows an authoritative binding and refuses a silently different draft", async () => {
		const a = await createTestDatabase();
		try {
			await a.database.run("UPDATE sync_state SET server_url='https://bound.test',draft_url='https://old.test' WHERE id=1;");
			const settings = createSyncAddressSettings(a.database);
			expect(await settings.read()).toBe("https://bound.test");
			await expect(settings.remember("https://other.test")).rejects.toThrow("serverChanged");
			expect(await settings.read()).toBe("https://bound.test");
		} finally { a.close(); }
	});
});
