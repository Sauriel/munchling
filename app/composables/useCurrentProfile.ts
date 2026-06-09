import type { Profile } from "~/utils/database/repositories";
import { useProfiles } from "./useProfiles";

const STORAGE_KEY = "munchling_current_profile_id";

export function useCurrentProfile() {
	const currentProfileId = useState<number | null>(
		"current-profile-id",
		() => null,
	);
	const { profiles, refreshProfiles } = useProfiles();

	const currentProfile = computed<Profile | null>(() => {
		return (
			profiles.value.find((profile) => profile.id === currentProfileId.value) ??
			profiles.value[0] ??
			null
		);
	});

	const selectProfile = (profileId: number | null) => {
		currentProfileId.value = profileId;

		if (import.meta.client) {
			if (profileId === null) {
				localStorage.removeItem(STORAGE_KEY);
			} else {
				localStorage.setItem(STORAGE_KEY, String(profileId));
			}
		}
	};

	const initializeCurrentProfile = async () => {
		if (profiles.value.length === 0) {
			await refreshProfiles();
		}

		const storedId = import.meta.client
			? Number(localStorage.getItem(STORAGE_KEY))
			: NaN;
		const validStoredProfile = profiles.value.find(
			(profile) => profile.id === storedId,
		);

		if (validStoredProfile) {
			currentProfileId.value = validStoredProfile.id;
			return currentProfile.value;
		}

		if (!currentProfileId.value && profiles.value[0]) {
			selectProfile(profiles.value[0].id);
		}

		return currentProfile.value;
	};

	watch(profiles, (nextProfiles) => {
		if (nextProfiles.length === 0) {
			selectProfile(null);
			return;
		}

		if (
			!nextProfiles.some((profile) => profile.id === currentProfileId.value)
		) {
			const firstProfile = nextProfiles[0];

			if (firstProfile) {
				selectProfile(firstProfile.id);
			}
		}
	});

	return {
		currentProfileId,
		currentProfile,
		selectProfile,
		initializeCurrentProfile,
	};
}
