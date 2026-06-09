import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
	appId: "dev.munchling.app",
	appName: "Munchling",
	webDir: ".output/public",
	server: {
		androidScheme: "https",
	},
	plugins: {
		CapacitorSQLite: {
			iosDatabaseLocation: "Library/CapacitorDatabase",
			iosIsEncryption: false,
			iosKeychainPrefix: "munchling",
			iosBiometric: {
				biometricAuth: false,
			},
			androidIsEncryption: false,
			androidBiometric: {
				biometricAuth: false,
			},
		},
	},
};

export default config;
