// messages.routes.js
import { Router } from "express";
import auth from "../middleware/auth.js";
import {
  listMessages,
  getMessageById,
  createMessage,
  updateMessage,
  deleteMessage,
} from "../controllers/messages.controller.js";

const router = Router();

router.get("/", auth, listMessages);
router.get("/:id", auth, getMessageById);
router.post("/", auth, createMessage);
router.put("/:id", auth, updateMessage);
router.delete("/:id", auth, deleteMessage);

export default router;
