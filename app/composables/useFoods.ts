import type {
	CreateFoodInput,
	Food,
	UpdateFoodInput,
} from "~/utils/database/repositories";
import {
	createFood as createFoodRecord,
	deleteFood as deleteFoodRecord,
	getFoodByEan,
	listFoods,
	updateFood as updateFoodRecord,
} from "~/utils/database/repositories";

export function useFoods() {
	const foods = useState<Food[]>("foods", () => []);
	const searchTerm = useState("foods-search-term", () => "");
	const isLoading = useState("foods-loading", () => false);

	const refreshFoods = async (nextSearchTerm = searchTerm.value) => {
		searchTerm.value = nextSearchTerm;
		isLoading.value = true;
		try {
			foods.value = await listFoods(nextSearchTerm);
		} finally {
			isLoading.value = false;
		}
	};

	const createFood = async (input: CreateFoodInput) => {
		const food = await createFoodRecord(input);
		await refreshFoods();
		return food;
	};

	const updateFood = async (id: number, input: UpdateFoodInput) => {
		const food = await updateFoodRecord(id, input);
		await refreshFoods();
		return food;
	};

	const deleteFood = async (id: number) => {
		const deleted = await deleteFoodRecord(id);
		await refreshFoods();
		return deleted;
	};

	return {
		foods,
		searchTerm,
		isLoading,
		refreshFoods,
		createFood,
		updateFood,
		deleteFood,
		getFoodByEan,
	};
}
