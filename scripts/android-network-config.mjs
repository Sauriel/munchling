import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Only an exact DNS hostname, never a URL, wildcard or XML fragment. */
export function networkSecurityXml(host = '') {
  const labels = host.split('.');
  if (host && (host.length > 253 || /[^a-zA-Z0-9.-]/.test(host) || labels.length < 2 || /^\d+(?:\.\d+){3}$/.test(host) || labels.some(label => !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label)))) {
    throw new Error('MUNCHLING_ANDROID_USER_CA_HOST must be an exact DNS hostname');
  }
  return `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors><certificates src="system" /></trust-anchors>
    </base-config>${host ? `
    <domain-config cleartextTrafficPermitted="false">
        <domain includeSubdomains="false">${host.toLowerCase()}</domain>
        <trust-anchors>
            <certificates src="system" />
            <certificates src="user" />
        </trust-anchors>
    </domain-config>` : ''}
</network-security-config>
`;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , output, host = ''] = process.argv;
  if (!output) throw new Error('Expected output path');
  const xml = networkSecurityXml(host);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, xml);
}
