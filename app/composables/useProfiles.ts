import type {
	CreateProfileInput,
	Profile,
	UpdateProfileInput,
} from "~/utils/database/repositories";
import {
	createProfile as createProfileRecord,
	deleteProfile as deleteProfileRecord,
	listProfiles,
	updateProfile as updateProfileRecord,
} from "~/utils/database/repositories";

export function useProfiles() {
	const profiles = useState<Profile[]>("profiles", () => []);
	const isLoading = useState("profiles-loading", () => false);

	const refreshProfiles = async () => {
		isLoading.value = true;
		try {
			profiles.value = await listProfiles();
		} finally {
			isLoading.value = false;
		}
	};

	const createProfile = async (input: CreateProfileInput) => {
		const profile = await createProfileRecord(input);
		await refreshProfiles();
		return profile;
	};

	const updateProfile = async (id: number, input: UpdateProfileInput) => {
		const profile = await updateProfileRecord(id, input);
		await refreshProfiles();
		return profile;
	};

	const deleteProfile = async (id: number) => {
		const deleted = await deleteProfileRecord(id);
		await refreshProfiles();
		return deleted;
	};

	return {
		profiles,
		isLoading,
		refreshProfiles,
		createProfile,
		updateProfile,
		deleteProfile,
	};
}
