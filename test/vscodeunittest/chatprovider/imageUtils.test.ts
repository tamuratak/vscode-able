import { strictEqual } from 'node:assert'
import { getImageDimensions } from '../../../src/chatprovider/opencodegochatprovider/tokenizer/imageUtils.js'
import { calculateImageTokenCost } from '../../../src/chatprovider/opencodegochatprovider/provideToken.js'

function toBase64(bytes: number[]): string {
    return Buffer.from(bytes).toString('base64')
}

suite('imageUtils.getImageDimensions', () => {
    test('detects PNG and reads dimensions from IHDR', () => {
        const png = [
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
            0x00, 0x00, 0x00, 0x0d, // IHDR chunk length
            0x49, 0x48, 0x44, 0x52, // 'IHDR'
            0x00, 0x00, 0x00, 0x01, // width = 1
            0x00, 0x00, 0x00, 0x02, // height = 2
            0x08, 0x06, 0x00, 0x00, 0x00, // bit depth, color type, compression, filter, interlace
            0x00, 0x00, 0x00, 0x00, // CRC (not validated)
        ]
        const { width, height } = getImageDimensions('data:image/png;base64,' + toBase64(png))
        strictEqual(width, 1)
        strictEqual(height, 2)
    })

    test('detects GIF and reads dimensions', () => {
        const gif = [
            0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // 'GIF89a'
            0x01, 0x00, // width = 1 (LE)
            0x02, 0x00, // height = 2 (LE)
            0x00, 0x00, 0x00, // packed fields, background, aspect
        ]
        const { width, height } = getImageDimensions('data:image/gif;base64,' + toBase64(gif))
        strictEqual(width, 1)
        strictEqual(height, 2)
    })

    test('detects JPEG and reads dimensions from SOF0', () => {
        const jpeg = [
            0xff, 0xd8, // SOI
            0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // APP0 'JFIF'
            0xff, 0xc0, // SOF0
            0x00, 0x11, // segment length = 17
            0x08, // precision
            0x00, 0x01, // height = 1
            0x00, 0x02, // width = 2
            0x03, // components
            0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00, // component specs
            0xff, 0xd9, // EOI
        ]
        const { width, height } = getImageDimensions('data:image/jpeg;base64,' + toBase64(jpeg))
        strictEqual(width, 2)
        strictEqual(height, 1)
    })

    test('detects WebP (VP8L) and reads dimensions', () => {
        const webp = [
            0x52, 0x49, 0x46, 0x46, // 'RIFF'
            0x0f, 0x00, 0x00, 0x00, // file size
            0x57, 0x45, 0x42, 0x50, // 'WEBP'
            0x56, 0x50, 0x38, 0x4c, // 'VP8L'
            0x05, 0x00, 0x00, 0x00, // chunk size = 5
            0x2f, // signature byte
            0x00, 0x00, 0x00, 0x00, // bits: width-1 = 0, height-1 = 0
        ]
        const { width, height } = getImageDimensions('data:image/webp;base64,' + toBase64(webp))
        strictEqual(width, 1)
        strictEqual(height, 1)
    })

    test('detects WebP (VP8X) and reads 24-bit dimensions', () => {
        // Canvas width/height minus one are 24-bit little-endian fields.
        const widthLE = [0x2b, 0x01, 0x00] // width = 300
        const heightLE = [0xc7, 0x00, 0x00] // height = 200
        const webp = [
            0x52, 0x49, 0x46, 0x46, // 'RIFF'
            0x2a, 0x00, 0x00, 0x00, // file size
            0x57, 0x45, 0x42, 0x50, // 'WEBP'
            0x56, 0x50, 0x38, 0x58, // 'VP8X'
            0x0a, 0x00, 0x00, 0x00, // chunk size = 10
            0x00, // flags
            0x00, 0x00, 0x00, // reserved
            ...widthLE,
            ...heightLE,
        ]
        const { width, height } = getImageDimensions('data:image/webp;base64,' + toBase64(webp))
        strictEqual(width, 300)
        strictEqual(height, 200)
    })

    test('falls back to full decode when JPEG SOF is beyond the 64KB prefix', () => {
        // An APP0 segment of 65535 bytes (including the length field) pushes
        // the SOF0 marker past the 64KB prefix; the full-decode fallback must
        // still find it.
        const app0Data = new Array<number>(65533).fill(0x00)
        const jpeg = [
            0xff, 0xd8, // SOI
            0xff, 0xe0, // APP0 marker
            0xff, 0xff, // APP0 length = 65535 (length field + 65533 data bytes)
            ...app0Data,
            0xff, 0xc0, // SOF0
            0x00, 0x11, // segment length = 17
            0x08, // precision
            0x00, 0x01, // height = 1
            0x00, 0x02, // width = 2
            0x03, // components
            0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00, // component specs
            0xff, 0xd9, // EOI
        ]
        const { width, height } = getImageDimensions('data:image/jpeg;base64,' + toBase64(jpeg))
        strictEqual(width, 2)
        strictEqual(height, 1)
    })

    test('estimates token cost from PNG dimensions instead of falling back', () => {
        const png = [
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
            0x00, 0x00, 0x00, 0x0d, // IHDR chunk length
            0x49, 0x48, 0x44, 0x52, // 'IHDR'
            0x00, 0x00, 0x00, 0x01, // width = 1
            0x00, 0x00, 0x00, 0x01, // height = 1
            0x08, 0x06, 0x00, 0x00, 0x00, // bit depth, color type, compression, filter, interlace
            0x00, 0x00, 0x00, 0x00, // CRC (not validated)
        ]
        // 1x1 image: 1 tile, so 85 + 170 = 255.
        const cost = calculateImageTokenCost('data:image/png;base64,' + toBase64(png))
        strictEqual(cost, 255)
    })
})
