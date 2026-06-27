'use strict';
// Packs build/icons/icon_<size>.png into a single multi-resolution build/icon.ico.
// Uses PNG-compressed entries (valid on Windows Vista+), which keeps the 256px
// image small and crisp.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const iconsDir = path.join(root, 'build', 'icons');
const outFile = path.join(root, 'build', 'icon.ico');
const sizes = [16, 24, 32, 48, 64, 128, 256];

const images = sizes
  .map((s) => ({ s, file: path.join(iconsDir, `icon_${s}.png`) }))
  .filter((x) => fs.existsSync(x.file))
  .map((x) => ({ s: x.s, buf: fs.readFileSync(x.file) }));

if (!images.length) { console.error('No PNG icons found in', iconsDir); process.exit(1); }

const count = images.length;
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);      // reserved
header.writeUInt16LE(1, 2);      // type: icon
header.writeUInt16LE(count, 4);  // image count

const entries = Buffer.alloc(16 * count);
let offset = 6 + 16 * count;
images.forEach((img, i) => {
  const e = i * 16;
  entries.writeUInt8(img.s >= 256 ? 0 : img.s, e + 0); // width (0 => 256)
  entries.writeUInt8(img.s >= 256 ? 0 : img.s, e + 1); // height
  entries.writeUInt8(0, e + 2);                        // color palette
  entries.writeUInt8(0, e + 3);                        // reserved
  entries.writeUInt16LE(1, e + 4);                     // color planes
  entries.writeUInt16LE(32, e + 6);                    // bits per pixel
  entries.writeUInt32LE(img.buf.length, e + 8);        // size of image data
  entries.writeUInt32LE(offset, e + 12);               // offset of image data
  offset += img.buf.length;
});

fs.writeFileSync(outFile, Buffer.concat([header, entries, ...images.map((i) => i.buf)]));
console.log(`Wrote ${outFile} (${count} sizes, ${offset} bytes)`);
