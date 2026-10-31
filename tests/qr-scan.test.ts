import { test } from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import { classifyQrText, decodePixels, isReceivePath, receivePayload } from '../src/lib/qrScan';

const here = { origin: 'https://encrypt.click', pathname: '/cs/u' };

function render(text: string, scale = 4, quiet = 4) {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'H' });
  const side = (modules.size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let row = 0; row < modules.size; row++) {
    for (let col = 0; col < modules.size; col++) {
      if (!modules.get(row, col)) continue;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const offset = (((row + quiet) * scale + y) * side + (col + quiet) * scale + x) * 4;
          data[offset] = data[offset + 1] = data[offset + 2] = 0;
        }
      }
    }
  }
  return { width: side, height: side, data };
}

test('receive paths cover every locale prefix and nothing else', () => {
  for (const path of ['/u', '/u/', '/cs/u', '/pl/u/']) assert.ok(isReceivePath(path), path);
  for (const path of ['/', '/share', '/xx/u', '/u/x', '/cs/u/extra', '/uu']) assert.ok(!isReceivePath(path), path);
});

test('the payload comes from the fragment or, re-encoded, from the p parameter', () => {
  assert.equal(receivePayload(new URL('https://encrypt.click/u/#abc-_')), 'abc-_');
  assert.equal(receivePayload(new URL('https://encrypt.click/u/?p=a%2Bb')), 'a%2Bb');
  assert.equal(receivePayload(new URL('https://encrypt.click/u/#')), '');
  assert.equal(receivePayload(new URL('https://encrypt.click/u/')), '');
});

test('a share link for this site opens on the current receive page with the payload kept in the fragment', () => {
  assert.deepEqual(classifyQrText('https://encrypt.click/u/#PAYLOAD', here), { kind: 'receive', href: '/cs/u#PAYLOAD' });
  assert.deepEqual(classifyQrText('  https://encrypt.click/de/u#PAYLOAD\n', here), { kind: 'receive', href: '/cs/u#PAYLOAD' });
  assert.deepEqual(classifyQrText('https://encrypt.click/u/?p=PAY%2FLOAD', here), { kind: 'receive', href: '/cs/u#PAY%2FLOAD' });
});

test('other addresses are only offered, with a receive payload moved out of the query', () => {
  assert.deepEqual(classifyQrText('https://self.example/u/?p=PAYLOAD', here), { kind: 'link', url: 'https://self.example/u/#PAYLOAD' });
  assert.deepEqual(classifyQrText('https://self.example/u/#PAYLOAD', here), { kind: 'link', url: 'https://self.example/u/#PAYLOAD' });
  assert.deepEqual(classifyQrText('https://l.example/abc', here), { kind: 'link', url: 'https://l.example/abc' });
  assert.deepEqual(classifyQrText('https://encrypt.click/share', here), { kind: 'link', url: 'https://encrypt.click/share' });
  assert.deepEqual(classifyQrText('https://encrypt.click/u/', here), { kind: 'link', url: 'https://encrypt.click/u/' });
});

test('anything that is not a web address is plain text', () => {
  for (const text of ['hello', 'javascript:alert(1)', 'data:text/html,<b>x</b>', 'mailto:a@b.c', 'WIFI:S:net;;', '']) {
    assert.deepEqual(classifyQrText(text, here), { kind: 'text' }, text);
  }
});

test('the fallback decoder reads a share link QR code back from pixels', async () => {
  const link = `https://encrypt.click/u/#${'A1b2-_'.repeat(40)}`;
  const text = await decodePixels(render(link));
  assert.equal(text, link);
  assert.deepEqual(classifyQrText(text!, here), { kind: 'receive', href: `/cs/u#${'A1b2-_'.repeat(40)}` });
  assert.equal(await decodePixels({ width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4).fill(255) }), null);
});
