import type {
	CreateProfileInput,
	Profile,
	UpdateProfileInput,
} from "../../shared/domain/types";
import { useMunchlingData } from "./useMunchlingData";
import { sortProfiles } from '../../shared/domain/profile-order';

export function useProfiles() {
	const { listProfiles, createProfile: createProfileRecord, updateProfile: updateProfileRecord, deleteProfile: deleteProfileRecord } = useMunchlingData().profiles;
	const records = useState<Profile[]>("profiles", () => []);
	const profiles = computed(() => sortProfiles(records.value));
	const isLoading = useState("profiles-loading", () => false);

	const refreshProfiles = async () => {
		isLoading.value = true;
		try {
			records.value = await listProfiles();
		} finally {
			isLoading.value = false;
		}
	};

	const createProfile = async (input: CreateProfileInput) => {
		const profile = await createProfileRecord(input);
		await refreshProfiles();
		return profile;
	};

	const updateProfile = async (id: number, input: UpdateProfileInput, revision?: number) => {
		const profile = await updateProfileRecord(id, input, revision);
		await refreshProfiles();
		return profile;
	};

	const deleteProfile = async (id: number, revision?: number) => {
		const deleted = await deleteProfileRecord(id, revision);
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
