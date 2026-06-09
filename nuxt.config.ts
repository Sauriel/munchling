import { defineNuxtConfig } from "nuxt/config";

export default defineNuxtConfig({
	compatibilityDate: "2026-06-09",
	devtools: { enabled: true },
	ssr: false,
	modules: ["@nuxtjs/tailwindcss", "@nuxt/icon", "@nuxtjs/i18n"],
	css: ["~/assets/css/main.css"],
	app: {
		head: {
			title: "Munchling",
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
		defaultLocale: "de",
		detectBrowserLanguage: {
			useCookie: true,
			cookieKey: "munchling_locale",
			fallbackLocale: "de",
		},
		locales: [
			{ code: "de", name: "Deutsch", file: "de.json" },
			{ code: "en", name: "English", file: "en.json" },
		],
		langDir: "locales",
	},
	nitro: {
		preset: "static",
	},
	typescript: {
		typeCheck: true,
	},
});
