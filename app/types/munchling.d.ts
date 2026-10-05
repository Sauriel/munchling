import type { MunchlingDataService } from "../../shared/domain/data-service";

declare module "#app" {
	interface NuxtApp {
		$munchlingData: MunchlingDataService;
	}
}

declare module "vue" {
	interface ComponentCustomProperties {
		$munchlingData: MunchlingDataService;
	}
}

export {};
