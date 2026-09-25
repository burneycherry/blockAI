// 画像ツール無しで PNG・TGA を読む
import { inflateSync } from "node:zlib";

/** @typedef {{ w: number, h: number, px: Uint8Array }} Img */

/** PNG を読む（8bit の RGBA・RGB・パレット） @param {Buffer} buf @returns {Img} */
export function decodePng(buf) {
  let pos = 8;
  let w = 0;
  let h = 0;
  let type = 0;
  /** @type {Buffer[]} */
  const idat = [];
  let plte = Buffer.alloc(0);
  let trns = Buffer.alloc(0);
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const t = buf.toString("ascii", pos + 4, pos + 8);
    const d = buf.subarray(pos + 8, pos + 8 + len);
    if (t === "IHDR") {
      w = d.readUInt32BE(0);
      h = d.readUInt32BE(4);
      if (d[8] !== 8) throw new Error("8bit の PNG だけ読めます");
      type = d[9];
    } else if (t === "PLTE") plte = d;
    else if (t === "tRNS") trns = d;
    else if (t === "IDAT") idat.push(d);
    pos += 12 + len;
  }
  const bpp = { 6: 4, 2: 3, 3: 1, 4: 2, 0: 1 }[type];
  if (!bpp) throw new Error(`PNG の形式 ${type} は読めません`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const cur = Buffer.alloc(stride);
  const prev = Buffer.alloc(stride);
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const s = x * bpp;
      if (type === 6) px.set(cur.subarray(s, s + 4), o);
      else if (type === 2) px.set([cur[s], cur[s + 1], cur[s + 2], 255], o);
      else if (type === 3) {
        const k = cur[s];
        px.set([plte[k * 3], plte[k * 3 + 1], plte[k * 3 + 2], k < trns.length ? trns[k] : 255], o);
      } else if (type === 4) px.set([cur[s], cur[s], cur[s], cur[s + 1]], o);
      else px.set([cur[s], cur[s], cur[s], 255], o);
    }
    cur.copy(prev);
  }
  return { w, h, px };
}

/** 圧縮なしの TGA（24/32bit）を読む @param {Buffer} buf @returns {Img} */
export function decodeTga(buf) {
  if (buf[2] !== 2) throw new Error("圧縮なしの TGA だけ読めます");
  const w = buf.readUInt16LE(12);
  const h = buf.readUInt16LE(14);
  const bpp = buf[16] / 8;
  const top = (buf[17] & 0x20) !== 0;
  const start = 18 + buf[0];
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = top ? y : h - 1 - y;
    for (let x = 0; x < w; x++) {
      const s = start + (sy * w + x) * bpp;
      px.set([buf[s + 2], buf[s + 1], buf[s], bpp === 4 ? buf[s + 3] : 255], (y * w + x) * 4);
    }
  }
  return { w, h, px };
}

