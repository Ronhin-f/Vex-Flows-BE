import { Router } from "express";
import {
  testEmail,
  testSlack,
  testWhatsapp,
} from "../controllers/providers.controller.js";

const router = Router();

router.post("/email/send", testEmail);
router.post("/slack/test", testSlack);
router.post("/whatsapp/test", testWhatsapp);

export default router;
