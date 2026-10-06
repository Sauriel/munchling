import { defineNuxtConfig } from "nuxt/config";

const serverBuild = process.env.MUNCHLING_BUILD_MODE === "server";

export default defineNuxtConfig({
	compatibilityDate: "2026-06-09",
	devtools: { enabled: true },
	ssr: false,
	modules: ["@nuxtjs/tailwindcss", "@nuxt/icon", "@nuxtjs/i18n"],
	css: ["~/assets/css/main.css"],
	app: {
		head: {
			title: "Munchling",
			link: [
				{ rel: "icon", type: "image/png", href: "/munchling_768.png" },
				{ rel: "apple-touch-icon", href: "/munchling_768.png" },
			],
			meta: [
				{
					name: "viewport",
					content: "width=device-width, initial-scale=1, viewport-fit=cover",
				},
				{ name: "theme-color", content: "#16a34a" },
			],
		},
	},
	i18n: {
		strategy: "no_prefix",
		defaultLocale: "en",
		detectBrowserLanguage: {
			useCookie: false,
			fallbackLocale: "en",
		},
		locales: [
			{ code: "de", name: "Deutsch", file: "de.json" },
			{ code: "en", name: "English", file: "en.json" },
		],
		langDir: "locales",
	},
	runtimeConfig: {
		serverEnabled: serverBuild,
		sync: { publicOrigin: "", allowedOrigins: "" },
		mariaDb: { host: "", port: 3306, user: "", password: "", database: "munchling", connectionLimit: 5 },
	},
	nitro: {
		preset: serverBuild ? "node-server" : "static",
		ignore: serverBuild ? [] : ["**/server/**"],
	},
	typescript: {
		typeCheck: true,
	},
});
