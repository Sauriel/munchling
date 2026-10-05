import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import type { MunchlingBackup } from "../../../shared/domain/backup";

const RECOVERY_PATH = "backups/before-restore.json";

// Directory.Data is app-private on native platforms. The web implementation
// uses IndexedDB, independently of the main SQLite database.
export async function saveRecoveryBackup(backup: MunchlingBackup) {
	await Filesystem.writeFile({
		path: RECOVERY_PATH, directory: Directory.Data,
		data: JSON.stringify(backup), encoding: Encoding.UTF8, recursive: true,
	});
}

export async function hasRecoveryBackup() {
	try {
		await Filesystem.stat({ path: RECOVERY_PATH, directory: Directory.Data });
		return true;
	} catch { return false; }
}

export async function readRecoveryBackup(): Promise<string> {
	const result = await Filesystem.readFile({ path: RECOVERY_PATH, directory: Directory.Data, encoding: Encoding.UTF8 });
	return typeof result.data === "string" ? result.data : result.data.text();
}

export async function exportBackupFile(text: string, prefix = "munchling-backup") {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const filename = `${prefix}-${stamp}.json`;
	if (Capacitor.isNativePlatform()) {
		const file = await Filesystem.writeFile({ path: filename, directory: Directory.Cache, data: text, encoding: Encoding.UTF8 });
		await Share.share({ title: "Munchling", url: file.uri });
		return;
	}
	const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	link.remove();
	// Give the browser time to consume the download URL.
	setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
