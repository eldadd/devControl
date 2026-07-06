// Minimal IPv4 CIDR helpers (no dependencies).

function ipToInt(ip) {
  const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    throw new Error(`invalid IPv4 address: ${ip}`);
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function intToIp(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

// Expand "192.168.1.0/24" to its usable host addresses (excludes network and
// broadcast for prefixes shorter than /31). Caps very large ranges for safety.
export function expandCidr(cidr, maxHosts = 4096) {
  const [base, prefixStr] = cidr.split('/');
  const prefix = Number.parseInt(prefixStr, 10);
  if (!Number.isFinite(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`invalid CIDR prefix: ${cidr}`);
  }
  const baseInt = ipToInt(base);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (baseInt & mask) >>> 0;
  const size = prefix >= 31 ? 2 ** (32 - prefix) : 2 ** (32 - prefix) - 2;
  const firstOffset = prefix >= 31 ? 0 : 1;

  const hosts = [];
  const count = Math.min(size, maxHosts);
  for (let i = 0; i < count; i++) {
    hosts.push(intToIp((network + firstOffset + i) >>> 0));
  }
  return hosts;
}

export { ipToInt, intToIp };
