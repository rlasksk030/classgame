import { displayCellToMathCoord } from "../../../shared/problems/contracts/display.ts";
import type { Grid2D, HeightMap } from "@shared/types.ts";

interface ProjectionGridProps {
  title: string;
  rows: Grid2D | HeightMap;
  editable: boolean;
  onChange: (next: Grid2D | HeightMap) => void;
  valueType: "boolean" | "number";
  reverseRows?: boolean;
  /** 바닥을 내려다보는 지도에만 관찰자 기준을 표시한다. 실루엣에는 화살표를 복사하지 않는다. */
  orientation?: "floor";
}

export function ProjectionGrid({ title, rows, editable, onChange, valueType, reverseRows = false, orientation }: ProjectionGridProps) {
  const rowCount = rows.length;
  const colCount = rows[0]?.length ?? 0;

  const handleToggle = (r: number, c: number) => {
    if (!editable) return;

    if (valueType === "number") {
      const value = Number((rows[r] as number[])[c]);
      const next = (rows as HeightMap).map((row) => [...row]);
      next[r][c] = (value + 1) % 10;
      onChange(next);
      return;
    }

    const next = (rows as Grid2D).map((row) => [...row]);
    next[r][c] = !next[r][c];
    onChange(next);
  };

  const table = <table className="projection-table" aria-label={title}>
        <tbody>
          {Array.from({ length: rowCount }, (_, i) => reverseRows || orientation === "floor" ? displayCellToMathCoord(i, 0, rowCount).row : i).map((r) => (
            <tr key={`${title}-${r}`}>
              {Array.from({ length: colCount }).map((__, c) => {
                const value = valueType === "number" ? Number((rows[r] as number[])[c] ?? 0) : Boolean((rows[r] as boolean[])[c]);
                return (
                  <td key={`${title}-${r}-${c}`}>
                    <button
                      className={`cell-btn${value ? " cell-filled" : ""}`}
                      type="button"
                      onClick={() => handleToggle(r, c)}
                      aria-label={`${title} ${r + 1}행 ${c + 1}열`}
                      aria-pressed={valueType === "boolean" ? Boolean(value) : undefined}
                      disabled={!editable}
                    >
                      {valueType === "number" ? value : value ? "●" : ""}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>;

  return (
    <div className="projection-area">
      <p className="muted">{title}</p>
      {orientation === "floor" ? (
        <div className="projection-frame" aria-label="바닥 지도 관찰 기준">
          {table}
          <span className="projection-label projection-label-front">앞</span>
          <span className="projection-label projection-label-side">옆</span>
        </div>
      ) : table}
    </div>
  );
}
