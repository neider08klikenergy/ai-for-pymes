import { redirect } from "next/navigation";

// No hay registro público: el super admin lo crea scripts/seed-admin.mjs (Admin
// API) y las demás cuentas las crea el equipo desde el panel. Antes, esta página
// registraba a la primera persona que llegara como super admin, y entre el
// primer deploy y seed-admin cualquiera podía tomar la agencia.
export default function SignupPage() {
  redirect("/demo");
}
