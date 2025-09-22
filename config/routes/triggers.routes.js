// backend/config/routes/triggers.routes.js
import { Router } from "express";
import auth from "../middleware/auth.js";
import {
  listTriggers,
  getTriggerById,
  createTrigger,
  updateTrigger,
  deleteTrigger,
} from "../controllers/triggers.controller.js";

const router = Router();

router.get("/", auth, listTriggers);
router.get("/:id", auth, getTriggerById);
router.post("/", auth, createTrigger);
router.put("/:id", auth, updateTrigger);
router.delete("/:id", auth, deleteTrigger);

export default router;
