import type { MunchlingDataService } from "../../shared/domain/data-service";

export function useMunchlingData(): MunchlingDataService {
	return useNuxtApp().$munchlingData;
}
