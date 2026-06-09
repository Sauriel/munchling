import type {
	CreateMealLogInput,
	MealLog,
	UpdateMealLogInput,
} from "~/utils/database/repositories";
import {
	createMealLog as createMealLogRecord,
	deleteMealLog as deleteMealLogRecord,
	listMealLogs,
	updateMealLog as updateMealLogRecord,
} from "~/utils/database/repositories";

export function useMealLogs() {
	const mealLogs = useState<MealLog[]>("meal-logs", () => []);
	const isLoading = useState("meal-logs-loading", () => false);

	const refreshMealLogs = async (
		options: { profileId?: number; date?: string } = {},
	) => {
		isLoading.value = true;
		try {
			mealLogs.value = await listMealLogs(options);
		} finally {
			isLoading.value = false;
		}
	};

	const createMealLog = async (
		input: CreateMealLogInput,
		refreshOptions: { profileId?: number; date?: string } = {},
	) => {
		const mealLog = await createMealLogRecord(input);
		await refreshMealLogs(refreshOptions);
		return mealLog;
	};

	const updateMealLog = async (
		id: number,
		input: UpdateMealLogInput,
		refreshOptions: { profileId?: number; date?: string } = {},
	) => {
		const mealLog = await updateMealLogRecord(id, input);
		await refreshMealLogs(refreshOptions);
		return mealLog;
	};

	const deleteMealLog = async (
		id: number,
		refreshOptions: { profileId?: number; date?: string } = {},
	) => {
		const deleted = await deleteMealLogRecord(id);
		await refreshMealLogs(refreshOptions);
		return deleted;
	};

	return {
		mealLogs,
		isLoading,
		refreshMealLogs,
		createMealLog,
		updateMealLog,
		deleteMealLog,
	};
}
