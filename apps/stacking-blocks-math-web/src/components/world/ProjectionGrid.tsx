import type { Grid2D, HeightMap } from "@shared/types.ts";

interface ProjectionGridProps {
  title: string;
  rows: Grid2D | HeightMap;
  editable: boolean;
  onChange: (next: Grid2D | HeightMap) => void;
  valueType: "boolean" | "number";
  reverseRows?: boolean;
}

export function ProjectionGrid({ title, rows, editable, onChange, valueType, reverseRows = false }: ProjectionGridProps) {
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

  return (
    <div className="projection-area">
      <p className="muted">{title}</p>
      <table className="projection-table" aria-label={title}>
        <tbody>
          {Array.from({ length: rowCount }, (_, i) => reverseRows ? rowCount - 1 - i : i).map((r) => (
            <tr key={`${title}-${r}`}>
              {Array.from({ length: colCount }).map((__, c) => {
                const value = valueType === "number" ? Number((rows[r] as number[])[c] ?? 0) : Boolean((rows[r] as boolean[])[c]);
                return (
                  <td key={`${title}-${r}-${c}`}>
                    <button
                      className="cell-btn"
                      type="button"
                      onClick={() => handleToggle(r, c)}
                      aria-label={`${title} ${r + 1}행 ${c + 1}열`}
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
      </table>
    </div>
  );
}
