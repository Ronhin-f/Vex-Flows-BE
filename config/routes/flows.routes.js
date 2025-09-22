// flows.routes.js
import { Router } from "express";
import auth from "../middleware/auth.js";
import {
  listFlows,
  getFlowById,
  createFlow,
  updateFlow,
  deleteFlow,
} from "../controllers/flows.controller.js";

const router = Router();

router.get("/", auth, listFlows);
router.get("/:id", auth, getFlowById);
router.post("/", auth, createFlow);
router.put("/:id", auth, updateFlow);
router.delete("/:id", auth, deleteFlow);

export default router;
