import type { ReactNode } from "react";

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="muted mt-0.5 text-sm">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, actions, children, className = "" }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card card-pad ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="faint py-6 text-center text-sm">{children}</p>;
}

export function PageSkeleton() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-48 rounded bg-[var(--surface-2)]" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => <div key={i} className="card h-24" />)}
      </div>
      <div className="card h-72" />
    </div>
  );
}

export function OwnerOnly({ children }: { children: ReactNode }) {
  return <div className="card card-pad faint text-sm">{children ?? "Owner access only."}</div>;
}
