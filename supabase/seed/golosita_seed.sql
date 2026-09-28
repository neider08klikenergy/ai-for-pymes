-- ============================================================
-- Seed Golosita (workspace del fork) · AI for PYMES
-- Ejecutar en Supabase → SQL Editor DESPUÉS de:
--   1) aplicar la migración 20261001000000_modulo_pedidos.sql
--   2) crear el workspace "Golosita" en el panel de agencia
-- Idempotente: se puede correr varias veces (actualiza precios y reglas).
-- ⚠️ Precios con validado = false hasta que Mónica apruebe el tarifario.
-- ============================================================
DO $$
DECLARE
  v_ws UUID;
BEGIN
  SELECT id INTO v_ws FROM workspaces
   WHERE slug ILIKE 'golosita%' OR name ILIKE 'golosita%'
   ORDER BY created_at LIMIT 1;
  IF v_ws IS NULL THEN
    RAISE EXCEPTION 'No encontré el workspace Golosita. Créalo primero en el panel de agencia.';
  END IF;

  -- Reglas de negocio confirmadas con Mónica (sep 2026)
  INSERT INTO reglas_negocio (workspace_id, clave, valor, descripcion) VALUES
    (v_ws, 'anticipo_pct',                 '60',                'Porcentaje de anticipo por transferencia antes de agendar'),
    (v_ws, 'anticipacion_min_horas',       '48',                'Horas mínimas de anticipación para personalizados'),
    (v_ws, 'cancelacion_dias_calendario',  '3',                 'Días calendario mínimos para cancelar o mover'),
    (v_ws, 'saldo_favor_meses',            '6',                 'Vigencia del saldo a favor (no hay devolución en efectivo)'),
    (v_ws, 'saldo_pago_momento',           '"entrega"',         'El 40% restante se paga al entregar, antes de recibir el ponqué'),
    (v_ws, 'zona_horaria',                 '"America/Bogota"',  'Zona horaria del negocio'),
    (v_ws, 'prefijo_pedido',               '"GOL"',             'Prefijo del número de pedido')
    -- PENDIENTE: datos de la cuenta para el anticipo. Cuando Mónica los envíe:
    -- ,(v_ws, 'datos_pago', '"Nequi 3XX XXX XXXX a nombre de ... / Bancolombia ahorros ..."', 'Datos para transferir el anticipo')
  ON CONFLICT (workspace_id, clave) DO UPDATE SET valor = EXCLUDED.valor, descripcion = EXCLUDED.descripcion, updated_at = now();

  -- Sedes (horarios oficiales; cupo diario PROVISIONAL)
  INSERT INTO sedes (workspace_id, codigo, nombre, direccion, telefono, acepta_personalizados, horarios, cupo_diario) VALUES
    (v_ws, 'caudal', 'Golosita Caudal (Grama)', 'Calle 45 # 31-08, una cuadra arriba de la glorieta de la Grama, casa esquinera rosada, Villavicencio', '+573103208950', true, '{"lunes": ["10:00", "19:30"], "jueves": ["09:45", "19:30"], "martes": ["09:45", "19:30"], "sabado": ["09:45", "19:30"], "domingo": ["11:00", "19:00"], "festivo": ["11:00", "19:00"], "viernes": ["09:45", "19:30"], "miercoles": ["09:45", "19:30"]}', 30),
    (v_ws, 'buque', 'Golosita Buque', 'Local 1, edificio San José Plaza, después del puente nuevo de Servimédicos (Calle 26c # 43a-26), Villavicencio', '+573155119729', false, '{"lunes": ["10:40", "19:00"], "jueves": ["10:40", "19:00"], "martes": ["10:40", "19:00"], "sabado": ["10:40", "19:00"], "domingo": ["11:00", "19:00"], "festivo": ["11:00", "19:00"], "viernes": ["10:40", "19:00"], "miercoles": ["10:40", "19:00"]}', 5),
    (v_ws, 'amarilo', 'Golosita Amarilo', 'CC Rosablanca, local 246, Villavicencio', '+573103032040', false, '{"lunes": ["13:00", "20:00"], "jueves": ["12:30", "20:00"], "martes": ["13:00", "20:00"], "sabado": ["12:30", "20:00"], "domingo": ["12:30", "20:00"], "festivo": ["12:30", "20:00"], "viernes": ["12:30", "20:00"], "miercoles": ["12:30", "20:00"]}', 3)
  ON CONFLICT (workspace_id, codigo) DO UPDATE SET
    nombre = EXCLUDED.nombre, direccion = EXCLUDED.direccion, telefono = EXCLUDED.telefono,
    acepta_personalizados = EXCLUDED.acepta_personalizados, horarios = EXCLUDED.horarios,
    cupo_diario = EXCLUDED.cupo_diario;

  -- Tarifario (transcrito de ANEXO A MENU, por validar)
  INSERT INTO precios (workspace_id, linea, sabor, tamano, porciones, precio, incluye, validado) VALUES
    (v_ws, 'golotarta', 'Cualquiera', 'mini', '1', 8500, NULL, false),
    (v_ws, 'golotarta', 'Cualquiera', 'octavo', '2', 21000, NULL, false),
    (v_ws, 'golotarta', 'Cualquiera', 'cuarto', '8', 43700, NULL, false),
    (v_ws, 'golovesa', 'Chocoarequipe', 'porcion', NULL, 13500, NULL, false),
    (v_ws, 'golovesa', 'Chocoarequipe', 'personal', NULL, 58000, NULL, false),
    (v_ws, 'golovesa', 'Chocoarequipe', '1/4 lb', NULL, 98000, NULL, false),
    (v_ws, 'golovesa', 'Chocoarequipe', '1/2 lb', NULL, 150000, NULL, false),
    (v_ws, 'golovesa', 'Chocoarequipe', '1 lb', NULL, 235000, NULL, false),
    (v_ws, 'golovesa', 'Chocoberry', 'porcion', NULL, 13500, NULL, false),
    (v_ws, 'golovesa', 'Chocoberry', 'personal', NULL, 64000, NULL, false),
    (v_ws, 'golovesa', 'Chocoberry', '1/4 lb', NULL, 110000, NULL, false),
    (v_ws, 'golovesa', 'Chocoberry', '1/2 lb', NULL, 150000, NULL, false),
    (v_ws, 'golovesa', 'Chocoberry', '1 lb', NULL, 240000, NULL, false),
    (v_ws, 'golovesa', 'Frutos rojos', 'porcion', NULL, 12500, NULL, false),
    (v_ws, 'golovesa', 'Frutos rojos', 'personal', NULL, 46000, NULL, false),
    (v_ws, 'golovesa', 'Frutos rojos', '1/4 lb', NULL, 87000, NULL, false),
    (v_ws, 'golovesa', 'Frutos rojos', '1/2 lb', NULL, 140000, NULL, false),
    (v_ws, 'golovesa', 'Frutos rojos', '1 lb', NULL, 195000, NULL, false),
    (v_ws, 'golovesa', 'Merengón', 'porcion', NULL, 12500, NULL, false),
    (v_ws, 'golovesa', 'Merengón', 'personal', NULL, 46000, NULL, false),
    (v_ws, 'golovesa', 'Merengón', '1/4 lb', NULL, 87000, NULL, false),
    (v_ws, 'golovesa', 'Merengón', '1/2 lb', NULL, 140000, NULL, false),
    (v_ws, 'golovesa', 'Merengón', '1 lb', NULL, 195000, NULL, false),
    (v_ws, 'golovesa', 'Tiramisú', 'porcion', NULL, 12500, NULL, false),
    (v_ws, 'golovesa', 'Tiramisú', 'personal', NULL, 52000, NULL, false),
    (v_ws, 'golovesa', 'Tiramisú', '1/4 lb', NULL, 92000, NULL, false),
    (v_ws, 'golovesa', 'Tiramisú', '1/2 lb', NULL, 140000, NULL, false),
    (v_ws, 'golovesa', 'Tiramisú', '1 lb', NULL, 207000, NULL, false),
    (v_ws, 'golovesa', 'Tradicional', 'porcion', NULL, 11000, NULL, false),
    (v_ws, 'golovesa', 'Tradicional', 'personal', NULL, 38000, NULL, false),
    (v_ws, 'golovesa', 'Tradicional', '1/4 lb', NULL, 70000, NULL, false),
    (v_ws, 'golovesa', 'Tradicional', '1/2 lb', NULL, 110000, NULL, false),
    (v_ws, 'golovesa', 'Tradicional', '1 lb', NULL, 160000, NULL, false),
    (v_ws, 'helado', 'Brownie', 'porcion', '1', 8700, NULL, false),
    (v_ws, 'helado', 'Frutos rojos', 'porcion', '1', 7300, NULL, false),
    (v_ws, 'helado', 'Oreo', 'porcion', '1', 8700, NULL, false),
    (v_ws, 'helado', 'Vainilla', 'porcion', '1', 7300, NULL, false),
    (v_ws, 'largo', 'Amapola', '1/4 lb larga', NULL, 88900, NULL, false),
    (v_ws, 'largo', 'Amapola', '1/2 lb larga', NULL, 127000, NULL, false),
    (v_ws, 'largo', 'Amapola maracuyá', '1/4 lb larga', NULL, 98000, NULL, false),
    (v_ws, 'largo', 'Amapola maracuyá', '1/2 lb larga', NULL, 140000, NULL, false),
    (v_ws, 'largo', 'ChocoArequipe', '1/4 lb larga', NULL, 88900, NULL, false),
    (v_ws, 'largo', 'ChocoArequipe', '1/2 lb larga', NULL, 127000, NULL, false),
    (v_ws, 'largo', 'ChocoArándanos', '1/4 lb larga', NULL, 115500, NULL, false),
    (v_ws, 'largo', 'ChocoArándanos', '1/2 lb larga', NULL, 165000, NULL, false),
    (v_ws, 'largo', 'ChocoBerry', '1/4 lb larga', NULL, 98000, NULL, false),
    (v_ws, 'largo', 'ChocoBerry', '1/2 lb larga', NULL, 140000, NULL, false),
    (v_ws, 'largo', 'ChocoIntenso', '1/4 lb larga', NULL, 88900, NULL, false),
    (v_ws, 'largo', 'ChocoIntenso', '1/2 lb larga', NULL, 127000, NULL, false),
    (v_ws, 'largo', 'ChocoVainilla', '1/4 lb larga', NULL, 88900, NULL, false),
    (v_ws, 'largo', 'ChocoVainilla', '1/2 lb larga', NULL, 127000, NULL, false),
    (v_ws, 'largo', 'Milky Way', '1/4 lb larga', NULL, 122500, NULL, false),
    (v_ws, 'largo', 'Milky Way', '1/2 lb larga', NULL, 175000, NULL, false),
    (v_ws, 'largo', 'Negro de vino', '1/4 lb larga', NULL, 105000, NULL, false),
    (v_ws, 'largo', 'Negro de vino', '1/2 lb larga', NULL, 150000, NULL, false),
    (v_ws, 'largo', 'Red Velvet', '1/4 lb larga', NULL, 122500, NULL, false),
    (v_ws, 'largo', 'Red Velvet', '1/2 lb larga', NULL, 175000, NULL, false),
    (v_ws, 'largo', 'Sin azúcar', '1/4 lb larga', NULL, 88900, NULL, false),
    (v_ws, 'largo', 'Sin azúcar', '1/2 lb larga', NULL, 127000, NULL, false),
    (v_ws, 'largo', 'Tradicional', '1/4 lb larga', NULL, 88900, NULL, false),
    (v_ws, 'largo', 'Tradicional', '1/2 lb larga', NULL, 127000, NULL, false),
    (v_ws, 'largo', 'Vainilla', '1/4 lb larga', NULL, 88900, NULL, false),
    (v_ws, 'largo', 'Vainilla', '1/2 lb larga', NULL, 127000, NULL, false),
    (v_ws, 'largo', 'Vainilla arequipe', '1/4 lb larga', NULL, 108500, NULL, false),
    (v_ws, 'largo', 'Vainilla arequipe', '1/2 lb larga', NULL, 155000, NULL, false),
    (v_ws, 'largo', 'Velvet frutos rojos', '1/4 lb larga', NULL, 108500, NULL, false),
    (v_ws, 'largo', 'Velvet frutos rojos', '1/2 lb larga', NULL, 155000, NULL, false),
    (v_ws, 'largo', 'Zanahoria', '1/4 lb larga', NULL, 98000, NULL, false),
    (v_ws, 'largo', 'Zanahoria', '1/2 lb larga', NULL, 140000, NULL, false),
    (v_ws, 'ponque_personalizado', 'Amapola', 'personal', '6', 49500, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Amapola', '1/4 lb', '10-15', 92000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Amapola', '1/2 lb', '20-25', 140000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Amapola', '1 lb', '30-40', 207000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Amapola maracuyá', 'personal', '6', 49500, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Amapola maracuyá', '1/4 lb', '10-15', 92000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Amapola maracuyá', '1/2 lb', '20-25', 150000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Amapola maracuyá', '1 lb', '30-40', 225000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'ChocoArequipe', 'personal', '6', 49500, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'ChocoArequipe', '1/4 lb', '10-15', 92000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'ChocoArequipe', '1/2 lb', '20-25', 140000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'ChocoArequipe', '1 lb', '30-40', 207000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'ChocoArándanos', 'personal', '6', 58000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'ChocoArándanos', '1/4 lb', '10-15', 105000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'ChocoArándanos', '1/2 lb', '20-25', 160000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'ChocoArándanos', '1 lb', '30-40', 225000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'ChocoBerry', 'personal', '6', 49500, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'ChocoBerry', '1/4 lb', '10-15', 92000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'ChocoBerry', '1/2 lb', '20-25', 150000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'ChocoBerry', '1 lb', '30-40', 225000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'ChocoIntenso', 'personal', '6', 49500, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'ChocoIntenso', '1/4 lb', '10-15', 92000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'ChocoIntenso', '1/2 lb', '20-25', 140000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'ChocoIntenso', '1 lb', '30-40', 207000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'ChocoVainilla', 'personal', '6', 49500, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'ChocoVainilla', '1/4 lb', '10-15', 92000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'ChocoVainilla', '1/2 lb', '20-25', 140000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'ChocoVainilla', '1 lb', '30-40', 207000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Milky Way', 'personal', '6', 58000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Milky Way', '1/4 lb', '10-15', 110000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Milky Way', '1/2 lb', '20-25', 175000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Milky Way', '1 lb', '30-40', 265000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Negro de vino', 'personal', '6', 58000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Negro de vino', '1/4 lb', '10-15', 110000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Negro de vino', '1/2 lb', '20-25', 175000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Negro de vino', '1 lb', '30-40', 265000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Red Velvet', 'personal', '6', 49500, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Red Velvet', '1/4 lb', '10-15', 92000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Red Velvet', '1/2 lb', '20-25', 150000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Red Velvet', '1 lb', '30-40', 225000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Sin azúcar', 'personal', '6', 49500, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Sin azúcar', '1/4 lb', '10-15', 92000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Sin azúcar', '1/2 lb', '20-25', 140000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Sin azúcar', '1 lb', '30-40', 207000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Tradicional', 'personal', '6', 49500, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Tradicional', '1/4 lb', '10-15', 92000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Tradicional', '1/2 lb', '20-25', 150000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Tradicional', '1 lb', '30-40', 225000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Vainilla', 'personal', '6', 49500, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Vainilla', '1/4 lb', '10-15', 92000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Vainilla', '1/2 lb', '20-25', 140000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Vainilla', '1 lb', '30-40', 207000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Vainilla arequipe', 'personal', '6', 49500, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Vainilla arequipe', '1/4 lb', '10-15', 92000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Vainilla arequipe', '1/2 lb', '20-25', 150000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Vainilla arequipe', '1 lb', '30-40', 225000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Velvet frutos rojos', 'personal', '6', 49500, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Velvet frutos rojos', '1/4 lb', '10-15', 92000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Velvet frutos rojos', '1/2 lb', '20-25', 140000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Velvet frutos rojos', '1 lb', '30-40', 207000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Zanahoria', 'personal', '6', 49500, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Zanahoria', '1/4 lb', '10-15', 92000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Zanahoria', '1/2 lb', '20-25', 140000, 'decoración básica', false),
    (v_ws, 'ponque_personalizado', 'Zanahoria', '1 lb', '30-40', 207000, 'decoración básica', false),
    (v_ws, 'porcion', 'Amapola', 'porcion', '1', 12700, NULL, false),
    (v_ws, 'porcion', 'Amapola maracuyá', 'porcion', '1', 14000, NULL, false),
    (v_ws, 'porcion', 'ChocoArequipe', 'porcion', '1', 12700, NULL, false),
    (v_ws, 'porcion', 'ChocoArándanos', 'porcion', '1', 16500, NULL, false),
    (v_ws, 'porcion', 'ChocoBerry', 'porcion', '1', 14000, NULL, false),
    (v_ws, 'porcion', 'ChocoIntenso', 'porcion', '1', 12700, NULL, false),
    (v_ws, 'porcion', 'ChocoVainilla', 'porcion', '1', 12700, NULL, false),
    (v_ws, 'porcion', 'Milky Way', 'porcion', '1', 17500, NULL, false),
    (v_ws, 'porcion', 'Negro de vino', 'porcion', '1', 15000, NULL, false),
    (v_ws, 'porcion', 'Red Velvet', 'porcion', '1', 17500, NULL, false),
    (v_ws, 'porcion', 'Sin azúcar', 'porcion', '1', 12700, NULL, false),
    (v_ws, 'porcion', 'Tradicional', 'porcion', '1', 12700, NULL, false),
    (v_ws, 'porcion', 'Vainilla', 'porcion', '1', 12700, NULL, false),
    (v_ws, 'porcion', 'Vainilla arequipe', 'porcion', '1', 15500, NULL, false),
    (v_ws, 'porcion', 'Velvet frutos rojos', 'porcion', '1', 15500, NULL, false),
    (v_ws, 'porcion', 'Zanahoria', 'porcion', '1', 14000, NULL, false)
  ON CONFLICT (workspace_id, linea, sabor, tamano) DO UPDATE SET
    porciones = EXCLUDED.porciones, precio = EXCLUDED.precio, incluye = EXCLUDED.incluye,
    vigente = TRUE, updated_at = now();

  RAISE NOTICE 'Golosita cargada en workspace %', v_ws;
END $$;

-- Verificación rápida:
-- select linea, count(*) from precios group by linea order by linea;   -- 149 en total
-- select pd_cotizar((select id from workspaces where slug ilike 'golosita%' limit 1),
--                   'ponque_personalizado', 'ChocoBerry', '1/2 lb');  -- total 150000 · anticipo 90000
