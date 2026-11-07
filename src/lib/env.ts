import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const env = {
  get supabaseUrl() { return required("NEXT_PUBLIC_SUPABASE_URL"); },
  get supabaseAnonKey() { return required("NEXT_PUBLIC_SUPABASE_ANON_KEY"); },
  get supabaseServiceKey() { return required("SUPABASE_SERVICE_ROLE_KEY"); },
  get siteUrl() { return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"; },
  get cronSecret() { return required("CRON_SECRET"); },
  stripeSecret: () => process.env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: () => process.env.STRIPE_WEBHOOK_SECRET,
  resendKey: () => process.env.RESEND_API_KEY,
  emailFrom: () => process.env.EMAIL_FROM,
  anthropicKey: () => process.env.ANTHROPIC_API_KEY,
};

/** Which integrations are configured — shown on the settings page without exposing secrets. */
export function integrationStatus() {
  return {
    supabase: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    stripe: Boolean(process.env.STRIPE_SECRET_KEY),
    stripeWebhook: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    stripeMode: process.env.STRIPE_SECRET_KEY?.startsWith("sk_live") ? "live" : "test",
    email: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    cron: Boolean(process.env.CRON_SECRET),
  };
}
