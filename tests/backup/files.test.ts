import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MunchlingBackup } from "../../shared/domain/backup";

const mocks = vi.hoisted(() => ({
	writeFile: vi.fn(), readFile: vi.fn(), stat: vi.fn(), share: vi.fn(),
	isNativePlatform: vi.fn(() => true),
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: mocks.isNativePlatform } }));
vi.mock("@capacitor/filesystem", () => ({
	Directory: { Data: "DATA", Cache: "CACHE" }, Encoding: { UTF8: "utf8" },
	Filesystem: { writeFile: mocks.writeFile, readFile: mocks.readFile, stat: mocks.stat },
}));
vi.mock("@capacitor/share", () => ({ Share: { share: mocks.share } }));

import { exportBackupFile, hasRecoveryBackup, readRecoveryBackup, saveRecoveryBackup, saveMigrationBackup, hasMigrationBackup, readMigrationBackup } from "../../app/utils/backup/files";

const backup: MunchlingBackup = {
	format: "munchling-backup", version: 1, schemaVersion: 1, exportedAt: "2026-10-05T12:00:00Z",
	data: { profiles: [], foods: [], recipes: [], recipeIngredients: [], mealLogs: [], mealLogProfiles: [] },
};

describe("native backup file boundary", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.isNativePlatform.mockReturnValue(true);
		mocks.writeFile.mockResolvedValue({ uri: "file:///cache/export.json" });
	});
	it("saves safety backups in the app-private directory, not disposable cache", async () => {
		await saveRecoveryBackup(backup);
		expect(mocks.writeFile).toHaveBeenCalledWith({
			path: "backups/before-restore.json", directory: "DATA", data: JSON.stringify(backup), encoding: "utf8", recursive: true,
		});
		expect(mocks.share).not.toHaveBeenCalled();
	});
	it("propagates failed safety writes to abort the database restore", async () => {
		mocks.writeFile.mockRejectedValueOnce(new Error("disk full"));
		await expect(saveRecoveryBackup(backup)).rejects.toThrow("disk full");
	});
	it("keeps the pre-migration snapshot separate from the restore recovery file", async () => {
		await saveMigrationBackup(backup);
		expect(mocks.writeFile).toHaveBeenCalledWith({ path: "backups/before-schema-v2.json", directory: "DATA", data: JSON.stringify(backup), encoding: "utf8", recursive: true });
		expect(mocks.share).not.toHaveBeenCalled();
	});
	it("propagates failed pre-migration writes", async () => {
		mocks.writeFile.mockRejectedValueOnce(new Error("disk full"));
		await expect(saveMigrationBackup(backup)).rejects.toThrow("disk full");
	});
	it("reads UTF-8 recovery backups", async () => {
		mocks.readFile.mockResolvedValue({ data: JSON.stringify(backup) });
		expect(await readRecoveryBackup()).toBe(JSON.stringify(backup));
		expect(mocks.readFile).toHaveBeenCalledWith({ path: "backups/before-restore.json", directory: "DATA", encoding: "utf8" });
	});
	it("detects and reads the separate schema-upgrade backup", async () => {
		mocks.stat.mockRejectedValueOnce(new Error("missing"));
		expect(await hasMigrationBackup()).toBe(false);
		mocks.stat.mockResolvedValueOnce({ size: 100 });
		expect(await hasMigrationBackup()).toBe(true);
		mocks.readFile.mockResolvedValueOnce({ data: JSON.stringify(backup) });
		expect(await readMigrationBackup()).toBe(JSON.stringify(backup));
		expect(mocks.readFile).toHaveBeenCalledWith({ path: "backups/before-schema-v2.json", directory: "DATA", encoding: "utf8" });
	});
	it("detects missing recovery files", async () => {
		mocks.stat.mockResolvedValueOnce({ size: 100 });
		expect(await hasRecoveryBackup()).toBe(true);
		mocks.stat.mockRejectedValueOnce(new Error("missing"));
		expect(await hasRecoveryBackup()).toBe(false);
	});
	it("uses shareable cache for a native export", async () => {
		await exportBackupFile(JSON.stringify(backup));
		expect(mocks.writeFile).toHaveBeenCalledWith(expect.objectContaining({ directory: "CACHE", encoding: "utf8" }));
		expect(mocks.share).toHaveBeenCalledWith({ title: "Munchling", url: "file:///cache/export.json" });
	});
	it("does not open the share dialog after a failed export write", async () => {
		mocks.writeFile.mockRejectedValueOnce(new Error("write failed"));
		await expect(exportBackupFile("{}")).rejects.toThrow("write failed");
		expect(mocks.share).not.toHaveBeenCalled();
	});
});
