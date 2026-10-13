// Enlace de un solo uso de los correos de invitación (y de recuperación, si la
// plantilla de Supabase apunta aquí con {{ .TokenHash }}): verifica el token en
// el servidor, deja la sesión en cookies y lleva a elegir la contraseña.

import { createClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";

const TIPOS = ["invite", "recovery"] as const;
type Tipo = (typeof TIPOS)[number];

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as Tipo | null;
  const destino = url.clone();
  destino.search = "";

  if (tokenHash && type && TIPOS.includes(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      destino.pathname = "/reset-password";
      return NextResponse.redirect(destino);
    }
  }

  destino.pathname = "/login";
  destino.searchParams.set("message", "enlaceVencido");
  return NextResponse.redirect(destino);
}
