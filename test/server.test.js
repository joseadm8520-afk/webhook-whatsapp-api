'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { afterEach, test } = require('node:test');
const { createServer } = require('../server');

const servers = new Set();

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise((resolve) => server.close(resolve))));
  servers.clear();
});

async function startServer(config) {
  const server = createServer(config);
  servers.add(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test('health endpoint reports that the service is running', async () => {
  const baseUrl = await startServer({});
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('webhook verification returns the challenge for the configured token', async () => {
  const baseUrl = await startServer({ verifyToken: 'test-token' });
  const query = new URLSearchParams({
    'hub.mode': 'subscribe',
    'hub.verify_token': 'test-token',
    'hub.challenge': '123456'
  });
  const response = await fetch(`${baseUrl}/webhook?${query}`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '123456');
});

test('webhook verification rejects an incorrect token', async () => {
  const baseUrl = await startServer({ verifyToken: 'test-token' });
  const query = new URLSearchParams({
    'hub.mode': 'subscribe',
    'hub.verify_token': 'wrong-token',
    'hub.challenge': '123456'
  });
  const response = await fetch(`${baseUrl}/webhook?${query}`);
  assert.equal(response.status, 403);
});

test('webhook accepts a correctly signed WhatsApp event', async () => {
  const appSecret = 'test-app-secret';
  const baseUrl = await startServer({ appSecret });
  const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
  const signature = `sha256=${crypto.createHmac('sha256', appSecret).update(payload).digest('hex')}`;
  const response = await fetch(`${baseUrl}/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
    body: payload
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'received' });
});

test('webhook rejects an invalid signature', async () => {
  const baseUrl = await startServer({ appSecret: 'test-app-secret' });
  const response = await fetch(`${baseUrl}/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=invalid' },
    body: JSON.stringify({ object: 'whatsapp_business_account', entry: [] })
  });
  assert.equal(response.status, 401);
});

test('webhook refuses to accept events when the app secret is not configured', async () => {
  const baseUrl = await startServer({});
  const response = await fetch(`${baseUrl}/webhook`, {
    method: 'POST',
    body: JSON.stringify({ object: 'whatsapp_business_account', entry: [] })
  });
  assert.equal(response.status, 503);
});
