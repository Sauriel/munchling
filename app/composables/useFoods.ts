import type {
	CreateFoodInput,
	Food,
	UpdateFoodInput,
} from "../../shared/domain/types";
import { useMunchlingData } from "./useMunchlingData";

export function useFoods() {
	const { listFoods, getFoodByEan, getFoodByNameDe, createFood: createFoodRecord, updateFood: updateFoodRecord, deleteFood: deleteFoodRecord } = useMunchlingData().foods;
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

	const updateFood = async (id: number, input: UpdateFoodInput, revision?: number) => {
		const food = await updateFoodRecord(id, input, revision);
		await refreshFoods();
		return food;
	};

	const deleteFood = async (id: number, revision?: number) => {
		const deleted = await deleteFoodRecord(id, revision);
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
		getFoodByNameDe,
	};
}
