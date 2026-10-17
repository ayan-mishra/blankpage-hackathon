import test from 'node:test';
import assert from 'node:assert/strict';
import { placeCallout } from '../src/tour.js';

const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
const inside = (p, r) => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
const tip = (p) => ({ x: p.arrow.x, y: p.arrow.to });
const desk = { w: 1280, h: 720 }, phone = { w: 375, h: 812 }, box = { w: 320, h: 120 };

test('goes below the target when there is room, arrow tip inside the target', () => {
  const t = rect(600, 100, 180, 40), p = placeCallout(t, t, box, desk);
  assert.equal(p.side, 'below');
  assert.ok(p.top >= t.bottom);
  assert.ok(inside(tip(p), t));
  assert.equal(p.arrow.from, p.top); // the arrow starts at the callout's top edge
});

test('flips above when there is no room below', () => {
  const t = rect(600, 640, 180, 40), p = placeCallout(t, t, box, desk);
  assert.equal(p.side, 'above');
  assert.ok(p.top + box.h <= t.top);
  assert.equal(p.arrow.from, p.top + box.h);
  assert.ok(inside(tip(p), t));
});

test('clears the whole "around" box but still points at the smaller target in it', () => {
  const map = rect(300, 200, 944, 200), hum = rect(750, 310, 450, 30);
  const p = placeCallout(hum, map, box, desk);
  assert.equal(p.side, 'below');
  assert.ok(p.top >= map.bottom); // never covers the map
  assert.ok(inside(tip(p), hum));
});

test('on a 375px phone the callout fits the screen even for a target at the edge', () => {
  const t = rect(330, 300, 40, 30), p = placeCallout(t, t, { w: 351, h: 130 }, phone);
  assert.ok(p.left >= 12 && p.left + 351 <= 375 - 12);
  assert.ok(inside(tip(p), t));
});

test('a target running off-screen gets the arrow on its visible part', () => {
  const t = rect(200, 300, 600, 30), p = placeCallout(t, t, { w: 300, h: 100 }, phone);
  assert.ok(p.arrow.x >= 200 && p.arrow.x <= 375);
});

test('with no room either side it takes the roomier side', () => {
  const t = rect(10, 50, 100, 600), p = placeCallout(t, t, box, desk);
  assert.equal(p.side, 'below'); // neither side fits; below has more room
  assert.ok(inside(tip(p), t));
});

test('a short target keeps the tip inside it', () => {
  const t = rect(100, 100, 50, 6), p = placeCallout(t, t, box, desk);
  assert.ok(inside(tip(p), t));
});
