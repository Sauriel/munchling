export default {
	content: [
		"./app/components/**/*.{vue,js,ts}",
		"./app/layouts/**/*.vue",
		"./app/pages/**/*.vue",
		"./app/app.vue",
		"./error.vue",
	],
	darkMode: "media",
	theme: {
		extend: {
			colors: {
				munchling: {
					50: "#f0fdf4",
					500: "#22c55e",
					600: "#16a34a",
					700: "#15803d",
				},
			},
		},
	},
};
