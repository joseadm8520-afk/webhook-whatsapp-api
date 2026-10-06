'use strict';

const crypto = require('node:crypto');
const http = require('node:http');

const MAX_BODY_BYTES = 1024 * 1024;

function loadConfig() {
  return {
    port: Number(process.env.PORT || 3000),
    verifyToken: process.env.VERIFY_TOKEN || '',
    appSecret: process.env.APP_SECRET || '',
    makeWebhookUrl: process.env.MAKE_WEBHOOK_URL || ''
  };
}

function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function hasValidSignature(rawBody, signatureHeader, appSecret) {
  if (!signatureHeader || !appSecret) return false;
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  return safeEqual(signatureHeader, expected);
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    request.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        const error = new Error('Request body is too large');
        error.statusCode = 413;
        reject(error);
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (!tooLarge) resolve(Buffer.concat(chunks));
    });
    request.on('error', reject);
  });
}

async function forwardMessage(message, makeWebhookUrl) {
  if (!makeWebhookUrl) {
    throw new Error('MAKE_WEBHOOK_URL is not configured');
  }

  const response = await fetch(makeWebhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      from: message.from,
      messageId: message.id || '',
      type: message.type || '',
      text: message.text?.body || ''
    }),
    signal: AbortSignal.timeout(10_000)
  });

  if (!response.ok) {
    throw new Error(`Make webhook returned HTTP ${response.status}`);
  }
}

function createServer(config = loadConfig()) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://localhost');

    if (request.method === 'GET' && url.pathname === '/health') {
      return sendJson(response, 200, { status: 'ok' });
    }

    if (request.method === 'GET' && url.pathname === '/webhook') {
      if (!config.verifyToken) {
        return sendJson(response, 503, { error: 'VERIFY_TOKEN is not configured' });
      }

      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');
      if (mode === 'subscribe' && safeEqual(token, config.verifyToken) && challenge) {
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        return response.end(challenge);
      }
      return sendJson(response, 403, { error: 'Webhook verification failed' });
    }

    if (request.method === 'POST' && url.pathname === '/webhook') {
      if (!config.appSecret) {
        return sendJson(response, 503, { error: 'APP_SECRET is not configured' });
      }

      try {
        const rawBody = await readBody(request);
        if (!hasValidSignature(rawBody, request.headers['x-hub-signature-256'], config.appSecret)) {
          return sendJson(response, 401, { error: 'Invalid webhook signature' });
        }

        const event = JSON.parse(rawBody.toString('utf8'));
        if (event.object !== 'whatsapp_business_account' || !Array.isArray(event.entry)) {
          return sendJson(response, 400, { error: 'Invalid WhatsApp webhook payload' });
        }

        const messages = event.entry.flatMap((entry) => (
          Array.isArray(entry.changes)
            ? entry.changes.flatMap((change) => (
              Array.isArray(change.value?.messages) ? change.value.messages : []
            ))
            : []
        ));

        for (const message of messages) {
          if (typeof message.from !== 'string' || message.from.length === 0) {
            console.warn('WhatsApp message without sender was not forwarded');
            continue;
          }

          try {
            await forwardMessage(message, config.makeWebhookUrl);
          } catch (error) {
            console.error(`Could not forward WhatsApp message to Make: ${error.message}`);
            return sendJson(response, 502, { error: 'Could not forward WhatsApp message' });
          }
        }

        console.log(`WhatsApp webhook received (${messages.length} messages)`);
        return sendJson(response, 200, { status: 'received' });
      } catch (error) {
        const statusCode = error.statusCode || 400;
        return sendJson(response, statusCode, {
          error: statusCode === 413 ? error.message : 'Invalid webhook payload'
        });
      }
    }

    return sendJson(response, 404, { error: 'Not found' });
  });
}

if (require.main === module) {
  const config = loadConfig();
  const server = createServer(config);
  server.listen(config.port, () => {
    console.log(`WhatsApp webhook listening on port ${config.port}`);
    if (!config.appSecret) console.warn('APP_SECRET is unset; POST /webhook will be unavailable.');
  });
}

module.exports = { createServer, hasValidSignature };
