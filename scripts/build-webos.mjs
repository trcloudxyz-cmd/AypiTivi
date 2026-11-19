import {execSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import zlib from 'node:zlib';
import * as esbuild from 'esbuild';
import * as lightningcss from 'lightningcss';
import postcss from 'postcss';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const webosSrcDir = path.join(rootDir, 'webos');
const distDir = path.join(rootDir, 'dist-webos');
const outDir = path.join(rootDir, 'webos-out');

const appInfo = JSON.parse(fs.readFileSync(path.join(webosSrcDir, 'appinfo.json'), 'utf8'));
const APP_ID = appInfo.id || 'com.aypitivi.iptv';
const APP_VERSION = appInfo.version || '1.0.0';

// ---------------------------------------------------------------------------
// 1. Minimal pure-Node PNG generator for webOS icons & splash (zero extra deps)
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodeRgbaPng(width, height, pixelFn) {
  const stride = 1 + width * 4;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixelFn(x, y, width, height);
      const idx = rowStart + 1 + x * 4;
      raw[idx] = r;
      raw[idx + 1] = g;
      raw[idx + 2] = b;
      raw[idx + 3] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = zlib.deflateSync(raw, {level: 9});
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', compressed),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function createIconPixel(x, y, w, h) {
  // Deep slate #090B0F base with #2563EB rounded center tile and white play triangle
  const cx = w / 2;
  const cy = h / 2;
  const pad = w * 0.14;
  const rx = w / 2 - pad;
  const ry = h / 2 - pad;
  const rad = w * 0.18;

  const dx = Math.max(Math.abs(x - cx) - (rx - rad), 0);
  const dy = Math.max(Math.abs(y - cy) - (ry - rad), 0);
  const inTile = dx * dx + dy * dy <= rad * rad;

  if (!inTile) {
    return [9, 11, 15, 255];
  }

  // White play triangle centered slightly right
  const triLeft = cx - w * 0.11;
  const triRight = cx + w * 0.16;
  const triHalfH = h * 0.18;
  if (x >= triLeft && x <= triRight) {
    const progress = (x - triLeft) / (triRight - triLeft);
    const maxOffset = triHalfH * (1 - progress);
    if (Math.abs(y - cy) <= maxOffset) {
      return [255, 255, 255, 255];
    }
  }

  return [37, 99, 235, 255];
}

function createSplashPixel(x, y, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const boxHalf = 110;
  const rad = 36;
  const dx = Math.max(Math.abs(x - cx) - (boxHalf - rad), 0);
  const dy = Math.max(Math.abs(y - cy) - (boxHalf - rad), 0);
  if (dx * dx + dy * dy <= rad * rad) {
    const triLeft = cx - 28;
    const triRight = cx + 44;
    const triHalfH = 48;
    if (x >= triLeft && x <= triRight) {
      const progress = (x - triLeft) / (triRight - triLeft);
      if (Math.abs(y - cy) <= triHalfH * (1 - progress)) {
        return [255, 255, 255, 255];
      }
    }
    return [37, 99, 235, 255];
  }
  return [9, 11, 15, 255];
}

// ---------------------------------------------------------------------------
// 2. CSS Chromium 68 (webOS 5.0) Compatibility Transform
// ---------------------------------------------------------------------------
function parseColorToRgba(raw) {
  const val = raw.trim().toLowerCase();
  if (val === 'transparent') return [0, 0, 0, 0];
  if (val === 'white' || val === '#fff' || val === '#ffffff') return [255, 255, 255, 1];
  if (val === 'black' || val === '#000' || val === '#000000') return [0, 0, 0, 1];
  const hex6 = /^#([0-9a-f]{6})$/i.exec(val);
  if (hex6) {
    const n = parseInt(hex6[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const hex3 = /^#([0-9a-f]{3})$/i.exec(val);
  if (hex3) {
    const [r, g, b] = hex3[1].split('').map((c) => parseInt(c + c, 16));
    return [r, g, b, 1];
  }
  const rgbMatch = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(
    val,
  );
  if (rgbMatch) {
    return [
      Number(rgbMatch[1]),
      Number(rgbMatch[2]),
      Number(rgbMatch[3]),
      rgbMatch[4] !== undefined ? Number(rgbMatch[4]) : 1,
    ];
  }
  return null;
}

function resolveColorMixForChrome68(value, varMap) {
  if (!value.includes('color-mix(')) return value;
  return value.replace(
    /color-mix\(\s*in\s+(?:oklab|srgb|lab)\s*,\s*([^,]+?)\s+([\d.]+)%\s*,\s*transparent\s*\)/gi,
    (full, colorExpr, pctStr) => {
      let resolved = colorExpr.trim();
      const varMatch = /^var\(\s*(--[^,)\s]+)\s*(?:,\s*([^)]+))?\)$/.exec(resolved);
      if (varMatch) {
        resolved = varMap.get(varMatch[1]) || varMatch[2] || resolved;
      }
      const rgba = parseColorToRgba(resolved);
      if (!rgba) return full;
      const alpha = Math.max(0, Math.min(1, (Number(pctStr) / 100) * rgba[3]));
      return `rgba(${Math.round(rgba[0])}, ${Math.round(rgba[1])}, ${Math.round(rgba[2])}, ${Number(
        alpha.toFixed(4),
      )})`;
    },
  );
}

function rewriteSelectorForChrome68(selector) {
  // Replace :where(...) and :is(...) with Chrome 68 compatible :-webkit-any(...) or unwrapped forms
  let out = selector
    .replace(/:where\(([^()]+)\)/g, (_, inner) => {
      const trimmed = inner.trim();
      if (!trimmed.includes(',') && !trimmed.includes(':is(')) {
        return trimmed;
      }
      return `:-webkit-any(${trimmed})`;
    })
    .replace(/:is\(([^()]+)\)/g, ':-webkit-any($1)');
  // Handle one more level of nested :where(...)
  out = out.replace(/:where\(([^)]+)\)/g, ':-webkit-any($1)');
  return out;
}

function transformCssForWebOs5(cssBuffer, filename) {
  // Pass 1: LightningCSS downlevels oklch/oklab/nesting/modern rgb() to Chrome 68
  const pass1 = lightningcss.transform({
    filename,
    code: cssBuffer,
    minify: false,
    targets: {chrome: 68 << 16},
  });

  const root = postcss.parse(pass1.code.toString());

  // Collect CSS custom property values for color-mix resolution (prefer Chrome-68 parseable hex/rgb over lab/oklch)
  const varMap = new Map();
  root.walkDecls((decl) => {
    if (decl.prop.startsWith('--') && !decl.value.includes('var(') && !decl.value.includes('color-mix')) {
      const val = decl.value.trim();
      if (parseColorToRgba(val)) {
        varMap.set(decl.prop, val);
      }
    }
  });

  // Drop @supports blocks whose condition checks color-mix/lab/oklch (unsupported in Chrome 68)
  root.walkAtRules('supports', (atRule) => {
    if (/(color-mix|lab\(|oklab\(|oklch\()/i.test(atRule.params)) {
      atRule.remove();
    }
  });

  // Unwrap @layer blocks in document cascade order
  root.walkAtRules('layer', (layerRule) => {
    if (!layerRule.nodes || layerRule.nodes.length === 0) {
      layerRule.remove();
      return;
    }
    if (layerRule.params.trim() === 'properties') {
      // Unwrap Tailwind v4 @supports inside @layer properties so --tw-* defaults apply in Chrome 68
      const expanded = [];
      for (const child of layerRule.nodes) {
        if (child.type === 'atrule' && child.name === 'supports' && child.nodes) {
          expanded.push(...child.nodes);
        } else {
          expanded.push(child);
        }
      }
      layerRule.replaceWith(...expanded);
    } else {
      layerRule.replaceWith(...layerRule.nodes);
    }
  });

  root.walkRules((rule) => {
    if (rule.selector.includes(':where(') || rule.selector.includes(':is(')) {
      rule.selector = rewriteSelectorForChrome68(rule.selector);
    }
  });

  root.walkDecls((decl) => {
    if (decl.value.includes('color-mix(')) {
      decl.value = resolveColorMixForChrome68(decl.value, varMap);
    }
  });

  const pass2 = lightningcss.transform({
    filename,
    code: Buffer.from(root.toString(), 'utf8'),
    minify: true,
    targets: {chrome: 68 << 16},
  });

  return pass2.code;
}

// ---------------------------------------------------------------------------
// 3. Pure-Node USTAR tar.gz + Debian ar (.ipk) archive builder
// ---------------------------------------------------------------------------
function makeTarHeader(name, size, mode, isDir = false) {
  const header = Buffer.alloc(512, 0);
  let entryName = name;
  let prefix = '';
  if (Buffer.byteLength(entryName, 'utf8') > 99) {
    const slashIdx = entryName.lastIndexOf('/', 99);
    if (slashIdx > 0 && entryName.length - slashIdx - 1 <= 99 && slashIdx <= 154) {
      prefix = entryName.slice(0, slashIdx);
      entryName = entryName.slice(slashIdx + 1);
    } else {
      entryName = entryName.slice(0, 99);
    }
  }
  header.write(entryName, 0, 'utf8');
  header.write(mode.toString(8).padStart(7, '0') + '\0', 100, 'ascii');
  header.write('0000000\0', 108, 'ascii'); // uid
  header.write('0000000\0', 116, 'ascii'); // gid
  header.write(size.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
  const mtime = Math.floor(Date.now() / 1000);
  header.write(mtime.toString(8).padStart(11, '0') + '\0', 136, 'ascii');
  header.write('        ', 148, 'ascii'); // chksum placeholder
  header.write(isDir ? '5' : '0', 156, 'ascii');
  header.write('ustar\0', 257, 'ascii');
  header.write('00', 263, 'ascii');
  header.write('root', 265, 'ascii');
  header.write('root', 297, 'ascii');
  if (prefix) {
    header.write(prefix, 345, 'utf8');
  }

  let sum = 0;
  for (let i = 0; i < 512; i += 1) {
    sum += header[i];
  }
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  return header;
}

function buildTarGz(entries) {
  const chunks = [];
  for (const entry of entries) {
    const content = entry.data || Buffer.alloc(0);
    chunks.push(makeTarHeader(entry.name, entry.isDir ? 0 : content.length, entry.mode, entry.isDir));
    if (!entry.isDir && content.length > 0) {
      chunks.push(content);
      const rem = content.length % 512;
      if (rem !== 0) {
        chunks.push(Buffer.alloc(512 - rem, 0));
      }
    }
  }
  chunks.push(Buffer.alloc(1024, 0)); // two 512-byte EOF blocks
  return zlib.gzipSync(Buffer.concat(chunks), {level: 9});
}

function makeArMember(name, data) {
  const header = Buffer.alloc(60, 0x20);
  header.write(name.padEnd(16, ' ').slice(0, 16), 0, 'ascii');
  header.write(String(Math.floor(Date.now() / 1000)).padEnd(12, ' ').slice(0, 12), 16, 'ascii');
  header.write('0'.padEnd(6, ' '), 28, 'ascii');
  header.write('0'.padEnd(6, ' '), 34, 'ascii');
  header.write('100644'.padEnd(8, ' '), 40, 'ascii');
  header.write(String(data.length).padEnd(10, ' ').slice(0, 10), 48, 'ascii');
  header.write('`\n', 58, 'ascii');

  const pad = data.length % 2 === 1 ? Buffer.from('\n', 'ascii') : Buffer.alloc(0);
  return Buffer.concat([header, data, pad]);
}

function collectFilesRecursive(dir, baseRel = '') {
  const results = [];
  const items = fs.readdirSync(dir, {withFileTypes: true});
  items.sort((a, b) => a.name.localeCompare(b.name));
  for (const item of items) {
    const full = path.join(dir, item.name);
    const rel = baseRel ? `${baseRel}/${item.name}` : item.name;
    if (item.isDirectory()) {
      results.push({rel, full, isDir: true});
      results.push(...collectFilesRecursive(full, rel));
    } else {
      results.push({rel, full, isDir: false});
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// 4. Execute webOS 5.0 Build & Package .ipk
// ---------------------------------------------------------------------------
console.log('1/5 Vite webOS derlemesi başlatılıyor...');
execSync('npx vite build', {
  cwd: rootDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    WEBOS_BUILD: 'true',
  },
});

console.log('2/5 JS ve CSS varlıkları LG webOS 5.0 (Chromium 68) uyumluluğuna dönüştürülüyor...');
const assetsDir = path.join(distDir, 'assets');
const assetFiles = fs.readdirSync(assetsDir);

for (const file of assetFiles) {
  const fullPath = path.join(assetsDir, file);
  if (file.endsWith('.js')) {
    const rawJs = fs.readFileSync(fullPath, 'utf8');
    const transformed = await esbuild.transform(rawJs, {
      loader: 'js',
      target: 'chrome68',
      format: 'iife',
      minify: true,
    });
    fs.writeFileSync(fullPath, transformed.code, 'utf8');
  } else if (file.endsWith('.css')) {
    const rawCss = fs.readFileSync(fullPath);
    const transformedCss = transformCssForWebOs5(rawCss, file);
    fs.writeFileSync(fullPath, transformedCss);
  }
}

console.log('3/5 index.html file:// yüklemesi için düzenleniyor...');
const indexHtmlPath = path.join(distDir, 'index.html');
let indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
indexHtml = indexHtml
  .replace(/<script\s+type="module"\s+crossorigin\s+src="([^"]+)"\s*><\/script>/gi, '<script defer src="$1"></script>')
  .replace(/<link\s+rel="stylesheet"\s+crossorigin\s+href="([^"]+)"\s*>/gi, '<link rel="stylesheet" href="$1">');
fs.writeFileSync(indexHtmlPath, indexHtml, 'utf8');

console.log('4/5 webOS uygulama manifesti ve PNG ikonlar oluşturuluyor...');
// Exclude temporary chat upload screenshots if present in public/assets/aistudio
const aistudioAssetsDir = path.join(distDir, 'assets', 'aistudio');
if (fs.existsSync(aistudioAssetsDir)) {
  fs.rmSync(aistudioAssetsDir, {recursive: true, force: true});
}
fs.copyFileSync(path.join(webosSrcDir, 'appinfo.json'), path.join(distDir, 'appinfo.json'));
fs.writeFileSync(path.join(distDir, 'icon.png'), encodeRgbaPng(80, 80, createIconPixel));
fs.writeFileSync(path.join(distDir, 'largeIcon.png'), encodeRgbaPng(130, 130, createIconPixel));
fs.writeFileSync(
  path.join(distDir, 'splashBackground.png'),
  encodeRgbaPng(1920, 1080, createSplashPixel),
);

console.log('5/5 .ipk paketi oluşturuluyor...');
fs.mkdirSync(outDir, {recursive: true});

const appInstallPrefix = `./usr/palm/applications/${APP_ID}`;
const dataEntries = [
  {name: './', isDir: true, mode: 0o755},
  {name: './usr/', isDir: true, mode: 0o755},
  {name: './usr/palm/', isDir: true, mode: 0o755},
  {name: './usr/palm/applications/', isDir: true, mode: 0o755},
  {name: `${appInstallPrefix}/`, isDir: true, mode: 0o755},
];

let totalBytes = 0;
for (const entry of collectFilesRecursive(distDir)) {
  if (entry.isDir) {
    dataEntries.push({
      name: `${appInstallPrefix}/${entry.rel}/`,
      isDir: true,
      mode: 0o755,
    });
  } else {
    const data = fs.readFileSync(entry.full);
    totalBytes += data.length;
    dataEntries.push({
      name: `${appInstallPrefix}/${entry.rel}`,
      isDir: false,
      mode: 0o644,
      data,
    });
  }
}

const installedKb = Math.max(1, Math.ceil(totalBytes / 1024));
const controlText = [
  `Package: ${APP_ID}`,
  `Version: ${APP_VERSION}`,
  'Section: misc',
  'Priority: optional',
  'Architecture: all',
  `Installed-Size: ${installedKb}`,
  'Maintainer: AyPi Tivi <support@aypitivi.local>',
  'Description: AyPi Tivi LG webOS 5.0 IPTV Oynatici',
  `webOS-Package-Format-Version: 2`,
  `webOS-Application-ID: ${APP_ID}`,
  '',
].join('\n');

const controlTarGz = buildTarGz([
  {name: './', isDir: true, mode: 0o755},
  {name: './control', isDir: false, mode: 0o644, data: Buffer.from(controlText, 'utf8')},
]);

const dataTarGz = buildTarGz(dataEntries);
const debianBinary = Buffer.from('2.0\n', 'ascii');

const ipkBuffer = Buffer.concat([
  Buffer.from('!<arch>\n', 'ascii'),
  makeArMember('debian-binary', debianBinary),
  makeArMember('control.tar.gz', controlTarGz),
  makeArMember('data.tar.gz', dataTarGz),
]);

const ipkFilename = `${APP_ID}_${APP_VERSION}_all.ipk`;
const ipkPath = path.join(outDir, ipkFilename);
fs.writeFileSync(ipkPath, ipkBuffer);

console.log(`Hazır! Paket oluşturuldu: ${ipkPath} (${(ipkBuffer.length / 1024 / 1024).toFixed(2)} MB)`);
