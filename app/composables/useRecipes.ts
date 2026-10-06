import type {
	CreateRecipeInput,
	Recipe,
	RecipeIngredientInput,
	RecipeWithIngredients,
	UpdateRecipeInput,
} from "../../shared/domain/types";
import { useMunchlingData } from "./useMunchlingData";

export function useRecipes() {
	const {
		addRecipeIngredient, calculateRecipeNutrition, getRecipeWithIngredients,
		listRecipes, replaceRecipeIngredients, createRecipe: createRecipeRecord,
		updateRecipe: updateRecipeRecord, deleteRecipe: deleteRecipeRecord,
	} = useMunchlingData().recipes;
	const recipes = useState<Recipe[]>("recipes", () => []);
	const selectedRecipe = useState<RecipeWithIngredients | null>(
		"selected-recipe",
		() => null,
	);
	const isLoading = useState("recipes-loading", () => false);

	const refreshRecipes = async () => {
		isLoading.value = true;
		try {
			recipes.value = await listRecipes();
		} finally {
			isLoading.value = false;
		}
	};

	const loadRecipe = async (id: number) => {
		selectedRecipe.value = await getRecipeWithIngredients(id);
		return selectedRecipe.value;
	};

	const createRecipe = async (input: CreateRecipeInput) => {
		const recipe = await createRecipeRecord(input);
		await refreshRecipes();
		return recipe;
	};

	const updateRecipe = async (id: number, input: UpdateRecipeInput, revision?: number) => {
		const recipe = await updateRecipeRecord(id, input, revision);
		await refreshRecipes();
		selectedRecipe.value = recipe;
		return recipe;
	};

	const deleteRecipe = async (id: number, revision?: number) => {
		const deleted = await deleteRecipeRecord(id, revision);
		if (selectedRecipe.value?.id === id) {
			selectedRecipe.value = null;
		}
		await refreshRecipes();
		return deleted;
	};

	const addIngredient = async (
		recipeId: number,
		input: RecipeIngredientInput,
		revision?: number,
	) => {
		const ingredient = await addRecipeIngredient(recipeId, input, revision);
		await loadRecipe(recipeId);
		return ingredient;
	};

	const replaceIngredients = async (
		recipeId: number,
		ingredients: RecipeIngredientInput[],
		revision?: number,
	) => {
		const nextIngredients = await replaceRecipeIngredients(
			recipeId,
			ingredients,
			revision,
		);
		await loadRecipe(recipeId);
		return nextIngredients;
	};

	return {
		recipes,
		selectedRecipe,
		isLoading,
		refreshRecipes,
		loadRecipe,
		createRecipe,
		updateRecipe,
		deleteRecipe,
		addIngredient,
		replaceIngredients,
		calculateRecipeNutrition,
	};
}
