// THE WORLD IN ONE DAY — a front page for Monday 23 November 2026, drawn entirely in code.
//
// A Node 22 program using only the standard library. It rasterises a newspaper front page
// into a pixel buffer with its own drawing routines and a 5x7 bitmap font, encodes the
// buffer as a PNG by hand (zlib is part of Node), and writes it to /output/entry.png
// (MAKEFUN_OUTPUT_DIR stands in for /output outside the grader's container):
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// The stories are the day's real headlines of 23 November 2026, as reported that day:
// Nvidia reinstated Jensen Huang as CEO and markets rocketed; Ukraine's sea drones sank a
// Russian warship off Libya; Democrats won their biggest US House majority since 1992;
// the COP31 climate talks in Antalya collapsed with no fossil-fuel deal; the WHO pleaded
// for calm as fighting stalled the Ebola response in DR Congo; 12,000 people were evacuated
// from a Manchester concert; Bangladesh vowed to arrest Sheikh Hasina if she returns;
// CrowdStrike agreed to buy Zscaler for $44bn; Spain's courts cleared Carles Puigdemont's
// return from exile; and the 2031 Women's World Cup went to the USA, Mexico, Costa Rica
// and Jamaica.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------- PNG encoding
// A minimal, correct PNG writer: signature, IHDR (8-bit RGB), one IDAT of deflated
// scanlines (filter byte 0 per row), IEND. CRCs are the standard PNG CRC-32.

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePNG(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- canvas
const W = 1024;
const H = 1024;
const px = Buffer.alloc(W * H * 3);

const PAPER = [247, 242, 226];
const INK = [22, 24, 29];
const WHITE = [255, 255, 255];
const RED = [179, 53, 43];
const NAVY = [29, 78, 137];
const GREEN = [32, 116, 74];
const GOLD = [169, 116, 12];
const TEAL = [14, 124, 134];
const GREY = [96, 94, 84];
const SKY = [174, 205, 230];
const SEA = [64, 116, 168];

function setPx(x, y, c) {
  // Round first: the icon sketches work in fractional units, and a fractional
  // index into the pixel buffer is not just dropped — a y of k + 0.5 makes the
  // computed byte index an integer again, 512 pixels to the left, and paints a
  // ghost copy of the stroke there. Rounding keeps every stroke where it belongs.
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
}

function fillRect(x, y, w, h, c) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) setPx(i, j, c);
}

function rectOutline(x, y, w, h, c, t = 3) {
  fillRect(x, y, w, t, c);
  fillRect(x, y + h - t, w, t, c);
  fillRect(x, y, t, h, c);
  fillRect(x + w - t, y, t, h, c);
}

function line(x0, y0, x1, y1, c, t = 3) {
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
  const r = Math.floor(t / 2);
  for (let s = 0; s <= steps; s++) {
    const x = Math.round(x0 + (dx * s) / steps), y = Math.round(y0 + (dy * s) / steps);
    fillRect(x - r, y - r, t, t, c);
  }
}

function fillCircle(cx, cy, r, c) {
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++)
      if (x * x + y * y <= r * r) setPx(cx + x, cy + y, c);
}

function circleOutline(cx, cy, r, c, t = 3) {
  for (let a = 0; a < 360; a += 0.4) {
    const rad = (a * Math.PI) / 180;
    const x = Math.round(cx + r * Math.cos(rad)), y = Math.round(cy + r * Math.sin(rad));
    const q = Math.floor(t / 2);
    fillRect(x - q, y - q, t, t, c);
  }
}

// Filled polygon from a flat [x0, y0, x1, y1, ...] list, scanline fill.
function fillPoly(pts, c) {
  const n = pts.length / 2;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) { minY = Math.min(minY, pts[2 * i + 1]); maxY = Math.max(maxY, pts[2 * i + 1]); }
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    const xs = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x0 = pts[2 * i], y0 = pts[2 * i + 1], x1 = pts[2 * j], y1 = pts[2 * j + 1];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) fillRect(Math.round(xs[k]), y, Math.round(xs[k + 1] - xs[k]), 1, c);
  }
}

// ---------------------------------------------------------------- 5x7 font
// Each glyph is 7 rows of 5 pixels, written as binary strings.
const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11100', '10010', '10001', '10001', '10001', '10010', '11100'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '10001', '11001', '10101', '10011', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '01010', '00100', '00100', '00100', '01010', '10001'],
  Y: ['10001', '01010', '00100', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ',': ['00000', '00000', '00000', '00000', '01100', '01100', '00100'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  ';': ['00000', '01100', '01100', '00000', '01100', '01100', '00100'],
  "'": ['00100', '00100', '01000', '00000', '00000', '00000', '00000'],
  '-': ['00000', '00000', '00000', '01110', '00000', '00000', '00000'],
  '+': ['00000', '00100', '00100', '01110', '00100', '00100', '00000'],
  '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
  '$': ['00100', '01111', '10100', '01110', '00101', '11110', '00100'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '?': ['01110', '10001', '00001', '00110', '00100', '00000', '00100'],
  '&': ['01100', '10010', '10100', '01000', '10101', '10010', '01101'],
  '*': ['00000', '00100', '10101', '01110', '10101', '00100', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

// Width of a string at a scale: 5 px per glyph plus 1 px of tracking, times scale.
function textWidth(str, scale) {
  return str.length * 6 * scale - scale;
}

// Draw a string with its top-left at (x, y). Bold also paints one pixel to the right.
function text(str, x, y, scale, color, bold = false) {
  let cx = x;
  for (const ch of str.toUpperCase()) {
    const glyph = FONT[ch] ?? FONT[' '];
    for (let row = 0; row < 7; row++)
      for (let col = 0; col < 5; col++)
        if (glyph[row][col] === '1') {
          fillRect(cx + col * scale, y + row * scale, scale + (bold ? 1 : 0), scale, color);
        }
    cx += 6 * scale;
  }
}

function textCentered(str, y, scale, color, bold = false) {
  text(str, Math.round((W - textWidth(str, scale)) / 2), y, scale, color, bold);
}

// ---------------------------------------------------------------- pictograms
// Each icon is drawn inside a box whose top-left corner and size are passed in.

// A computer chip with pins, and a rising market arrow beside it (the Nvidia lead).
function drawChip(x, y, s) {
  const u = s / 100; // unit: icons are sketched on a 100x100 grid
  rectOutline(x + 22 * u, y + 22 * u, 46 * u, 46 * u, INK, Math.max(3, 4 * u));
  rectOutline(x + 38 * u, y + 38 * u, 14 * u, 14 * u, GREEN, Math.max(2, 3 * u));
  for (let i = 0; i < 4; i++) {
    const p = (30 + i * 12) * u;
    line(x + p, y + 8 * u, x + p, y + 22 * u, INK, Math.max(2, 3 * u)); // top pins
    line(x + p, y + 68 * u, x + p, y + 82 * u, INK, Math.max(2, 3 * u)); // bottom pins
    line(x + 8 * u, y + p, x + 22 * u, y + p, INK, Math.max(2, 3 * u)); // left pins
    line(x + 68 * u, y + p, x + 82 * u, y + p, INK, Math.max(2, 3 * u)); // right pins
  }
  // rising arrow in the free corner
  line(x + 66 * u, y + 96 * u, x + 96 * u, y + 70 * u, GREEN, Math.max(3, 5 * u));
  fillPoly([x + 96 * u, y + 58 * u, x + 96 * u, y + 78 * u, x + 76 * u, y + 70 * u], GREEN);
}

// A warship on waves with three sea drones above it (Ukraine strikes off Libya).
function drawShip(x, y, s) {
  const u = s / 100;
  // drones
  for (const [dx, dy] of [[14, 6], [44, 0], [72, 8]]) {
    line(x + dx * u, y + dy * u, x + (dx + 16) * u, y + (dy + 10) * u, INK, Math.max(2, 3 * u));
    line(x + (dx + 16) * u, y + dy * u, x + dx * u, y + (dy + 10) * u, INK, Math.max(2, 3 * u));
    fillCircle(x + (dx + 8) * u, y + (dy + 5) * u, Math.max(2, 3 * u), RED);
  }
  // hull and superstructure
  fillPoly([x + 6 * u, y + 58 * u, x + 94 * u, y + 58 * u, x + 84 * u, y + 74 * u, x + 16 * u, y + 74 * u], NAVY);
  fillRect(x + 34 * u, y + 44 * u, 30 * u, 14 * u, NAVY);
  fillRect(x + 56 * u, y + 32 * u, 6 * u, 12 * u, NAVY);
  line(x + 24 * u, y + 58 * u, x + 24 * u, y + 40 * u, INK, Math.max(2, 3 * u));
  // waves
  for (const wy of [82, 92]) {
    for (let wx = 4; wx < 96; wx += 16) {
      line(x + wx * u, y + wy * u, x + (wx + 6) * u, y + (wy - 4) * u, SEA, Math.max(2, 3 * u));
      line(x + (wx + 6) * u, y + (wy - 4) * u, x + (wx + 12) * u, y + wy * u, SEA, Math.max(2, 3 * u));
    }
  }
}

// The US Capitol dome (the Democrats' House majority).
function drawCapitol(x, y, s) {
  const u = s / 100;
  fillRect(x + 8 * u, y + 88 * u, 84 * u, 6 * u, INK); // base
  for (let i = 0; i < 5; i++) fillRect(x + (16 + i * 16) * u, y + 62 * u, 6 * u, 26 * u, INK); // columns
  fillRect(x + 10 * u, y + 56 * u, 80 * u, 6 * u, INK); // entablature
  // dome: a half-disc stepped in rows
  for (let r = 0; r < 26; r++) {
    const half = Math.round(30 * Math.sin(Math.acos(r / 26)));
    fillRect(x + (50 - half) * u, y + (56 - r) * u, 2 * half * u, u + 1, NAVY);
  }
  fillRect(x + 48 * u, y + 18 * u, 4 * u, 12 * u, INK); // lantern
  fillCircle(x + 50 * u, y + 15 * u, Math.max(2, 3 * u), GOLD);
}

// A thermometer at bursting point over a globe arc (the collapsed climate talks).
function drawThermo(x, y, s) {
  const u = s / 100;
  circleOutline(x + 34 * u, y + 52 * u, 40 * u, TEAL, Math.max(3, 4 * u)); // globe
  line(x + 2 * u, y + 38 * u, x + 66 * u, y + 38 * u, TEAL, Math.max(2, 2 * u));
  line(x + 6 * u, y + 66 * u, x + 62 * u, y + 66 * u, TEAL, Math.max(2, 2 * u));
  line(x + 34 * u, y + 12 * u, x + 34 * u, y + 92 * u, TEAL, Math.max(2, 2 * u));
  // thermometer
  fillRect(x + 76 * u, y + 10 * u, 12 * u, 62 * u, WHITE);
  rectOutline(x + 76 * u, y + 10 * u, 12 * u, 62 * u, INK, Math.max(2, 3 * u));
  fillRect(x + 79 * u, y + 16 * u, 6 * u, 56 * u, RED);
  fillCircle(x + 82 * u, y + 80 * u, 12 * u, RED);
  circleOutline(x + 82 * u, y + 80 * u, 12 * u, INK, Math.max(2, 3 * u));
}

// A spiked virus ball with a medical cross (the stalled Ebola response).
function drawVirus(x, y, s) {
  const u = s / 100;
  for (let a = 0; a < 360; a += 30) {
    const rad = (a * Math.PI) / 180;
    const x1 = x + 46 * u + 26 * u * Math.cos(rad), y1 = y + 46 * u + 26 * u * Math.sin(rad);
    const x2 = x + 46 * u + 38 * u * Math.cos(rad), y2 = y + 46 * u + 38 * u * Math.sin(rad);
    line(x1, y1, x2, y2, RED, Math.max(2, 3 * u));
    fillCircle(x2, y2, Math.max(3, 5 * u), RED);
  }
  fillCircle(x + 46 * u, y + 46 * u, 26 * u, RED);
  fillCircle(x + 38 * u, y + 38 * u, Math.max(3, 5 * u), PAPER);
  fillCircle(x + 55 * u, y + 52 * u, Math.max(3, 4 * u), PAPER);
  // medical cross badge
  fillCircle(x + 80 * u, y + 78 * u, 16 * u, GREEN);
  fillRect(x + 77 * u, y + 68 * u, 6 * u, 20 * u, WHITE);
  fillRect(x + 70 * u, y + 75 * u, 20 * u, 6 * u, WHITE);
}

// ---------------------------------------------------------------- the front page
fillRect(0, 0, W, H, PAPER);
rectOutline(16, 16, 992, 992, INK, 4);

// Masthead and the all-important date line.
textCentered('THE WORLD IN ONE DAY', 40, 7, INK, true);
fillRect(40, 104, 944, 4, INK);
fillRect(40, 118, 944, 54, INK);
textCentered('MONDAY 23 NOVEMBER 2026', 127, 5, WHITE, true);

// A story panel: coloured kicker, three bold headline lines, two summary lines,
// and a pictogram in the top-right corner.
function panel(x, y, w, h, kicker, kickerColor, headline, summary, icon) {
  rectOutline(x, y, w, h, INK, 3);
  text(kicker, x + 20, y + 14, 2, kickerColor, true);
  if (icon) icon(x + w - 100, y + 12, 84);
  headline.forEach((ln, i) => text(ln, x + 20, y + 38 + i * 35, 4, INK, true));
  summary.forEach((ln, i) => text(ln, x + 20, y + 146 + i * 25, 3, INK));
}

// The lead: Nvidia brings Jensen Huang back, and Wall Street rockets.
{
  const x = 40, y = 188, w = 944, h = 216;
  rectOutline(x, y, w, h, INK, 3);
  text('TECH * MARKETS * TRUMP ACTS', x + 24, y + 16, 3, RED, true);
  text('NVIDIA BRINGS BACK', x + 24, y + 48, 6, INK, true);
  text('JENSEN HUANG AS CEO', x + 24, y + 100, 6, INK, true);
  text('HE QUIT IN SCANDAL 11 DAYS AGO.', x + 24, y + 154, 3, INK);
  text('SHARES +31%; NASDAQ +6.5%.', x + 24, y + 179, 3, INK);
  drawChip(x + 756, y + 22, 150);
  const stat = 'S&P 500 +4.7%';
  text(stat, x + 756 + 75 - Math.round(textWidth(stat, 3) / 2), y + 182, 3, GREEN, true);
}

// Second row: the war reaches Libya; a historic night for the Democrats.
panel(40, 420, 462, 208, 'EUROPE * AFRICA * WAR', NAVY,
  ['UKRAINE SINKS', 'RUSSIAN', 'WARSHIP OFF LIBYA'],
  ['7 SEA DRONES SANK THE', 'CORVETTE AT BENGHAZI'],
  drawShip);
panel(522, 420, 462, 208, 'US POLITICS', RED,
  ['DEMOCRATS WIN', 'HUGE HOUSE', 'MAJORITY'],
  ['AT LEAST 258 SEATS:', 'BIGGEST SINCE 1992'],
  drawCapitol);

// Third row: the climate talks fail; Ebola medics are trapped by fighting.
panel(40, 644, 462, 208, 'CLIMATE', TEAL,
  ['CLIMATE TALKS', 'COLLAPSE: NO', 'FOSSIL-FUEL DEAL'],
  ['SUMMIT IN ANTALYA ENDS', 'WITH NO DEAL AGREED'],
  drawThermo);
panel(522, 644, 462, 208, 'HEALTH * AFRICA', RED,
  ['FIGHTING', 'STALLS EBOLA', 'RESPONSE IN CONGO'],
  ['WHO PLEADS FOR CALM AS', 'CLASHES TRAP MEDICS'],
  drawVirus);

// Bottom strip: three shorter stories side by side.
function stripItem(x, kicker, kickerColor, lines) {
  text(kicker, x, 868, 2, kickerColor, true);
  lines.forEach((ln, i) => text(ln, x, 886 + i * 23, 3, INK, true));
}
stripItem(40, 'BRITAIN', NAVY, ['12,000 FLEE', 'MANCHESTER GIG']);
fillRect(351, 872, 2, 62, GREY);
stripItem(369, 'BANGLADESH', GOLD, ['HASINA FACES', 'ARREST IF BACK']);
fillRect(671, 872, 2, 62, GREY);
stripItem(689, 'BUSINESS', GREEN, ['CROWDSTRIKE BUYS', 'ZSCALER: $44BN']);

// Footer: two more stories in small print.
fillRect(40, 948, 944, 2, GREY);
textCentered("ALSO: SPAIN'S TOP COURT CLEARS PUIGDEMONT'S RETURN FROM EXILE", 958, 2, INK);
textCentered("2031 WOMEN'S WORLD CUP HOSTS: USA, MEXICO, COSTA RICA, JAMAICA", 978, 2, INK);

// ---------------------------------------------------------------- write it out
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'entry.png'), encodePNG(W, H, px));
