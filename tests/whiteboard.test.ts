import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validShapeRecord, sanitizeScribbles } from '../src/lib/whiteboardRecords';
import { splitDocUpdate, DocPartAssembler } from '../src/lib/whiteboardSync';

const shape = (type: string, props: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ id: 'shape:abc123', typeName: 'shape', type, x: 10, y: 20, rot: 0, z: 1, props, ...extra });

test('accepts every shape kind the editor creates', () => {
  const ok = [
    shape('draw', { pts: [0, 0, 0.5, 4, 4, 0.5], color: 'black', size: 'm', dash: 'draw', done: true }),
    shape('highlight', { pts: [0, 0, 0.5], color: 'yellow', size: 'l', done: false }),
    shape('geo', { geo: 'star', w: 160, h: 160, color: 'blue', size: 'm', dash: 'solid', fill: 'semi', font: 'draw', label: 'hi' }),
    shape('arrow', { dx: 30, dy: -10, bend: 4, color: 'red', size: 's', dash: 'dashed' }),
    shape('line', { dx: 1, dy: 1, bend: 0, color: 'green', size: 'xl', dash: 'dotted' }),
    shape('text', { text: 'Ahoj\nsvěte', color: 'violet', size: 'm', font: 'sans', autosize: true, scale: 1 }),
    shape('note', { text: '', color: 'yellow', size: 'm', font: 'draw', scale: 1.4 }),
  ];
  for (const rec of ok) assert.equal(validShapeRecord(rec, rec.id), true, rec.type);
});

test('rejects records that could break rendering or leak data', () => {
  const geo = { geo: 'rectangle', w: 10, h: 10, color: 'black', size: 'm', dash: 'draw', fill: 'none' };
  const bad: [unknown, string][] = [
    [shape('geo', geo), 'shape:other'],
    [shape('geo', { ...geo, color: 'hotpink' }), 'shape:abc123'],
    [shape('geo', { ...geo, w: 0 }), 'shape:abc123'],
    [shape('geo', { ...geo, nested: { a: 1 } }), 'shape:abc123'],
    [shape('geo', { geo: 'rectangle', w: 10, h: 10, color: 'black', size: 'm' }), 'shape:abc123'],
    [shape('geo', geo, { x: Infinity }), 'shape:abc123'],
    [shape('image', { w: 10, h: 10, assetId: 'asset:x' }), 'shape:abc123'],
    [{ id: 'asset:x', typeName: 'asset', src: 'https://evil.example/a.png', w: 1, h: 1 }, 'asset:x'],
    [shape('draw', { pts: [0, 0], color: 'black', size: 'm' }), 'shape:abc123'],
    [shape('draw', { pts: [0, 0, NaN], color: 'black', size: 'm' }), 'shape:abc123'],
    [shape('text', { text: 'x'.repeat(20001), color: 'black', size: 'm' }), 'shape:abc123'],
    [JSON.parse('{"id":"shape:abc123","typeName":"shape","type":"text","x":0,"y":0,"rot":0,"z":0,"props":{"__proto__":{"a":1},"text":"","color":"black","size":"m"}}'), 'shape:abc123'],
    [null, 'shape:abc123'],
  ];
  for (const [rec, key] of bad) assert.equal(validShapeRecord(rec, key), false, JSON.stringify(rec)?.slice(0, 80));
});

test('laser trails are trimmed and cleaned for the wire', () => {
  const long = Array.from({ length: 200 }, (_, i) => ({ x: i + 0.123, y: -i }));
  const out = sanitizeScribbles([
    { points: long, opacity: 0.456 },
    { points: [{ x: 'a', y: 1 }], opacity: 1 },
    'junk',
    { points: [{ x: 1, y: 2 }], opacity: 7 },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].points.length, 80);
  assert.deepEqual(out[0].points.at(-1), { x: 199.1, y: -199 });
  assert.equal(out[0].opacity, 0.46);
  assert.equal(out[1].opacity, 1);
  assert.deepEqual(sanitizeScribbles('nope'), []);
});

test('large doc updates split into parts and reassemble in any order', () => {
  const update = new Uint8Array(1000).map((_, i) => i % 251);
  const parts = splitDocUpdate(update, 300)!;
  assert.equal(parts.length, 4);
  const asm = new DocPartAssembler();
  const order = [2, 0, 3];
  for (const i of order) assert.deepEqual(asm.accept('peer', parts[i]), { received: order.indexOf(i) + 1, total: 4 });
  assert.equal(asm.accept('peer', parts[0]), null);
  const done = asm.accept('peer', parts[1]);
  assert.deepEqual(done?.update, update);
  assert.equal(splitDocUpdate(new Uint8Array(10), 300), null);
  assert.equal(splitDocUpdate(new Uint8Array(300 * 65), 300), null);
});

test('part assembly is kept per sender, bounded and expires', () => {
  let now = 0;
  const asm = new DocPartAssembler(500, () => now);
  const parts = splitDocUpdate(new Uint8Array(600), 300)!;
  assert.ok(asm.accept('a', parts[0]));
  assert.equal(asm.accept('b', parts[1])?.update, undefined);
  assert.equal(asm.accept('a', parts[1]), null);

  const small = splitDocUpdate(new Uint8Array(400), 300)!;
  now = 200_000;
  assert.deepEqual(asm.accept('c', small[1]), { received: 1, total: 2 });
  asm.drop('c');
  assert.deepEqual(asm.accept('c', small[0]), { received: 1, total: 2 });

  const bad = parts[0].slice();
  bad[0] = 9;
  assert.equal(asm.accept('d', bad), null);
});
