import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TransferMeter,
  formatBytes,
  formatEta,
  formatSpeed,
  formatTransferLine,
  mapPool,
  transferRatio,
} from '../src/lib/transferProgress';

test('formatBytes uses decimal units', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(999), '999 B');
  assert.equal(formatBytes(1000), '1 KB');
  assert.equal(formatBytes(1_500_000), '1.5 MB');
});

test('formatSpeed and formatEta handle empty and large values', () => {
  assert.equal(formatSpeed(0), '—');
  assert.equal(formatSpeed(2_500_000), '2.5 MB/s');
  assert.equal(formatEta(Infinity), '—');
  assert.equal(formatEta(45), '45s');
  assert.equal(formatEta(125), '2m 5s');
});

test('transferRatio clamps to the unit interval', () => {
  assert.equal(transferRatio(null), null);
  assert.equal(transferRatio({ loaded: 50, total: 100, speed: 0, online: true }), 0.5);
  assert.equal(transferRatio({ loaded: 120, total: 100, speed: 0, online: true }), 1);
});

test('TransferMeter reports online and a non-negative speed', () => {
  const meter = new TransferMeter();
  const first = meter.report(0, 1000);
  assert.equal(first.loaded, 0);
  assert.equal(first.total, 1000);
  assert.equal(typeof first.online, 'boolean');
  const second = meter.report(500, 1000);
  assert.equal(second.loaded, 500);
  assert.ok(second.speed >= 0);
  meter.dispose();
});

test('formatTransferLine fills locale templates', () => {
  const dict = {
    'common.transfer.stats': '{loaded} / {total} · {speed} · {eta} left · {online}',
    'common.transfer.indeterminate': '{loaded} · {speed} · {online}',
    'common.transfer.online': 'Online',
    'common.transfer.offline': 'Offline',
  };
  const t = (d: Record<string, string>, key: string) => d[key] ?? key;
  const line = formatTransferLine(dict, t, { loaded: 1000, total: 2000, speed: 1000, online: true });
  assert.match(line, /1 KB \/ 2 KB/);
  assert.match(line, /Online/);
});

test('mapPool runs workers with bounded concurrency and preserves order', async () => {
  let live = 0;
  let peak = 0;
  const seen: number[] = [];
  const out = await mapPool(8, 3, async (i) => {
    live++;
    peak = Math.max(peak, live);
    seen.push(i);
    await new Promise((r) => setTimeout(r, 5));
    live--;
    return i * 10;
  });
  assert.deepEqual(out, [0, 10, 20, 30, 40, 50, 60, 70]);
  assert.ok(peak <= 3);
  assert.equal(seen.length, 8);
});
