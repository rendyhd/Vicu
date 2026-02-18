#!/usr/bin/env node
/**
 * Run this script to generate placeholder PNG icons for the browser extension.
 * Usage: node generate-icons.js
 *
 * Creates icon16.png, icon48.png, and icon128.png as solid blue (#6b8ef5) squares.
 * Replace these with proper Vicu branding icons before distribution.
 */
'use strict'

const fs = require('fs')
const zlib = require('zlib')
const path = require('path')

function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([len, typeAndData, crc])
}

function makePng(size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  const rowBytes = 1 + size * 4
  const raw = Buffer.alloc(size * rowBytes)
  for (let y = 0; y < size; y++) {
    const offset = y * rowBytes
    raw[offset] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const px = offset + 1 + x * 4
      raw[px] = 0x6b // R
      raw[px + 1] = 0x8e // G
      raw[px + 2] = 0xf5 // B
      raw[px + 3] = 0xff // A
    }
  }

  const compressed = zlib.deflateSync(raw)

  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0))
  ])
}

const dir = __dirname

for (const size of [16, 48, 128]) {
  const png = makePng(size)
  const filePath = path.join(dir, `icon${size}.png`)
  fs.writeFileSync(filePath, png)
  console.log(`icon${size}.png: ${png.length} bytes (${size}x${size})`)
}

console.log('Done! Replace these placeholder icons with proper Vicu branding.')
