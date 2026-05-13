// Clio inbound-mail Lambda.
//
// Trigger: S3 `ObjectCreated:*` events on the mail-inbound bucket. SES is
// configured (via a receipt rule) to drop every message addressed to
// `*@<CLIO_MAIL_DOMAIN>` into that bucket as a raw .eml blob.
//
// Job:
//   1. Read the raw MIME from S3.
//   2. Parse it (mailparser handles multipart, attachments, encodings).
//   3. Build a small JSON envelope the Capiro API can consume.
//   4. HMAC-SHA256-sign the envelope with the shared secret pulled from
//      Secrets Manager.
//   5. POST to the webhook URL with the signature in `X-Clio-Mail-Signature`.
//
// We deliberately do NOT touch the database. The API does all that on its
// side via ClioMailService.recordInbound, which keeps the Lambda's trust
// boundary minimal — IAM gives it S3 read + Secrets Manager read on one
// secret + outbound HTTPS to the Capiro ALB. Nothing else.

import { createHmac } from 'node:crypto';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { simpleParser } from 'mailparser';

const REGION = process.env.AWS_REGION || 'us-east-1';
const WEBHOOK_URL = process.env.CLIO_MAIL_WEBHOOK_URL; // e.g. https://app.staging.capiro.ai/webhooks/clio-mail
const SECRET_ARN = process.env.CLIO_MAIL_WEBHOOK_SECRET_ARN;
const MAIL_DOMAIN = process.env.CLIO_MAIL_DOMAIN || 'clio.capiro.ai';

const s3 = new S3Client({ region: REGION });
const sm = new SecretsManagerClient({ region: REGION });

// Cache the secret across warm invocations. Lambda containers are reused
// for ~15 minutes; pulling Secrets Manager once shaves ~200ms off each
// subsequent inbound mail.
let cachedSecret = null;
async function getWebhookSecret() {
  if (cachedSecret) return cachedSecret;
  if (!SECRET_ARN) throw new Error('CLIO_MAIL_WEBHOOK_SECRET_ARN env missing');
  const res = await sm.send(new GetSecretValueCommand({ SecretId: SECRET_ARN }));
  cachedSecret = res.SecretString;
  return cachedSecret;
}

async function readObject(bucket, key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  // Body is a Node.js Readable in v3. Drain to a Buffer.
  const chunks = [];
  for await (const chunk of res.Body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function firstHeader(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  if (typeof value === 'object' && value.text) return value.text;
  return String(value);
}

function pickRecipient(parsed) {
  // SES delivers a copy of the mail PER recipient. The Lambda's S3
  // event carries one object per delivery, so the recipient address is
  // whichever one in the parsed `to:` ends with our mail domain. If
  // the message was sent only with BCC there's no To: header — fall
  // back to the X-Original-To or Return-Path header SES sets, then
  // give up and skip.
  const toList = parsed.to?.value ?? [];
  for (const addr of toList) {
    if (addr.address && addr.address.toLowerCase().endsWith('@' + MAIL_DOMAIN)) {
      return addr.address.toLowerCase();
    }
  }
  const xOrig = firstHeader(parsed.headers?.get?.('x-original-to'));
  if (xOrig && xOrig.toLowerCase().endsWith('@' + MAIL_DOMAIN)) {
    return xOrig.toLowerCase();
  }
  return null;
}

export const handler = async (event) => {
  if (!WEBHOOK_URL) throw new Error('CLIO_MAIL_WEBHOOK_URL env missing');
  const records = event.Records || [];
  const results = [];

  for (const rec of records) {
    if (rec.eventSource && !rec.eventSource.includes('s3')) continue;
    const bucket = rec.s3?.bucket?.name;
    const key = decodeURIComponent((rec.s3?.object?.key || '').replace(/\+/g, ' '));
    if (!bucket || !key) {
      results.push({ key, status: 'skip', reason: 'missing bucket/key' });
      continue;
    }

    try {
      const raw = await readObject(bucket, key);
      const parsed = await simpleParser(raw);
      const toAddress = pickRecipient(parsed);
      if (!toAddress) {
        console.warn(`[clio-mail] no recipient on this domain for s3://${bucket}/${key}`);
        results.push({ key, status: 'skip', reason: 'no matching recipient' });
        continue;
      }

      // SES Message-ID stored on the receipt — fall back to the
      // parsed Message-ID header (which SES copies through).
      const sesMessageId =
        rec.ses?.mail?.messageId ||
        parsed.messageId ||
        `s3-${bucket}-${key}`;

      const envelope = {
        sesMessageId,
        rawS3Key: `s3://${bucket}/${key}`,
        toAddress,
        fromAddress: parsed.from?.value?.[0]?.address?.toLowerCase() ?? '',
        fromName: parsed.from?.value?.[0]?.name || undefined,
        subject: parsed.subject || '',
        bodyText: parsed.text || undefined,
        bodyHtml: parsed.html || undefined,
      };

      const secret = await getWebhookSecret();
      const body = JSON.stringify(envelope);
      const sig = createHmac('sha256', secret).update(body).digest('hex');

      const res = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-clio-mail-signature': sig,
          'user-agent': 'clio-inbound-mail-lambda/0.1',
        },
        body,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        // Surface the non-2xx as a Lambda error so we get retried via
        // S3 → SQS DLQ. We don't want to swallow webhook failures.
        throw new Error(`webhook ${res.status}: ${text.slice(0, 400)}`);
      }
      results.push({ key, status: 'delivered', sesMessageId, to: toAddress });
    } catch (err) {
      console.error(`[clio-mail] failed s3://${bucket}/${key}:`, err);
      results.push({ key, status: 'error', error: String(err) });
      // Re-throw so the Lambda retries via the S3 event source.
      throw err;
    }
  }

  return { ok: true, results };
};
