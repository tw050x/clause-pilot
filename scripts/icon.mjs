// Renders the app icon (build/icon.svg) into the files electron-builder packages:
//   build/icon.icns  macOS (Apple's grid: the rounded square with its margin)
//   build/icon.ico   Windows (cropped to the square, 16–256 px)
//   build/icon.png   Linux, and the window/dock icon in development (cropped, 1024 px)
// Run with: npm run icon  (uses Electron to draw the SVG, and macOS's iconutil for the .icns)
import { app, BrowserWindow } from 'electron'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const build = join(dirname(fileURLToPath(import.meta.url)), '..', 'build')
const svg = readFileSync(join(build, 'icon.svg'), 'utf8')
/** The art cropped to the rounded square, for platforms that don't add their own margin. */
const cropped = svg.replace('viewBox="0 0 1024 1024"', 'viewBox="100 100 824 824"')

app.disableHardwareAcceleration()
// Each size gets its own window; closing one mustn't end the run.
app.on('window-all-closed', () => {})
const work = mkdtempSync(join(tmpdir(), 'clause-pilot-icon-'))

async function render(source, size) {
  const win = new BrowserWindow({ width: size, height: size, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } })
  const html = `<html><body style="margin:0;background:transparent"><img width="${size}" height="${size}" src="data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}"></body></html>`
  const page = join(work, `render-${size}.html`)
  writeFileSync(page, html)
  await win.loadFile(page)
  await win.webContents.executeJavaScript('document.images[0].decode()')
  await new Promise((r) => setTimeout(r, 150))
  let image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })
  if (image.getSize().width !== size) image = image.resize({ width: size, height: size, quality: 'best' })
  win.destroy()
  return image.toPNG()
}

/** A .ico of PNG images (Windows Vista and later). */
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length)
  head.writeUInt16LE(0, 0)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(images.length, 4)
  let offset = head.length
  images.forEach(({ size, png }, i) => {
    const at = 6 + 16 * i
    head.writeUInt8(size >= 256 ? 0 : size, at)
    head.writeUInt8(size >= 256 ? 0 : size, at + 1)
    head.writeUInt16LE(1, at + 4)
    head.writeUInt16LE(32, at + 6)
    head.writeUInt32LE(png.length, at + 8)
    head.writeUInt32LE(offset, at + 12)
    offset += png.length
  })
  return Buffer.concat([head, ...images.map((x) => x.png)])
}

app.whenReady().then(async () => {
  const iconset = join(work, 'icon.iconset')
  execFileSync('mkdir', [iconset])
  for (const size of [16, 32, 128, 256, 512]) {
    writeFileSync(join(iconset, `icon_${size}x${size}.png`), await render(svg, size))
    writeFileSync(join(iconset, `icon_${size}x${size}@2x.png`), await render(svg, size * 2))
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(build, 'icon.icns')])

  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const images = []
  for (const size of sizes) images.push({ size, png: await render(cropped, size) })
  writeFileSync(join(build, 'icon.ico'), ico(images))
  writeFileSync(join(build, 'icon.png'), await render(cropped, 1024))
  console.log('Wrote build/icon.icns, build/icon.ico and build/icon.png')
  app.quit()
}).catch((e) => {
  console.error(e)
  app.exit(1)
})
