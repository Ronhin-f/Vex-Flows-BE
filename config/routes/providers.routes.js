// backend/config/routes/providers.routes.js
import { Router } from "express";
import { testEmail, testSlack, testWhatsapp } from "../controllers/providers.controller.js";

const providersRouter = Router();

// Queda montado en /api/providers/* desde index.js
providersRouter.post("/email/send", testEmail);
providersRouter.post("/slack/test", testSlack);
providersRouter.post("/whatsapp/test", testWhatsapp);

export default providersRouter;
