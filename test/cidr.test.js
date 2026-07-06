import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandCidr, ipToInt, intToIp } from '../src/scanner/cidr.js';

test('expandCidr /30 yields 2 usable hosts', () => {
  const hosts = expandCidr('192.168.1.0/30');
  assert.deepEqual(hosts, ['192.168.1.1', '192.168.1.2']);
});

test('expandCidr /24 excludes network and broadcast', () => {
  const hosts = expandCidr('10.0.0.0/24');
  assert.equal(hosts.length, 254);
  assert.equal(hosts[0], '10.0.0.1');
  assert.equal(hosts[hosts.length - 1], '10.0.0.254');
});

test('expandCidr /31 point-to-point yields both addresses', () => {
  const hosts = expandCidr('10.0.0.0/31');
  assert.deepEqual(hosts, ['10.0.0.0', '10.0.0.1']);
});

test('expandCidr caps very large ranges', () => {
  const hosts = expandCidr('10.0.0.0/8', 100);
  assert.equal(hosts.length, 100);
});

test('ip <-> int round trip', () => {
  assert.equal(intToIp(ipToInt('192.168.1.42')), '192.168.1.42');
});

test('invalid CIDR throws', () => {
  assert.throws(() => expandCidr('nonsense'));
});
