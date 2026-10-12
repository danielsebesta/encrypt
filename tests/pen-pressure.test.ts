import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strokeOutline } from '@quickdrawjs/core';

const line = (pressure: number, count = 40) =>
  Array.from({ length: count }, (_, i) => [i * 3, 0, pressure]).flat();

const width = (outline: number[]) => {
  const ys = outline.filter((_, i) => i % 2 === 1);
  return Math.max(...ys) - Math.min(...ys);
};

const pen = (pressure: number) => width(strokeOutline(line(pressure), { size: 5.2, simulate: false }));

test('pen stroke width follows pressure over a wide range', () => {
  assert.ok(pen(0.9) / pen(0.1) > 3.5, 'hard pressure is at least 3.5x a light touch');
  assert.ok(pen(0.7) > pen(0.5) && pen(0.5) > pen(0.3) && pen(0.3) > pen(0.1));
});

test('half pressure draws the nominal width and full pressure stays bounded', () => {
  assert.ok(Math.abs(pen(0.55) - 5.2) < 0.8);
  assert.ok(pen(1) < 5.2 * 2);
});

test('pressure ramps smoothly instead of stepping', () => {
  const pts = Array.from({ length: 40 }, (_, i) => [i * 3, 0, 0.1 + (0.8 * i) / 39]).flat();
  const outline = strokeOutline(pts, { size: 5.2, simulate: false, taper: false });
  const edge = outline.slice(0, 80).filter((_, i) => i % 2 === 1);
  const steps = edge.slice(1).map((y, i) => Math.abs(y - edge[i]));
  assert.ok(Math.max(...steps) < 0.5, 'no single sample changes the edge by half a pixel');
});

test('mouse strokes keep the speed-based width', () => {
  const mouse = width(strokeOutline(line(0.5), { size: 5.2, simulate: true }));
  assert.ok(mouse > 1.5 && mouse <= 5.2);
});
