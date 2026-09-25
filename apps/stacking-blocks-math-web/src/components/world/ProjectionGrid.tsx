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
  /**
   * "옆" 자료 전용. shared/blocks.ts의 project()는 side[y][depth-1-z]로
   * 저장한다 -- 이 배열을 그대로 화면에 그리면 실제 오른쪽(+x)에서 바라본
   * 모습이 아니라 좌우가 뒤집힌(뒤->앞이 아니라 앞->뒤 방향) 그림이 된다.
   * (shared/problems/contracts/display.ts의 기존 projectionToDisplayGrid
   * 주석: "Stored side columns run back-to-front; the actual +X observer
   * sees front-to-back.") 그 보정을 저장된 배열이나 채점 로직은 그대로 둔
   * 채 이 공통 컴포넌트의 표시/입력 레이어에서만 적용한다 -- 화면에 열
   * 순서를 뒤집어 보여주고, 클릭/증감 입력도 같은 매핑으로 되돌려 저장하므로
   * 채점에 쓰이는 실제 데이터 형식과 좌표계는 전혀 바뀌지 않는다.
   */
  mirrorColumns?: boolean;
}

export function ProjectionGrid({ title, rows, editable, onChange, valueType, reverseRows = false, orientation, mirrorColumns = false }: ProjectionGridProps) {
  const rowCount = rows.length;
  const colCount = rows[0]?.length ?? 0;
  const dataCol = (displayCol: number) => (mirrorColumns ? colCount - 1 - displayCol : displayCol);

  const handleToggle = (r: number, displayCol: number) => {
    if (!editable) return;
    const c = dataCol(displayCol);
    const next = (rows as Grid2D).map((row) => [...row]);
    next[r][c] = !next[r][c];
    onChange(next);
  };

  /** 숫자 칸은 tap-to-+1만 있으면 목표를 지나쳤을 때 되돌릴 방법이 없다. 증가/감소를 모두 눈에 보이는 버튼으로 제공한다. */
  const stepNumber = (r: number, displayCol: number, delta: 1 | -1) => {
    if (!editable) return;
    const c = dataCol(displayCol);
    const value = Number((rows[r] as number[])[c] ?? 0);
    const next = (rows as HeightMap).map((row) => [...row]);
    next[r][c] = Math.max(0, Math.min(9, value + delta));
    onChange(next);
  };

  const table = <table className={`projection-table${valueType === "number" ? " projection-table-number" : ""}`} aria-label={title}>
        <tbody>
          {Array.from({ length: rowCount }, (_, i) => reverseRows || orientation === "floor" ? displayCellToMathCoord(i, 0, rowCount).row : i).map((r) => (
            <tr key={`${title}-${r}`}>
              {Array.from({ length: colCount }).map((__, displayCol) => {
                const c = dataCol(displayCol);
                if (valueType === "number") {
                  const value = Number((rows[r] as number[])[c] ?? 0);
                  return (
                    <td key={`${title}-${r}-${displayCol}`}>
                      <div className="number-cell">
                        <button
                          type="button"
                          className="number-cell-step"
                          onClick={() => stepNumber(r, displayCol, 1)}
                          aria-label={`${title} ${r + 1}행 ${displayCol + 1}열 증가`}
                          disabled={!editable || value >= 9}
                        >
                          ＋
                        </button>
                        <span className="number-cell-value" aria-live="polite">{value}</span>
                        <button
                          type="button"
                          className="number-cell-step"
                          onClick={() => stepNumber(r, displayCol, -1)}
                          aria-label={`${title} ${r + 1}행 ${displayCol + 1}열 감소`}
                          disabled={!editable || value <= 0}
                        >
                          －
                        </button>
                      </div>
                    </td>
                  );
                }
                const value = Boolean((rows[r] as boolean[])[c]);
                return (
                  <td key={`${title}-${r}-${displayCol}`}>
                    <button
                      className={`cell-btn${value ? " cell-filled" : ""}`}
                      type="button"
                      onClick={() => handleToggle(r, displayCol)}
                      aria-label={`${title} ${r + 1}행 ${displayCol + 1}열`}
                      aria-pressed={value}
                      disabled={!editable}
                    >
                      {value ? "●" : ""}
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
