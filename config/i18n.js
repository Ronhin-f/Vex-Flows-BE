const MSG = {
  en: {
    sla: { lead_assigned: "New lead assigned to {{assignee}}. First contact SLA: 30 minutes." },
    stock: { low: "Low stock for {{product}}: {{qty}} left." }
  },
  es: {
    sla: { lead_assigned: "Nuevo lead asignado a {{assignee}}. SLA de primer contacto: 30 minutos." },
    stock: { low: "Stock bajo para {{product}}: quedan {{qty}}." }
  }
};
const getLang = (req) => (req.headers['x-lang'] || req.query.lang || 'es').toLowerCase().startsWith('en') ? 'en' : 'es';

export function initI18n() {
  return (req, _res, next) => {
    const lang = getLang(req);
    req.t = (path, vars = {}) => {
      const seg = path.split('.');
      let cur = MSG[lang];
      for (const s of seg) cur = cur?.[s];
      if (typeof cur !== 'string') return path;
      return cur.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ''));
    };
    next();
  };
}
