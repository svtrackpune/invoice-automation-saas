const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const BRAND_SOURCE = Buffer.from('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', 'base64');
const NAVY = { r: 9, g: 21, b: 52, alpha: 1 };
const OUTPUTS = [
  'app/icon.png', 'app/apple-icon.png', 'app/favicon.ico',
  'public/moneymatters-192.png', 'public/moneymatters-512.png', 'public/moneymatters-pdf.png',
  'public/icons/moneymatters.svg',
  'android/app/src/main/res/mipmap-mdpi/ic_launcher.png', 'android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png', 'android/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.png',
  'android/app/src/main/res/mipmap-hdpi/ic_launcher.png', 'android/app/src/main/res/mipmap-hdpi/ic_launcher_round.png', 'android/app/src/main/res/mipmap-hdpi/ic_launcher_foreground.png',
  'android/app/src/main/res/mipmap-xhdpi/ic_launcher.png', 'android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.png', 'android/app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.png',
  'android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png', 'android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png', 'android/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.png',
  'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png', 'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png', 'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png',
];
const out = (relative) => path.join(ROOT, relative);
const sizes = async (size, options = {}) => {
  let pipeline = sharp(BRAND_SOURCE, { failOn: 'error' }).resize(size, size, {
    fit: 'contain', kernel: sharp.kernel.lanczos3,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });
  if (options.palette !== false) pipeline = pipeline.png({ palette: true, colors: 128, quality: 90, effort: 10, compressionLevel: 9 });
  else pipeline = pipeline.png({ compressionLevel: 9 });
  return pipeline.toBuffer();
};
const write = async (relative, buffer) => {
  const target = out(relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buffer);
};
const roundIcon = async (size) => {
  const logo = await sizes(size, { palette: false });
  const mask = Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="#fff"/></svg>`);
  return sharp(logo).composite([{ input: await sharp(mask).png().toBuffer(), blend: 'dest-in' }]).png({ palette: true, colors: 128, quality: 90, effort: 10, compressionLevel: 9 }).toBuffer();
};
const adaptiveForeground = async (size) => {
  const inner = Math.round(size * 0.78);
  const logo = await sizes(inner, { palette: false });
  return sharp({ create: { width: size, height: size, channels: 4, background: { ...NAVY, alpha: 0 } } })
    .composite([{ input: logo, left: Math.floor((size - inner) / 2), top: Math.floor((size - inner) / 2) }])
    .png({ palette: true, colors: 128, quality: 90, effort: 10, compressionLevel: 9 }).toBuffer();
};
const icoFromPngs = (images) => {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, buffer }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2); header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(buffer.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
    offset += buffer.length;
  });
  return Buffer.concat([header, ...images.map((item) => item.buffer)]);
};

async function main() {
  const logo512 = await sizes(512);
  const logo192 = await sizes(192);
  const apple180 = await sizes(180);
  const pdfMark = await sizes(32);
  await Promise.all([
    write('app/icon.png', logo512),
    write('app/apple-icon.png', apple180),
    write('public/moneymatters-192.png', logo192),
    write('public/moneymatters-512.png', logo512),
    write('public/moneymatters-pdf.png', pdfMark),
  ]);
  const favicon = await Promise.all([16, 32, 48].map(async (size) => ({ size, buffer: await sizes(size) })));
  await write('app/favicon.ico', icoFromPngs(favicon));
  const embedded = logo512.toString('base64');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><image href="data:image/png;base64,' + embedded + '" width="512" height="512" preserveAspectRatio="xMidYMid meet"/></svg>';
  await write('public/icons/moneymatters.svg', Buffer.from(svg, 'utf8'));
  const densities = [
    { name: 'mdpi', icon: 48, foreground: 108 }, { name: 'hdpi', icon: 72, foreground: 162 },
    { name: 'xhdpi', icon: 96, foreground: 216 }, { name: 'xxhdpi', icon: 144, foreground: 324 },
    { name: 'xxxhdpi', icon: 192, foreground: 432 },
  ];
  for (const density of densities) {
    const directory = `android/app/src/main/res/mipmap-${density.name}`;
    await write(`${directory}/ic_launcher.png`, await sizes(density.icon));
    await write(`${directory}/ic_launcher_round.png`, await roundIcon(density.icon));
    await write(`${directory}/ic_launcher_foreground.png`, await adaptiveForeground(density.foreground));
  }
  for (const relative of OUTPUTS) {
    const p = out(relative);
    if (!fs.existsSync(p) || fs.statSync(p).size === 0) throw new Error('Brand asset was not generated: ' + relative);
  }
  console.log('[branding] generated Money Matters app, web, favicon, PDF, PWA and Android assets.');
}
main().catch((error) => { console.error('[branding] asset generation failed:', error); process.exitCode = 1; });
