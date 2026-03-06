const express = require("express");
const crypto = require("crypto");
const axios = require("axios");
const { GoogleGenAI } = require("@google/genai");

const app = express();

app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.get("/", (req, res) => {
  res.status(200).send("OK");
});

app.get("/webhook", (req, res) => {
  res.status(200).send("WEBHOOK OK");
});

function verifyLineSignature(req) {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const signature = req.get("x-line-signature");

  if (!channelSecret || !signature || !req.rawBody) return false;

  const hash = crypto
    .createHmac("sha256", channelSecret)
    .update(req.rawBody)
    .digest("base64");

  return hash === signature;
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

async function askGemini(userText) {
  const prompt = `
你是「九宮數諮詢助理」，請一律用繁體中文回答。
你的任務：
1. 先理解使用者問題
2. 如果需要進入九宮數流程，請一步一步引導
3. 不要一次把全部答案講完
4. 要像真人顧問一樣溫和、清楚、分步驟引導

使用者訊息：
${userText}
`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
  });

  return response.text || "我已收到你的問題，但目前暫時無法回覆，請再試一次。";
}

async function replyToLine(replyToken, text) {
  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    {
      replyToken,
      messages: [
        {
          type: "text",
          text: text.slice(0, 1800),
        },
      ],
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
    }
  );
}

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    if (!verifyLineSignature(req)) {
      console.log("LINE signature 驗證失敗");
      return;
    }

    const events = req.body.events || [];

    for (const event of events) {
      if (
        event.type === "message" &&
        event.message &&
        event.message.type === "text"
      ) {
        const userText = event.message.text;
        const replyToken = event.replyToken;

        console.log("收到訊息：", userText);

        const geminiReply = await askGemini(userText);

        console.log("Gemini 回覆：", geminiReply);

        await replyToLine(replyToken, geminiReply);
      }
    }
  } catch (error) {
    console.error("Webhook error:", error.response?.data || error.message || error);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
redeploy test
