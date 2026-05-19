import { Router, type IRouter } from "express";

const router: IRouter = Router();

const PASSWORD = process.env.GIRL_AGENT_WEBUI_PASSWORD ?? "";
const enabled = PASSWORD.length > 0;

router.get("/auth/status", (_req, res) => {
  res.json({ enabled });
});

router.post("/auth/login", (req, res) => {
  if (!enabled) {
    res.json({ ok: true });
    return;
  }
  const { password } = req.body as { password?: string };
  if (password === PASSWORD) {
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: "Неверный пароль" });
  }
});

router.post("/auth/logout", (_req, res) => {
  res.json({ ok: true });
});

export default router;
