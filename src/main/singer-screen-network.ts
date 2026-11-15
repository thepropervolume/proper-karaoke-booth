import { execFile } from 'node:child_process';
import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';

/** Address scope limits the portable default; Windows also requires a Private NIC profile. */
export function isPrivateSingerScreenIPv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31 ||
    a === 169 && b === 254 || a === 100 && b >= 64 && b <= 127;
}

// Fixed read-only command. Never interpolate settings, interface names or other user input.
const WINDOWS_PRIVATE_ADDRESSES = "$ErrorActionPreference='Stop'; $indexes=@(Get-NetConnectionProfile -ErrorAction Stop | Where-Object { $_.NetworkCategory -eq 'Private' } | Select-Object -ExpandProperty InterfaceIndex); @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.InterfaceIndex -in $indexes -and $_.AddressState -eq 'Preferred' } | Select-Object -ExpandProperty IPAddress) | ConvertTo-Json -Compress";
function windowsPrivateAddresses(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_PRIVATE_ADDRESSES],
      { windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024, encoding: 'utf8' }, (error, stdout) => {
        if (error) { reject(error); return; }
        try {
          const result: unknown = stdout.trim() ? JSON.parse(stdout.replace(/^\uFEFF/, '')) : [];
          const values = Array.isArray(result) ? result : [result];
          if (!values.every(value => typeof value === 'string')) throw new Error('Invalid network profile response.');
          resolve(values as string[]);
        } catch { reject(new Error('Private network profiles could not be read.')); }
      });
  });
}

export type SingerScreenNetworkDiscoveryOptions = {
  platform?: string;
  interfaces?: typeof networkInterfaces;
  readWindowsAddresses?: () => Promise<string[]>;
};

/** A failed profile check fails closed to loopback (which the listener adds itself). */
export async function discoverSingerScreenAddresses(options: SingerScreenNetworkDiscoveryOptions = {}): Promise<string[]> {
  const candidates = [...new Set(Object.values((options.interfaces ?? networkInterfaces)()).flat()
    .filter(item => item && !item.internal && item.family === 'IPv4' && isPrivateSingerScreenIPv4(item.address))
    .map(item => item!.address))].sort();
  if ((options.platform ?? process.platform) !== 'win32' || candidates.length === 0) return candidates;
  try {
    const approved = new Set(await (options.readWindowsAddresses ?? windowsPrivateAddresses)());
    return candidates.filter(address => approved.has(address));
  } catch { return []; }
}
