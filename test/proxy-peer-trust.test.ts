/**
 * Client identity behind a reverse proxy.
 *
 * The deployment runs Caddy in front of an origin bound to loopback, so every
 * connection arrives from 127.0.0.1 and the per-address budget cannot tell
 * visitors apart unless the forwarding header is believed. Believing it
 * unconditionally would let any caller claim an address of their choosing and
 * spend someone else's budget.
 *
 * Both halves are therefore required and both are pinned here: the header, and
 * the socket peer allowed to speak for a client.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addressMatches, clientIp, parseTrustedPeers } from '../src/web/analysis/ratelimit.ts';

/** A request as Node would hand it to the limiter. */
function request(remoteAddress: string | undefined, headers: Record<string, string> = {}) {
  return { socket: { remoteAddress }, headers } as never;
}

const CADDY = '127.0.0.1';

test('a spoofed forwarding header from an untrusted peer is ignored', () => {
  // The attack: connect directly to the origin and claim to be someone else.
  // The origin is loopback-bound, but a compromised local process, a future
  // binding change, or an SSRF that reaches loopback must not become a way to
  // forge identity. The peer here is not the declared proxy, so the header is
  // discarded and the socket address is used.
  const address = clientIp(request('203.0.113.7', { 'x-forwarded-for': '198.51.100.4' }), 'x-forwarded-for', [
    '127.0.0.1/32',
  ]);
  assert.equal(address, '203.0.113.7', 'the socket address is used, not the claimed one');
  assert.notEqual(address, '198.51.100.4');
});

test('forwarding from the declared local Caddy peer is accepted', () => {
  // The real topology: Caddy connects from loopback and overwrites the header
  // with the address it observed, so the visitor is identified correctly.
  const address = clientIp(request(CADDY, { 'x-forwarded-for': '198.51.100.4' }), 'x-forwarded-for', [
    '127.0.0.1/32',
  ]);
  assert.equal(address, '198.51.100.4', 'the client address Caddy observed is used');
});

test('only the first hop is taken from the header', () => {
  // Caddy appends to an existing chain; the leftmost entry is the client as the
  // trusted proxy saw it. Everything after it is unverified and ignored.
  const address = clientIp(request(CADDY, { 'x-forwarded-for': '198.51.100.4, 10.0.0.9, 10.0.0.10' }), 'x-forwarded-for', [
    '127.0.0.1/32',
  ]);
  assert.equal(address, '198.51.100.4');
});

test('declaring the header without declaring peers leaves it inert', () => {
  // Fails safe: per-client accuracy is lost, security is not.
  const address = clientIp(request(CADDY, { 'x-forwarded-for': '198.51.100.4' }), 'x-forwarded-for', []);
  assert.equal(address, CADDY, 'the socket address is used because no peer was declared');
});

test('a peer outside the declared range is refused even if it looks similar', () => {
  for (const peer of ['127.0.0.2', '128.0.0.1', '10.0.0.1']) {
    const address = clientIp(request(peer, { 'x-forwarded-for': '198.51.100.4' }), 'x-forwarded-for', [
      '127.0.0.1/32',
    ]);
    assert.equal(address, peer, `${peer} is not the declared proxy`);
  }
});

test('a wider declared range admits only what is inside it', () => {
  const inRange = clientIp(request('172.17.0.9', { 'x-forwarded-for': '198.51.100.4' }), 'x-forwarded-for', [
    '172.17.0.0/16',
  ]);
  assert.equal(inRange, '198.51.100.4');

  const outOfRange = clientIp(request('172.18.0.9', { 'x-forwarded-for': '198.51.100.4' }), 'x-forwarded-for', [
    '172.17.0.0/16',
  ]);
  assert.equal(outOfRange, '172.18.0.9');
});

test('the IPv4-mapped IPv6 form Node reports for loopback is recognised', () => {
  // Node frequently reports 127.0.0.1 as ::ffff:127.0.0.1. Declaring the proxy
  // as 127.0.0.1/32 must still match, or the header would silently stop being
  // honoured and every visitor would share one budget.
  const address = clientIp(request('::ffff:127.0.0.1', { 'x-forwarded-for': '198.51.100.4' }), 'x-forwarded-for', [
    '127.0.0.1/32',
  ]);
  assert.equal(address, '198.51.100.4', 'the mapped form is recognised as loopback');
});

test('no declared header means the socket address, always', () => {
  const address = clientIp(request(CADDY, { 'x-forwarded-for': '198.51.100.4' }), null, ['127.0.0.1/32']);
  assert.equal(address, CADDY);
});

test('a blank or absent header from the trusted peer falls back to the socket', () => {
  for (const headers of [{}, { 'x-forwarded-for': '   ' }] as Record<string, string>[]) {
    const address = clientIp(request(CADDY, headers), 'x-forwarded-for', ['127.0.0.1/32']);
    assert.equal(address, CADDY);
  }
});

test('an unknown socket address never trusts a header', () => {
  const address = clientIp(request(undefined, { 'x-forwarded-for': '198.51.100.4' }), 'x-forwarded-for', [
    '127.0.0.1/32',
  ]);
  assert.equal(address, 'unknown');
});

test('addressMatches handles prefixes, hosts and nonsense', () => {
  assert.equal(addressMatches('127.0.0.1', '127.0.0.1/32'), true);
  assert.equal(addressMatches('127.0.0.2', '127.0.0.1/32'), false);
  assert.equal(addressMatches('10.1.2.3', '10.0.0.0/8'), true);
  assert.equal(addressMatches('11.1.2.3', '10.0.0.0/8'), false);
  assert.equal(addressMatches('192.168.1.130', '192.168.1.128/25'), true);
  assert.equal(addressMatches('192.168.1.127', '192.168.1.128/25'), false);
  assert.equal(addressMatches('::1', '::1/128'), true);
  // Nonsense must not match, or a typo would silently widen trust.
  assert.equal(addressMatches('127.0.0.1', 'not-an-address'), false);
  assert.equal(addressMatches('127.0.0.1', '127.0.0.1/999'), false);
  assert.equal(addressMatches('not-an-address', '127.0.0.1/32'), false);
  assert.equal(addressMatches('127.0.0.1', '127.0.0.1'), true, 'a bare address means /32');
});

test('parseTrustedPeers normalises and drops empty entries', () => {
  assert.deepEqual(parseTrustedPeers(' 127.0.0.1/32 , 172.17.0.0/16 ,, '), ['127.0.0.1/32', '172.17.0.0/16']);
  assert.deepEqual(parseTrustedPeers(''), []);
  assert.deepEqual(parseTrustedPeers(undefined), []);
  assert.deepEqual(parseTrustedPeers('127.0.0.1/32'), ['127.0.0.1/32']);
});