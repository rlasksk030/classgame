import { buildBrochureSvg, pdfFromJpeg, svgDataUrl, type ArchitectureExportSnapshot } from '../../shared/phase4Export.ts';

export { buildBrochureSvg, pdfFromJpeg, svgDataUrl };
export type { ArchitectureExportSnapshot };

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportBrochureImage(snapshot: ArchitectureExportSnapshot, filename = '건축물-소개서.png'): Promise<void> {
  const svg = buildBrochureSvg(snapshot); const image = new Image(); image.decoding = 'async'; image.src = svgDataUrl(svg); await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = 794; canvas.height = 1123; const context = canvas.getContext('2d');
  if (!context) throw new Error('EXPORT_CANVAS_UNAVAILABLE'); context.fillStyle = '#f6f8fa'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png')); if (!blob || blob.size === 0) throw new Error('EXPORT_IMAGE_EMPTY'); download(blob, filename);
}

export async function exportBrochurePdf(snapshot: ArchitectureExportSnapshot, filename = '건축물-소개서.pdf'): Promise<void> {
  const svg = buildBrochureSvg(snapshot); const image = new Image(); image.decoding = 'async'; image.src = svgDataUrl(svg); await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = 794; canvas.height = 1123; const context = canvas.getContext('2d');
  if (!context) throw new Error('EXPORT_CANVAS_UNAVAILABLE'); context.fillStyle = '#f6f8fa'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0);
  const jpeg = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92)); if (!jpeg || jpeg.size === 0) throw new Error('EXPORT_IMAGE_EMPTY');
  const pdf = pdfFromJpeg(new Uint8Array(await jpeg.arrayBuffer()), canvas.width, canvas.height); const bytes = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer; download(new Blob([bytes], { type: 'application/pdf' }), filename);
}
