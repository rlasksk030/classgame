/** All grids retain canonical math coordinates. Display row 0 is the far/top row. */
export function mathGridToDisplayGrid<T>(rows: T[][]): T[][] { return rows.map(row => [...row]).reverse(); }
export function displayCellToMathCoord(row: number, col: number, rowCount: number) {
 if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= rowCount || col < 0) throw new RangeError('Invalid display cell');
 return { row: rowCount - 1 - row, col };
}
export function mathCellToDisplayCoord(row: number, col: number, rowCount: number) { return displayCellToMathCoord(row,col,rowCount); }
