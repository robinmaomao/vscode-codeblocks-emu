// 把若干张窗口截图编码成 README 用的动图（900px 宽，逐帧调色板）。
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');

const TARGET_WIDTH = 900;
const DELAY_MS = 1200;

function resize(src, srcW, srcH, dstW, dstH) {
  const out = Buffer.alloc(dstW * dstH * 4);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const y0 = Math.floor(y * yRatio);
    const y1 = Math.min(srcH, Math.ceil((y + 1) * yRatio));
    for (let x = 0; x < dstW; x++) {
      const x0 = Math.floor(x * xRatio);
      const x1 = Math.min(srcW, Math.ceil((x + 1) * xRatio));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * srcW + sx) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3];
          n++;
        }
      }
      const o = (y * dstW + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

function main() {
  const outPath = process.argv[2];
  const inputs = process.argv.slice(3);
  if (!outPath || inputs.length === 0) {
    console.error('usage: node encode-gif.js <out.gif> <frame1.png> [frame2.png ...]');
    process.exit(1);
  }

  const encoder = GIFEncoder();
  for (const file of inputs) {
    const png = PNG.sync.read(fs.readFileSync(file));
    const width = TARGET_WIDTH;
    const height = Math.round((png.height / png.width) * TARGET_WIDTH);
    const rgba = resize(png.data, png.width, png.height, width, height);
    const palette = quantize(rgba, 256, { format: 'rgba4444' });
    const index = applyPalette(rgba, palette, 'rgba4444');
    encoder.writeFrame(index, width, height, { palette, delay: DELAY_MS });
    console.log(`frame ${path.basename(file)} -> ${width}x${height}`);
  }
  encoder.finish();
  fs.writeFileSync(outPath, encoder.bytes());
  console.log(`wrote ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);
}

main();
