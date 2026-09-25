import type { BlockCoord, Grid2D, HeightMap } from './types.ts';

export interface ExportLayer { level: number; cells: Grid2D; note: string; }
export interface ArchitectureExportSnapshot { projectId: string; projectVersion: number; title: string; studentName: string; blocks: BlockCoord[]; top: Grid2D; front: Grid2D; side: Grid2D; heightMap: HeightMap; layers: ExportLayer[]; description: string; reason: string; }

function escapeXml(value: unknown): string { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }
function sameGrid(a: Grid2D, b: Grid2D): boolean { return JSON.stringify(a) === JSON.stringify(b); }

/** Groups only consecutive layers that have both identical shape and identical notes. */
export function summarizeExportLayers(layers: ExportLayer[]): Array<{ label: string; cells: Grid2D; note: string }> {
  const result: Array<{ label: string; cells: Grid2D; note: string }> = [];
  for (const layer of layers) {
    const previous = result[result.length - 1];
    const previousLevel = previous ? Number(previous.label.match(/\d+/)?.[0] ?? 0) : -1;
    if (previous && previous.note === layer.note && sameGrid(previous.cells, layer.cells) && previous.label === `${previousLevel}층`) previous.label = `${previousLevel}~${layer.level}층`;
    else result.push({ label: `${layer.level}층`, cells: layer.cells, note: layer.note });
  }
  return result;
}

function text(x: number, y: number, value: string, size = 18, weight = '400'): string { return `<text x="${x}" y="${y}" font-family="system-ui,-apple-system,'Apple SD Gothic Neo','Noto Sans KR',sans-serif" font-size="${size}px" font-weight="${weight}" fill="#293947">${escapeXml(value)}</text>`; }
function gridSvg(grid: Grid2D, x: number, y: number, cell = 18): string {
  const rows = grid.length; const cols = grid[0]?.length ?? 0; let out = `<g transform="translate(${x} ${y})">`;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out += `<rect x="${c * cell}" y="${r * cell}" width="${cell}" height="${cell}" fill="${grid[r][c] ? '#a9c4df' : '#fff'}" stroke="#71869b" stroke-width="1"/>`;
  return `${out}</g>`;
}
function isoSvg(blocks: BlockCoord[], x: number, y: number): string {
  const size = 16; const ox = x; const oy = y; let out = '<g stroke="#66788a" stroke-width="1">';
  for (const block of [...blocks].sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x)) {
    const cx = ox + (block.x - block.z) * size * 0.9; const cy = oy + (block.x + block.z) * size * 0.45 - block.y * size * 0.8;
    out += `<polygon points="${cx},${cy} ${cx + size},${cy - size * .5} ${cx + size * 2},${cy} ${cx + size},${cy + size * .5}" fill="#e8d2ad"/><polygon points="${cx},${cy} ${cx + size},${cy + size * .5} ${cx + size},${cy + size * 1.5} ${cx},${cy + size}" fill="#cda979"/><polygon points="${cx + size * 2},${cy} ${cx + size},${cy + size * .5} ${cx + size},${cy + size * 1.5} ${cx + size * 2},${cy + size}" fill="#b98f5e"/>`;
  }
  return `${out}</g>`;
}

export function buildBrochureSvg(snapshot: ArchitectureExportSnapshot): string {
  const grouped = summarizeExportLayers(snapshot.layers); const width = 794; const height = 1123;
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#f6f8fa"/>`;
  out += text(40, 54, snapshot.title || '나만의 건축물', 30, '700'); out += text(40, 82, `학생 ${snapshot.studentName || '이름 없음'} · 작품 ${snapshot.projectId} · 버전 ${snapshot.projectVersion}`, 13);
  out += '<rect x="32" y="104" width="730" height="280" rx="14" fill="#fff" stroke="#d1dce6"/>'; out += text(52, 136, '대표 3D 모습', 18, '700'); out += isoSvg(snapshot.blocks, 350, 270);
  // snapshot.side is stored back-to-front (shared/blocks.ts project()); mirror columns
  // here only, so the SVG shows the real +X/right-side view without touching the
  // stored grading coordinates -- same fix as ProjectionGrid's mirrorColumns.
  out += text(40, 422, '관찰 방향', 18, '700'); out += text(80, 452, '위', 14, '700'); out += gridSvg(snapshot.top, 60, 466, 16); out += text(310, 452, '앞', 14, '700'); out += gridSvg(snapshot.front, 290, 466, 16); out += text(540, 452, '옆(오른쪽)', 14, '700'); out += gridSvg(snapshot.side.map(row => [...row].reverse()), 520, 466, 16);
  out += '<rect x="32" y="690" width="730" height="390" rx="14" fill="#fff" stroke="#d1dce6"/>'; out += text(52, 724, '층별 모습과 공간 설명', 18, '700'); let y = 754;
  for (const layer of grouped.slice(0, 8)) { out += text(52, y + 16, layer.label, 14, '700'); out += gridSvg(layer.cells, 120, y, 11); out += text(420, y + 16, layer.note || '공간 설명 없음', 13); y += 38; }
  if (grouped.length > 8) out += text(52, 1050, `전체 ${snapshot.layers.length}층 · 대표 층 ${grouped.slice(0, 8).map(layer => layer.label).join(', ')}`, 12);
  out += text(52, 620, snapshot.reason || '설계 이유를 기록하지 않았어요.', 14); out += text(52, 648, snapshot.description || '건축물 설명을 기록하지 않았어요.', 14); out += '</svg>'; return out;
}

export function svgDataUrl(svg: string): string { return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; }

/** Creates a minimal single-page PDF containing a browser-rendered JPEG snapshot. */
export function pdfFromJpeg(jpegData: Uint8Array, width: number, height: number): Uint8Array {
  const encoder = new TextEncoder(); const chunks: Uint8Array[] = []; const offsets: number[] = [0]; let length = 0;
  const push = (value: string | Uint8Array) => { const bytes = typeof value === 'string' ? encoder.encode(value) : value; chunks.push(bytes); length += bytes.length; };
  push('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');
  const object = (id: number, body: string | Uint8Array) => { offsets[id] = length; push(`${id} 0 obj\n`); push(body); push('\nendobj\n'); };
  object(1, '<< /Type /Catalog /Pages 2 0 R >>'); object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'); object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
  offsets[4] = length; push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegData.length} >>\nstream\n`); push(jpegData); push('\nendstream\nendobj\n');
  const content = `q\n595 0 0 842 0 0 cm\n/Im0 Do\nQ\n`; object(5, `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`);
  const xref = length; push(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  const output = new Uint8Array(length); let cursor = 0; for (const chunk of chunks) { output.set(chunk, cursor); cursor += chunk.length; } return output;
}
