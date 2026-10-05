import { MAX_BACKUP_BYTES, parseBackupJson, type MunchlingBackup } from "../../shared/domain/backup";
import { DomainValidationError } from "../../shared/domain/validation";
import { exportBackupFile, hasRecoveryBackup, readRecoveryBackup, saveRecoveryBackup } from "~/utils/backup/files";
import { useMunchlingData } from "./useMunchlingData";
import { useProfiles } from "./useProfiles";
import { useFoods } from "./useFoods";
import { useRecipes } from "./useRecipes";
import { useMealLogs } from "./useMealLogs";
import { useCurrentProfile } from "./useCurrentProfile";

export function useLocalBackups() {
	const { t } = useI18n();
	const backups = useMunchlingData().backups;
	const isBusy = ref(false);
	const error = ref("");
	const success = ref("");
	const pendingBackup = shallowRef<MunchlingBackup | null>(null);
	const recoveryAvailable = ref(false);
	const { refreshProfiles } = useProfiles();
	const { refreshFoods } = useFoods();
	const { refreshRecipes, selectedRecipe } = useRecipes();
	const { refreshMealLogs } = useMealLogs();
	const { selectProfile, initializeCurrentProfile } = useCurrentProfile();

	async function run(work: () => Promise<void>) {
		if (isBusy.value) return;
		isBusy.value = true;
		error.value = "";
		success.value = "";
		try { await work(); } catch (cause) {
			error.value = cause instanceof DomainValidationError
				? t(`validation.${cause.code}`)
				: t("settings.backup.actionError");
		} finally { isBusy.value = false; }
	}

	async function exportCurrent() {
		if (!backups) return;
		await run(async () => {
			const backup = await backups.exportBackup();
			await exportBackupFile(JSON.stringify(backup, null, 2));
		});
	}
	async function selectFile(file: File) {
		pendingBackup.value = null;
		await run(async () => {
			if (file.size > MAX_BACKUP_BYTES) throw new DomainValidationError("backupLimit", "backup");
			pendingBackup.value = parseBackupJson(await file.text());
		});
	}
	async function restore() {
		const candidate = pendingBackup.value;
		if (!backups || !candidate) return;
		await run(async () => {
			await backups.restoreBackup(candidate, async (previous) => {
				await saveRecoveryBackup(previous);
				recoveryAvailable.value = true;
			});
			pendingBackup.value = null;
			selectedRecipe.value = null;
			selectProfile(null);
			await Promise.all([refreshProfiles(), refreshFoods(), refreshRecipes(), refreshMealLogs()]);
			await initializeCurrentProfile();
			success.value = t("settings.backup.restored");
		});
	}
	async function exportRecovery() {
		await run(async () => exportBackupFile(await readRecoveryBackup(), "munchling-before-restore"));
	}
	onMounted(async () => { recoveryAvailable.value = await hasRecoveryBackup(); });

	return { supported: Boolean(backups), isBusy, error, success, pendingBackup, recoveryAvailable, exportCurrent, selectFile, restore, exportRecovery };
}
