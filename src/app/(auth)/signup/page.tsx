import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { SignupForm } from "@/features/auth/components/signup-form";
import { isSignupOpen } from "@/features/auth/services/signup-gate";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("signup") };
}

export default async function SignupPage() {
  // Invite-only after bootstrap: once the admin account exists, no public signup.
  if (!(await isSignupOpen())) {
    // Las cuentas las crea el equipo de Felrick después de la demo
    redirect("/demo");
  }

  return <SignupForm />;
}
