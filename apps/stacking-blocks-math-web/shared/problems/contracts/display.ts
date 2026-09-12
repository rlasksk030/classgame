/** All grids retain canonical math coordinates. Display row 0 is the far/top row. */
export function mathGridToDisplayGrid<T>(rows: T[][]): T[][] { return rows.map(row => [...row]).reverse(); }
export function displayCellToMathCoord(row: number, col: number, rowCount: number) {
 if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= rowCount || col < 0) throw new RangeError('Invalid display cell');
 return { row: rowCount - 1 - row, col };
}
export function mathCellToDisplayCoord(row: number, col: number, rowCount: number) { return displayCellToMathCoord(row,col,rowCount); }

/** Stored side columns run back-to-front; the actual +X observer sees front-to-back.
 * Keep legacy coordinates/grades intact and transform only redesign presentation/input.
 */
export function projectionToDisplayGrid<T>(rows:T[][],face?:'top'|'front'|'side'):T[][] {
 const display=mathGridToDisplayGrid(rows);
 return face==='side'?display.map(row=>row.reverse()):display;
}
export function projectionDisplayCellToMathCoord(row:number,col:number,rows:number,cols:number,face?:'top'|'front'|'side') {
 const p=displayCellToMathCoord(row,col,rows);
 return {...p,col:face==='side'?cols-1-col:col};
}
