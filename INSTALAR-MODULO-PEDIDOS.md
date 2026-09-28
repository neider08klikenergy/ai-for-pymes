# Módulo de pedidos · cómo instalarlo en tu fork

> AI for PYMES · primer vertical: pastelería (Golosita). Probado: SQL en Postgres 16 (cotizar, cupo, 48 h, horarios, duplicados, comprobantes, confirmación y aislamiento entre workspaces), `tsc --noEmit` y ESLint sin errores, y las 96 pruebas de herramientas del repo en verde.

## Qué trae

| Archivo | Qué es |
|---|---|
| `supabase/migrations/20261001000000_modulo_pedidos.sql` | Tablas `sedes`, `reglas_negocio`, `precios`, `pedidos`, `pagos_pedido` + funciones `pd_*` + seguridad + catálogo de herramientas |
| `supabase/seed/golosita_seed.sql` | Datos de Golosita: 3 sedes, reglas y 149 precios (por validar) |
| `src/features/tools/tools/pedidos/*.ts` | Herramientas `cotizar_producto`, `consultar_cupo`, `registrar_pedido`, `registrar_comprobante` |
| `src/features/tools/index.ts` | Registro de las 4 herramientas (reemplaza el del repo) |
| `docs/golosita/prompt-agente.md` | Instrucciones del agente (reglas de Mónica) |
| `docs/golosita/conocimiento-golosita.md` | Base de conocimiento (horarios, políticas, sabores, pagos) |

## Pasos (PowerShell, dentro de tu carpeta `ai-for-pymes`)

1. **Copia los archivos** a tu fork, respetando las carpetas (si descomprimes el zip en la raíz del proyecto, quedan en su lugar).

2. **Revisa que compile:**
   ```powershell
   npm run typecheck
   npm run lint
   ```

3. **Aplica la migración a Supabase:**
   ```powershell
   supabase db push
   ```
   Debe listar solo `20261001000000_modulo_pedidos.sql`. Responde **Y**.

4. **Despliega:**
   ```powershell
   vercel --prod
   ```

5. **Crea el workspace "Golosita"** en el panel de agencia (si no existe) y conéctale WhatsApp (por ahora el mismo sandbox de Kapso).

6. **Carga los datos de Golosita:** Supabase → **SQL Editor** → pega `supabase/seed/golosita_seed.sql` → **Run**. Debe decir `Golosita cargada en workspace …`.

7. **Configura el workspace Golosita en el panel:**
   - **Negocio** → zona horaria **America/Bogota** (importante para fechas y horarios).
   - **Tools** → activa `cotizar_producto`, `consultar_cupo`, `registrar_pedido`, `registrar_comprobante`.
   - **Agentes** → pega `docs/golosita/prompt-agente.md` en las instrucciones.
   - **Knowledge Base** → sube `docs/golosita/conocimiento-golosita.md`.
   - **Integraciones** → tiempo de espera del buffer **20–30 s**.

8. **Prueba** desde tu WhatsApp (sandbox):
   - "¿A qué hora abre Buque el domingo?"
   - "¿Cuánto vale un Red Velvet de media libra?"
   - "Quiero un ChocoBerry de 1/2 lb para mañana" → debe decir que requiere 48 h.
   - Pedido completo para dentro de 3 días en Caudal → debe dar número `GOL-000xx`, total, anticipo y saldo.
   - Envía una foto de un comprobante → debe quedar "por verificar".
   - Revisa en Supabase: `select numero, estado, total, anticipo_requerido from pedidos order by created_at desc;`

## Pendientes conocidos

- `datos_pago` (cuenta para el anticipo): cuando Mónica los envíe, descomenta la línea en el seed y vuelve a correrlo.
- Precios con `validado = false` hasta que Golosita apruebe el tarifario.
- Cupo diario provisional: Caudal 30, Buque 5, Amarilo 3.
- Pantalla "Pedidos / Pagos por verificar" en el panel: siguiente paso. Mientras tanto, confirmar un pago con SQL:
  ```sql
  select pd_confirmar_pago('<id del pago>');   -- id en: select * from pagos_pedido where estado = 'por_verificar';
  ```
