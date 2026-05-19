import { Router, type IRouter, type Request, type Response } from "express";
import { getAnthropicClient, DEFAULT_MODEL } from "../lib/anthropic";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/assistant/chat", async (req: Request, res: Response) => {
  const { messages, system } = req.body as {
    messages: { role: "user" | "assistant"; content: string }[];
    system?: string;
  };

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages array is required" });
    return;
  }

  try {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const anthropic = getAnthropicClient();

    const stream = anthropic.messages.stream({
      model: DEFAULT_MODEL,
      max_tokens: 8192,
      ...(system ? { system } : {}),
      messages,
    });

    let fullText = "";

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        const chunk = event.delta.text;
        if (chunk) {
          fullText += chunk;
          res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
        }
      }
    }

    res.write(`data: ${JSON.stringify({ done: true, full: fullText })}\n\n`);
    res.end();
  } catch (err) {
    logger.error({ err }, "assistant/chat error");
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: "LLM request failed" })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: "LLM request failed" });
    }
  }
});

router.post("/assistant/complete", async (req: Request, res: Response) => {
  const { messages, system } = req.body as {
    messages: { role: "user" | "assistant"; content: string }[];
    system?: string;
  };

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages array is required" });
    return;
  }

  try {
    const anthropic = getAnthropicClient();

    const response = await anthropic.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 8192,
      ...(system ? { system } : {}),
      messages,
    });

    const content = response.content[0];
    const text = content.type === "text" ? content.text : "";

    res.json({ content: text, model: response.model, usage: response.usage });
  } catch (err) {
    logger.error({ err }, "assistant/complete error");
    res.status(500).json({ error: "LLM request failed" });
  }
});

export default router;
