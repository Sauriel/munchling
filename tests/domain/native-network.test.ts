import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import config from '../../capacitor.config';
import { networkSecurityXml } from '../../scripts/android-network-config.mjs';
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('native network security policy', () => {
  it('keeps the actual Android HTTPS origin explicitly allowlisted in deployment examples', () => {
    expect(config.server?.androidScheme).toBe('https');
    for (const path of ['.env.example','docs/dokploy.md']) {
      const value = read(path).match(/^NUXT_SYNC_ALLOWED_ORIGINS=(.+)$/m)?.[1];
      expect(value?.split(',')).toContain('https://localhost'); expect(value).not.toContain('*');
    }
  });
  it('defaults to system CAs and generates only explicitly configured exact-host trust', () => {
    expect(read('android/app/src/main/AndroidManifest.xml')).toContain('android:networkSecurityConfig="@xml/${munchlingNetworkSecurity}"');
    expect(read('android/app/build.gradle')).toContain('generateMunchlingNetworkSecurity');
    const base = networkSecurityXml();
    expect(base).toContain('cleartextTrafficPermitted="false"');
    expect(base).not.toContain('src="user"'); expect(base).not.toContain('<domain');
    const configured = networkSecurityXml('Sync.Example.Internal');
    expect(configured).toContain('<domain includeSubdomains="false">sync.example.internal</domain>');
    expect((configured.match(/src="user"/g) ?? []).length).toBe(1);
    expect(configured.match(/<base-config[\s\S]*?<\/base-config>/)?.[0]).not.toContain('src="user"');
    expect(configured).not.toContain('cleartextTrafficPermitted="true"');
    expect(configured).not.toContain('debug-overrides');
    for (const host of ['*.example.internal','https://example.internal','example.internal/path','example.internal"><evil','127.0.0.1','-bad.example','bad..example','example.internal\n']) expect(() => networkSecurityXml(host)).toThrow();
  });
});
