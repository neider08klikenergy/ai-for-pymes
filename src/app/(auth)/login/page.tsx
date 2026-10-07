import type { Metadata } from "next";
import { LoginForm } from "@/features/auth/components/login-form";
import { isSignupOpen } from "@/features/auth/services/signup-gate";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Iniciar sesión",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { message } = await searchParams;
  return <LoginForm message={message} signupOpen={await isSignupOpen()} />;
}
