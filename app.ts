import crypto from 'node:crypto';
import bodyParser from 'body-parser';
import express, { Request, Response } from 'express';

import { config } from './src/shared/utils';
import { Conversation } from './src/modules/whatsapp';

const { urlencoded, json } = bodyParser;
const app = express();

// Parse application/x-www-form-urlencoded
app.use(urlencoded({ extended: true }));

// Parse application/json and verify the callback came from Facebook
app.use(json({ verify: verifyRequestSignature }));

// ─── Webhook verification handshake ──────────────────────────────────────────

app.get('/webhook', (req: Request, res: Response) => {
  console.log('Received webhook verification request');
  console.log(req.query);

  if (
    req.query['hub.mode']         !== 'subscribe' ||
    req.query['hub.verify_token'] !== config.verifyToken
  ) {
    res.sendStatus(403);
    return;
  }

  res.send(req.query['hub.challenge']);
});

// ─── Incoming messages ───────────────────────────────────────────────────────

app.post('/webhook', (req: Request, res: Response) => {
  console.log(req.body);

  if (req.body.object === 'whatsapp_business_account') {
    for (const entry of req.body.entry) {
      for (const change of entry.changes) {
        const value = change.value;
        if (!value) continue;

        const senderPhoneNumberId: string = value.metadata.phone_number_id;

        if (value.statuses) {
          for (const status of value.statuses) {
            void Conversation.handleStatus(senderPhoneNumberId, status);
          }
        }

        if (value.messages) {
          for (const rawMessage of value.messages) {
            void Conversation.handleMessage(senderPhoneNumberId, rawMessage);
          }
        }
      }
    }
  }

  res.status(200).send('EVENT_RECEIVED');
});

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/', (_req: Request, res: Response) => {
  res.json({
    message: "Jasper's Market Server is running",
    endpoints: ['POST /webhook - WhatsApp webhook endpoint'],
  });
});

// ─── Boot ────────────────────────────────────────────────────────────────────

config.checkEnvVariables();

function verifyRequestSignature(
  req: Request,
  _res: Response,
  buf: Buffer,
): void {
  const signature = req.headers['x-hub-signature-256'] as string | undefined;

  if (!signature) {
    console.warn('Couldn\'t find "x-hub-signature-256" in headers.');
    return;
  }

  const [, signatureHash] = signature.split('=');
  const expectedHash = crypto
    .createHmac('sha256', config.appSecret ?? '')
    .update(buf)
    .digest('hex');

  if (signatureHash !== expectedHash) {
    throw new Error("Couldn't validate the request signature.");
  }
}

const listener = app.listen(config.port, () => {
  const addr = listener.address();
  const port = typeof addr === 'object' && addr ? addr.port : config.port;
  console.log(`The app is listening on port ${port}`);
});