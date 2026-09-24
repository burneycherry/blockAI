// pack_icon.png（64x64）を作る。画像ツール無しで動くように PNG を直接書き出す
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const S = 64;
const px = new Uint8Array(S * S * 3);
const set = (x, y, [r, g, b]) => {
  const i = (y * S + x) * 3;
  px[i] = r; px[i + 1] = g; px[i + 2] = b;
};
const rect = (x0, y0, x1, y1, c) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(x, y, c);
};
rect(0, 0, 64, 64, [120, 190, 240]); // 空
rect(0, 44, 64, 64, [86, 161, 82]); // 草
rect(0, 52, 64, 64, [134, 96, 67]); // 土
rect(14, 26, 50, 48, [196, 150, 100]); // 家の壁
for (let i = 0; i < 20; i++) rect(10 + i, 26 - i, 54 - i, 27 - i, [150, 60, 50]); // 屋根
rect(28, 34, 36, 48, [100, 70, 40]); // ドア
rect(18, 31, 24, 37, [230, 230, 150]); // 窓
rect(40, 31, 46, 37, [230, 230, 150]);

const raw = Buffer.alloc((S * 3 + 1) * S);
for (let y = 0; y < S; y++) {
  raw[y * (S * 3 + 1)] = 0;
  Buffer.from(px.subarray(y * S * 3, (y + 1) * S * 3)).copy(raw, y * (S * 3 + 1) + 1);
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);
for (const p of ["packs/BP/pack_icon.png", "packs/RP/pack_icon.png"]) writeFileSync(p, png);
console.log("icon written");
