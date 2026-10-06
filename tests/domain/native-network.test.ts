import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import config from "../../capacitor.config";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("native network security policy", () => {
	it("keeps the actual Android HTTPS origin explicitly allowlisted in deployment examples", () => {
		expect(config.server?.androidScheme).toBe("https");
		for (const path of [".env.example", "docs/dokploy.md"]) {
			const value = read(path).match(/^NUXT_SYNC_ALLOWED_ORIGINS=(.+)$/m)?.[1];
			expect(value?.split(",")).toContain("https://localhost");
			expect(value).not.toContain("*");
		}
	});
	it("limits owner-installed CA trust to the exact household host, without cleartext", () => {
		expect(read("android/app/src/main/AndroidManifest.xml")).toContain('android:networkSecurityConfig="@xml/network_security_config"');
		const policy = read("android/app/src/main/res/xml/network_security_config.xml").replace(/<!--[\s\S]*?-->/g, "");
		const base = policy.match(/<base-config\b[\s\S]*?<\/base-config>/)?.[0];
		expect(base).toContain('cleartextTrafficPermitted="false"');
		expect(base).toContain('<certificates src="system" />');
		expect(base).not.toContain('src="user"');
		const domains = [...policy.matchAll(/<domain-config\b[\s\S]*?<\/domain-config>/g)];
		expect(domains).toHaveLength(1);
		expect(domains[0]![0]).toContain('cleartextTrafficPermitted="false"');
		expect(domains[0]![0]).toContain('<domain includeSubdomains="false">munchling.homelab.lan</domain>');
		expect(domains[0]![0]).toContain('<certificates src="user" />');
		expect((policy.match(/src="user"/g) ?? []).length).toBe(1);
		expect(policy).not.toContain("debug-overrides");
		expect(policy).not.toContain('cleartextTrafficPermitted="true"');
	});
});
