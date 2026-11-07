"use client";
import { useRef, useState, useTransition } from "react";
import Papa from "papaparse";
import { Upload } from "lucide-react";
import { Modal, useNotice } from "@/components/admin/Toast";
import { importProducts } from "./actions";

const TEMPLATE = "title,brand,category,description,status,size,condition,price,cost,quantity,sku,tags,source\nNike Dunk Low Panda,Nike,Sneakers,,active,UK 9,new,150,95,1,DD1391-100-9,dunk;panda,resale\n";

export function ImportButton() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ products: number; variants: number; errors: string[] } | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLInputElement>(null);
  const { notice, error } = useNotice();

  const onFile = (file: File) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => start(async () => {
        const r = await importProducts(res.data);
        if (r.ok) setResult(r.data!); else error(r.error);
      }),
      error: (e) => error(e.message),
    });
  };

  return (
    <>
      <button className="btn" onClick={() => { setResult(null); setOpen(true); }}><Upload size={14} /> Import</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Import products from CSV">
        <p className="muted text-sm">One row per variant. Rows with the same title + brand become one listing with multiple variants. Quantity &gt; 0 is received as stock at the given cost.</p>
        <a className="btn btn-sm mt-3" download="pakz-products-template.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}>Download template</a>
        <input ref={ref} type="file" accept=".csv,text/csv" className="mt-3 block w-full text-sm" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} disabled={pending} />
        {pending && <p className="faint mt-2 text-sm">Importing…</p>}
        {result && (
          <div className="mt-3 text-sm">
            <p>Imported <b>{result.products}</b> listings ({result.variants} variants).</p>
            {result.errors.length > 0 && (
              <ul className="mt-2 max-h-40 list-disc overflow-y-auto pl-5 text-[var(--critical)]">{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            )}
          </div>
        )}
      </Modal>
      {notice}
    </>
  );
}
