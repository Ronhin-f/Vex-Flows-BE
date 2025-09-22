// backend/providers.js
import * as Email from "./config/channels/email.smtp.js";
import * as Slack from "./config/channels/slack.webhook.js";
import * as WhatsApp from "./config/channels/whatsapp.twilio.js";

/**
 * Mapa simple de proveedores disponibles.
 * Cada proveedor expone al menos: send(payload)
 */
export const providers = {
  email: Email,
  slack: Slack,
  whatsapp: WhatsApp,
};

/**
 * Devuelve el proveedor por nombre (con validación).
 * Uso: const slack = getProvider('slack'); await slack.send({...})
 */
export function getProvider(name) {
  const key = String(name || "").toLowerCase();
  const p = providers[key];
  if (!p) throw new Error(`Provider desconocido: ${name}`);
  return p;
}

/**
 * Compatibilidad con tu controller:
 * Devuelve el conjunto de proveedores "para una organización".
 * Hoy no personaliza nada por org; si luego querés cargar credenciales por org,
 * este es el punto para hacerlo (leer DB y construir instancias configuradas).
 *
 * Uso típico en controllers:
 *   const ps = makeProvidersForOrg(req.user?.org_id);
 *   await ps[channel].send(payload);
 */
export function makeProvidersForOrg(_org) {
  // Placeholder de multi-tenant (extensible más adelante)
  return { ...providers }; // copia superficial para evitar mutaciones externas
}

export default providers;
