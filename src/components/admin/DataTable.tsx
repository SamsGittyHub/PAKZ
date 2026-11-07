"use client";
/**
 * Generic table driven by serialisable column specs, so Server Components can declare tables.
 * Sorting, search, pagination, CSV export, and optional row selection for bulk actions.
 */
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import {
  flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable,
  type ColumnDef, type RowSelectionState, type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { fmt } from "@/lib/format";
import { CsvButton } from "./CsvButton";

export type ColType = "text" | "money" | "money2" | "num" | "pct" | "date" | "datetime" | "badge" | "image" | "bool" | "label";

export interface ColSpec {
  key: string;
  header: string;
  type?: ColType;
  /** link template, e.g. "/admin/products/{id}" */
  href?: string;
  /** hide on small screens */
  hideMobile?: boolean;
  /** extra muted line under the cell, from another key */
  sub?: string;
  /** highlight when value <= this number (e.g. low stock) */
  warnAtOrBelow?: string | number;
  sortable?: boolean;
}

type Row = Record<string, unknown>;

const fill = (tpl: string, row: Row) => tpl.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(String(row[k] ?? "")));

function renderValue(type: ColType | undefined, v: unknown): ReactNode {
  if (v == null || v === "") return <span className="faint">—</span>;
  switch (type) {
    case "money": return fmt.money(v as number);
    case "money2": return fmt.money2(v as number);
    case "num": return fmt.num(v as number);
    case "pct": return fmt.pct(v as number);
    case "date": return fmt.date(v as string);
    case "datetime": return fmt.dateTime(v as string);
    case "bool": return v ? "Yes" : "No";
    case "label": return fmt.label(String(v));
    case "badge": return <span className="badge">{fmt.label(String(v))}</span>;
    case "image":
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={String(v)} alt="" className="h-10 w-10 rounded-md object-cover" loading="lazy" />;
    default: return String(v);
  }
}

const NUMERIC: ColType[] = ["money", "money2", "num", "pct"];

export function DataTable({
  data, columns, filename = "export", searchable = true, pageSize = 25, selectable = false,
  toolbar, empty = "Nothing here yet.", initialSort, rowKey = "id", rowActions,
}: {
  data: object[];
  columns: ColSpec[];
  filename?: string;
  searchable?: boolean;
  pageSize?: number;
  selectable?: boolean;
  /** rendered above the table when rows are selected (client wrappers only) */
  toolbar?: (selectedIds: string[], clear: () => void) => ReactNode;
  empty?: string;
  initialSort?: { key: string; desc?: boolean };
  rowKey?: string;
  /** per-row buttons (client wrappers only) */
  rowActions?: (row: Row) => ReactNode;
}) {
  const [sorting, setSorting] = useState<SortingState>(initialSort ? [{ id: initialSort.key, desc: initialSort.desc ?? true }] : []);
  const [filter, setFilter] = useState("");
  const [selection, setSelection] = useState<RowSelectionState>({});

  const defs = useMemo<ColumnDef<Row>[]>(() => {
    const cols: ColumnDef<Row>[] = columns.map((c) => ({
      id: c.key,
      accessorFn: (r) => r[c.key],
      header: c.header,
      enableSorting: c.sortable !== false && c.type !== "image",
      sortUndefined: "last",
      meta: c,
      cell: ({ row, getValue }) => {
        const v = getValue();
        const warn = c.warnAtOrBelow != null &&
          Number(v) <= Number(typeof c.warnAtOrBelow === "string" ? row.original[c.warnAtOrBelow] : c.warnAtOrBelow);
        let content = renderValue(c.type, v);
        if (c.href) content = <Link href={fill(c.href, row.original)} className="font-medium hover:underline" prefetch={false}>{content}</Link>;
        return (
          <div className={warn ? "font-semibold text-[var(--critical)]" : undefined}>
            {content}{warn && <span className="sr-only"> (low)</span>}
            {c.sub && row.original[c.sub] != null && <div className="faint text-xs">{String(row.original[c.sub])}</div>}
          </div>
        );
      },
    }));
    if (selectable) {
      cols.unshift({
        id: "_select",
        enableSorting: false,
        header: ({ table }) => (
          <input type="checkbox" aria-label="Select all" checked={table.getIsAllPageRowsSelected()}
            onChange={table.getToggleAllPageRowsSelectedHandler()} />
        ),
        cell: ({ row }) => (
          <input type="checkbox" aria-label="Select row" checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} />
        ),
      });
    }
    if (rowActions) {
      cols.push({ id: "_actions", enableSorting: false, header: "", cell: ({ row }) => <div className="flex justify-end gap-1">{rowActions(row.original)}</div> });
    }
    return cols;
  }, [columns, selectable, rowActions]);

  const rows = data as Row[];
  const table = useReactTable({
    data: rows,
    columns: defs,
    state: { sorting, globalFilter: filter, rowSelection: selection },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    onRowSelectionChange: setSelection,
    getRowId: (r, i) => String(r[rowKey] ?? i),
    enableRowSelection: selectable,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const selectedIds = Object.keys(selection).filter((k) => selection[k]);
  const exportCols = columns.filter((c) => c.type !== "image").map((c) => c.key);
  const visibleRows = table.getFilteredRowModel().rows.map((r) => r.original);

  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {searchable && (
          <input className="input max-w-xs" placeholder="Search…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Search table" />
        )}
        <span className="faint text-xs">{visibleRows.length} rows</span>
        <div className="ml-auto"><CsvButton rows={visibleRows} columns={exportCols} filename={filename} /></div>
      </div>
      {selectable && selectedIds.length > 0 && toolbar && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2 text-sm">
          <span className="font-medium">{selectedIds.length} selected</span>
          {toolbar(selectedIds, () => setSelection({}))}
        </div>
      )}
      <div className="-mx-4 overflow-x-auto sm:mx-0">
        <table className="table">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const spec = h.column.columnDef.meta as ColSpec | undefined;
                  const numeric = spec?.type && NUMERIC.includes(spec.type);
                  const sorted = h.column.getIsSorted();
                  return (
                    <th key={h.id} className={`${numeric ? "num" : ""} ${spec?.hideMobile ? "hidden md:table-cell" : ""}`}
                        aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}>
                      {h.column.getCanSort() ? (
                        <button className="inline-flex items-center gap-1 uppercase" onClick={h.column.getToggleSortingHandler()}>
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {sorted === "asc" ? <ArrowUp size={12} /> : sorted === "desc" ? <ArrowDown size={12} /> : <ChevronsUpDown size={12} className="opacity-40" />}
                        </button>
                      ) : flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 && (
              <tr><td colSpan={defs.length} className="faint py-8 text-center">{empty}</td></tr>
            )}
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id}>
                {row.getVisibleCells().map((cell) => {
                  const spec = cell.column.columnDef.meta as ColSpec | undefined;
                  const numeric = spec?.type && NUMERIC.includes(spec.type);
                  return (
                    <td key={cell.id} className={`${numeric ? "num" : ""} ${spec?.hideMobile ? "hidden md:table-cell" : ""}`}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.getPageCount() > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <span className="faint tnum">Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}</span>
          <button className="btn btn-sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>Prev</button>
          <button className="btn btn-sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>Next</button>
        </div>
      )}
    </div>
  );
}
