import { registry } from "./registry";
import { echoTool } from "./tools/echo";
import { scheduleLinkTool } from "./tools/schedule-link";
import { scheduleHighLevelTool } from "./tools/schedule-highlevel";
import { checkAvailabilityTool } from "./tools/check-availability";
import { customWebhookTool } from "./tools/custom-webhook";
// Módulo de pedidos (AI for PYMES)
import { cotizarProductoTool } from "./tools/pedidos/cotizar-producto";
import { consultarCupoTool } from "./tools/pedidos/consultar-cupo";
import { registrarPedidoTool } from "./tools/pedidos/registrar-pedido";
import { registrarComprobanteTool } from "./tools/pedidos/registrar-comprobante";

registry.register(echoTool);
registry.register(scheduleLinkTool);
registry.register(scheduleHighLevelTool);
registry.register(checkAvailabilityTool);
registry.register(customWebhookTool);
registry.register(cotizarProductoTool);
registry.register(consultarCupoTool);
registry.register(registrarPedidoTool);
registry.register(registrarComprobanteTool);

export { registry };
export type {
  Tool,
  ToolContext,
  ToolResult,
  ToolSensitivity,
} from "./core/tool";
