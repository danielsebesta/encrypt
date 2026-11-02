import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signR2PutUrl } from '../src/server/r2Presign';

test('signR2PutUrl generates valid AWS SigV4 URL with signed headers and query params', async () => {
  const fixedDate = new Date('2026-11-02T12:00:00.000Z');
  const urlString = await signR2PutUrl({
    accountId: 'test-account-id',
    bucketName: 'test-bucket',
    key: 'uploads/file-123.bin',
    accessKeyId: 'AKIAEXAMPLE123',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    expiresInSeconds: 300,
    headers: {
      'content-length': '1048576',
      'content-type': 'application/octet-stream',
    },
    date: fixedDate,
  });

  const url = new URL(urlString);
  assert.equal(url.hostname, 'test-account-id.r2.cloudflarestorage.com');
  assert.equal(url.pathname, '/test-bucket/uploads/file-123.bin');

  assert.equal(url.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256');
  assert.equal(url.searchParams.get('X-Amz-Date'), '20261102T120000Z');
  assert.equal(url.searchParams.get('X-Amz-Expires'), '300');
  assert.equal(
    url.searchParams.get('X-Amz-Credential'),
    'AKIAEXAMPLE123/20261102/auto/s3/aws4_request'
  );
  assert.equal(
    url.searchParams.get('X-Amz-SignedHeaders'),
    'content-length;content-type;host'
  );
  assert.match(url.searchParams.get('X-Amz-Signature') || '', /^[0-9a-f]{64}$/);
});

test('signR2PutUrl supports EU jurisdiction endpoint', async () => {
  const urlString = await signR2PutUrl({
    accountId: 'eu-account',
    bucketName: 'eu-bucket',
    jurisdiction: 'eu',
    key: 'item.enc',
    accessKeyId: 'AKIAEU',
    secretAccessKey: 'SECRETEU',
  });

  const url = new URL(urlString);
  assert.equal(url.hostname, 'eu-account.eu.r2.cloudflarestorage.com');
  assert.equal(url.pathname, '/eu-bucket/item.enc');
});
