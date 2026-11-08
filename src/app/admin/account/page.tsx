import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { PageHeader, PageSkeleton, Section } from "@/components/admin/PageHeader";
import { ChangePasswordForm } from "../settings/SettingsForms";

export default function AccountPage() {
  return <Suspense fallback={<PageSkeleton />}><Account /></Suspense>;
}

async function Account() {
  const admin = await requireAdmin();
  return (
    <>
      <PageHeader title="My account" description={`${admin.email} · ${admin.role}`} />
      <Section title="Change my password"><ChangePasswordForm /></Section>
    </>
  );
}
