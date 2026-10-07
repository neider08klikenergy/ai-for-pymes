import { APP_DESCRIPTION, APP_NAME } from "@/lib/branding";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="text-center space-y-1">
        <p className="font-display text-3xl font-semibold tracking-tight text-primary">
          {APP_NAME}
        </p>
        <p className="text-sm text-muted-foreground max-w-sm">{APP_DESCRIPTION}</p>
      </div>
      {children}
    </div>
  );
}
