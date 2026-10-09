import { describe, it, expect } from "vitest";
import { createTestDatabase } from "../helpers/sqlite";
import { createSqlDatabase } from '../../app/utils/database/executor';
import { runLocalMigrations } from '../../app/utils/database/migrations';
import { createSyncDisconnect } from '../../app/utils/sync/disconnect';
import { createUuid } from '../../shared/domain/sync';
import { createSyncAddressSettings } from "../../app/utils/sync/address";

describe("remembered sync address", () => {
	it('keeps explicit normalized consent through restart, revokes it, and never transfers it to another draft', async () => {
		const a = await createTestDatabase(); let b: typeof a | undefined;
		try {
			const settings = createSyncAddressSettings(a.database);
			await settings.remember('https://a.test'); expect(await settings.isTrusted('https://a.test')).toBe(false);
			await settings.trust(' https://a.test/ '); expect(await settings.isTrusted('https://a.test/')).toBe(true);
			b = await createTestDatabase({ bytes: a.exportBytes() }); const restored = createSyncAddressSettings(b.database);
			expect(await restored.isTrusted(await restored.read())).toBe(true);
			await restored.remember('https://b.test'); expect(await restored.isTrusted('https://b.test')).toBe(false);
			await restored.remember('https://a.test'); expect(await restored.isTrusted('https://a.test')).toBe(false);
			await restored.trust('https://a.test'); await restored.revoke(); expect(await restored.isTrusted('https://a.test')).toBe(false);
			await expect(restored.trust('')).rejects.toThrow('invalidServerUrl'); await expect(restored.trust('https://user:secret@a.test')).rejects.toThrow('invalidServerUrl');
			expect(await restored.isTrusted('')).toBe(false);
			expect(await b.database.query('SELECT enabled,server_url,server_instance_id,pull_cursor FROM sync_state;')).toEqual([{ enabled: 0,server_url: null,server_instance_id: null,pull_cursor: null }]);
			expect(await b.database.query('SELECT * FROM sync_outbox;')).toEqual([]);
		} finally { a.close(); b?.close(); }
	});
	it('upgrades v6 without granting existing bindings permission or changing business data and queued writes', async () => {
		const a = await createTestDatabase({ version: 6 });
		try {
			await a.service.profiles.createProfile({ name: 'Legacy',dailyCaloriesTarget: 2000 });
			await a.database.run("UPDATE sync_state SET server_url='https://bound.test',draft_url='https://bound.test' WHERE id=1;");
			const data = await a.service.backups!.exportBackup(), queue = await a.database.query('SELECT * FROM sync_outbox;');
			await runLocalMigrations(createSqlDatabase(a.driver),async () => {});
			const settings = createSyncAddressSettings(a.database); expect(await settings.read()).toBe('https://bound.test'); expect(await settings.isTrusted('https://bound.test')).toBe(false);
			expect((await a.service.backups!.exportBackup()).data).toEqual(data.data); expect(await a.database.query('SELECT * FROM sync_outbox;')).toEqual(queue);
			await settings.trust('https://bound.test'); await expect(settings.trust('https://other.test')).rejects.toThrow('serverChanged'); expect(await settings.isTrusted('https://bound.test')).toBe(true);
		} finally { a.close(); }
	});
	it('does not export consent and invalidates it when a restore or explicit disconnect renews the local epoch', async () => {
		const a = await createTestDatabase();
		try {
			const settings = createSyncAddressSettings(a.database); await settings.trust('https://a.test');
			const backup = await a.service.backups!.exportBackup(); expect(JSON.stringify(backup)).not.toContain('https://a.test');
			await a.service.backups!.restoreBackup(backup,async () => {}); expect(await settings.isTrusted('https://a.test')).toBe(false);
			await settings.trust('https://a.test'); await a.database.run('UPDATE sync_state SET server_url=?,server_instance_id=?,server_epoch=?,pull_cursor=? WHERE id=1;', ['https://a.test',createUuid(),createUuid(),'0']);
			const disconnect = createSyncDisconnect(a.database,async () => {}), preview = await disconnect.preview(); await disconnect.commit(preview.token,true);
			expect(await settings.isTrusted('https://a.test')).toBe(false); await settings.remember('https://a.test'); expect(await settings.isTrusted('https://a.test')).toBe(false);
		} finally { a.close(); }
	});
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
