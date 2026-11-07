const fs = require('fs'), path = require('path'), os = require('os');
const { PDFDocument, degrees, rgb } = require('pdf-lib');
const { pages, bookletOrder } = require('./shared');
const MM = v => v * 72 / 25.4;
const SZ = { A3: [MM(297), MM(420)], A4: [MM(210), MM(297)], A5: [MM(148), MM(210)], A6: [MM(105), MM(148)], 'A3+': [MM(329), MM(483)] };

async function loadSrc(f) {
  const b = fs.readFileSync(f), ext = path.extname(f).toLowerCase();
  if (ext === '.pdf') return PDFDocument.load(b, { ignoreEncryption: true });
  const d = await PDFDocument.create();
  const im = ext === '.png' ? await d.embedPng(b) : await d.embedJpg(b);
  d.addPage([im.width, im.height]).drawImage(im, { x: 0, y: 0, width: im.width, height: im.height });
  return d;
}

// Builds the sheet-ready PDF: size, n-up, booklet, Arabic (RTL) order, auto-rotate, borders
async function compose(j, outDir) {
  const src = await loadSrc(j.file.path);
  const idx = pages(j.range, src.getPageCount(), j.subset, j.reverse);
  if (!idx.length) throw new Error('نطاق الصفحات فاضي');
  const out = await PDFDocument.create();
  const emb = await out.embedPdf(src, idx);
  const land = j.layout === 'nup2' || j.layout === 'booklet';
  let [w, h] = SZ[j.size] || SZ.A4;
  if (land) [w, h] = [h, w];
  const cols = (j.layout === 'nup4' || land) ? 2 : 1, rows = j.layout === 'nup4' ? 2 : 1;
  const slots = cols * rows, sw = w / cols, sh = h / rows;
  const order = j.layout === 'booklet' ? bookletOrder(emb.length) : emb.map((_, i) => i);
  const m = MM((j.margin === '' || j.margin == null) ? (j.layout === 'normal' ? 0 : 4) : +j.margin);
  for (let s = 0; s < order.length; s += slots) {
    const pg = out.addPage([w, h]);
    for (let k = 0; k < slots; k++) {
      const e = emb[order[s + k]];
      if (!e) continue;
      let col = k % cols; const row = Math.floor(k / cols);
      if (j.rtl && cols > 1) col = cols - 1 - col;
      const bx = col * sw + m, by = h - (row + 1) * sh + m, bw = sw - 2 * m, bh = sh - 2 * m;
      const s0 = Math.min(bw / e.width, bh / e.height), s1 = Math.min(bw / e.height, bh / e.width);
      const rot = j.rot !== false && s1 > s0 * 1.05;
      const sc = j.fit === 'actual' ? 1 : (rot ? s1 : s0);
      const dw = e.width * sc, dh = e.height * sc;
      if (rot) pg.drawPage(e, { x: bx + (bw - dh) / 2 + dh, y: by + (bh - dw) / 2, width: dw, height: dh, rotate: degrees(90) });
      else pg.drawPage(e, { x: bx + (bw - dw) / 2, y: by + (bh - dh) / 2, width: dw, height: dh });
      if (j.border) {
        const rw = rot ? dh : dw, rh = rot ? dw : dh;
        pg.drawRectangle({ x: bx + (bw - rw) / 2, y: by + (bh - rh) / 2, width: rw, height: rh, borderWidth: 0.6, borderColor: rgb(0.55, 0.55, 0.55) });
      }
    }
  }
  const f = path.join(outDir || os.tmpdir(), 'mulhim-' + j.id + '.pdf');
  fs.writeFileSync(f, await out.save());
  return f;
}
module.exports = { compose, SZ };
