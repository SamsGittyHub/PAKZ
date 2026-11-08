import { Suspense, type ReactNode } from "react";
import { requireAdmin } from "@/lib/auth";
import { logout } from "@/app/login/actions";
import { Sidebar, SidebarSkeleton } from "@/components/admin/Sidebar";

export const metadata = { title: { absolute: "PAKZ Admin", template: "%s · PAKZ Admin" }, robots: { index: false, follow: false } };

async function AdminSidebar() {
  const admin = await requireAdmin();
  return <Sidebar role={admin.role} email={admin.email} logout={logout} />;
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-[var(--page)] lg:flex">
      <Suspense fallback={<SidebarSkeleton />}>
        <AdminSidebar />
      </Suspense>
      <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
