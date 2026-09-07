import { useCallback, useMemo, useRef, useState } from "react";
import type { TableProps } from "antd";

const DEFAULT_COLUMN_WIDTH = 200;
const MIN_COLUMN_WIDTH = 80;

type HeaderCellProps = React.ThHTMLAttributes<HTMLTableCellElement> & {
  onResize?: (event: React.MouseEvent) => void;
};

function HeaderCell({ onResize, children, style, ...rest }: HeaderCellProps) {
  if (!onResize) {
    return (
      <th {...rest} style={style}>
        {children}
      </th>
    );
  }
  return (
    <th {...rest} style={{ ...style, position: "relative" }}>
      {children}
      <span
        onMouseDown={onResize}
        onClick={(e) => e.stopPropagation()}
        className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize select-none"
      />
    </th>
  );
}

interface Options {
  fixedKeys?: string[];
  defaultWidth?: number;
  minWidth?: number;
}

export function useResizableColumns<T extends object>(
  columns: TableProps<T>["columns"],
  { fixedKeys = [], defaultWidth = DEFAULT_COLUMN_WIDTH, minWidth = MIN_COLUMN_WIDTH }: Options = {},
) {
  const [widths, setWidths] = useState<Record<string, number>>({});
  const dragRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);

  const startResize = useCallback(
    (key: string, startWidth: number) => (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      dragRef.current = { key, startX: event.clientX, startWidth };
      const onMove = (moveEvent: MouseEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        const next = Math.max(
          minWidth,
          drag.startWidth + moveEvent.clientX - drag.startX,
        );
        setWidths((prev) =>
          prev[drag.key] === next ? prev : { ...prev, [drag.key]: next },
        );
      };
      const onUp = () => {
        dragRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [minWidth],
  );

  const resizableColumns = useMemo(
    () =>
      (columns ?? []).map((column, index) => {
        const key = String(
          column.key ??
            ("dataIndex" in column && typeof column.dataIndex === "string"
              ? column.dataIndex
              : `col-${index}`),
        );
        if (!key || fixedKeys.includes(key)) return column;
        const baseWidth =
          typeof column.width === "number" ? column.width : defaultWidth;
        const width = widths[key] ?? baseWidth;
        return {
          ...column,
          width,
          onHeaderCell: () => ({ width, onResize: startResize(key, width) }),
        } as typeof column;
      }),
    [columns, widths, fixedKeys, defaultWidth, startResize],
  );

  const components = useMemo<TableProps<T>["components"]>(
    () => ({ header: { cell: HeaderCell as never } }),
    [],
  );

  return { columns: resizableColumns, components };
}
