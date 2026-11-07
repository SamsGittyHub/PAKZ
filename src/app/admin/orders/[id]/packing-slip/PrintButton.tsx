"use client";
export function PrintButton() {
  return <button className="rounded border border-black px-3 py-1 text-sm print:hidden" onClick={() => window.print()}>Print</button>;
}
