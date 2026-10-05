import type { MunchlingDataService } from "../../../shared/domain/data-service";
import type { SqlDatabase } from "../database/executor";
import { createProfilesRepository } from "../database/repositories/profiles";
import { createFoodsRepository } from "../database/repositories/foods";
import { createRecipesRepository } from "../database/repositories/recipes";
import { createMealLogsRepository } from "../database/repositories/mealLogs";

export function createLocalDataService(database: SqlDatabase): MunchlingDataService {
	return {
		profiles: createProfilesRepository(database),
		foods: createFoodsRepository(database),
		recipes: createRecipesRepository(database),
		mealLogs: createMealLogsRepository(database),
	};
}
