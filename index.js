const express = require("express");
const crypto = require("crypto");
const axios = require("axios");
const { GoogleGenAI } = require("@google/genai");

const app = express();

// 需要 raw body 來驗證 LINE signature
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

// 驗證 LINE signature
function verifyLineSignature(req) {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const signature = req.get("x-line-signature");

  if (!channelSecret || !signature || !req.rawBody) {
    return false;
  }

  const hash = crypto
    .createHmac("sha256", channelSecret)
    .update(req.rawBody)
    .digest("base64");

  return hash === signature;
}

// Gemini client
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// 你的九宮數顧問提示詞
function buildPrompt(userText) {
  return `
你是「九宮數諮詢助理」，請一律使用繁體中文回答。

你的任務：
1. 先理解使用者想問什麼
2. 若問題還不完整，要一步一步引導，不要一次自問自答
3. 語氣溫和、清楚、像真人顧問
4. 如果需要數字或進一步資料，再請使用者提供
5. 不要過度冗長，先回最關鍵的下一步

使用者訊息：
${userText}
`.trim();
}

// 呼叫 Gemini
async function askGemini(userText) {
  const prompt = buildPrompt(userText);

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
  });

  return (
    response.text ||
    "我已收到你的訊息，但目前暫時無法產生回覆，請稍後再試。"
  );
}

// 回覆 LINE
async function replyToLine(replyToken, text) {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  console.log(
    "LINE token exists:",
    !!accessToken,
    "length:",
    accessToken ? accessToken.length : 0,
    "secret exists:",
    !!process.env.LINE_CHANNEL_SECRET
  );

  const safeText = (text || "目前暫時無法回覆，請稍後再試。").slice(0, 1800);

  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    {
      replyToken,
      messages: [
        {
          type: "text",
          text: safeText,
        },
      ],
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      timeout: 15000,
    }
  );
}

app.post("/webhook", async (req, res) => {
  // 先立即回 200，避免 LINE 重送
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
    console.error(
      "Webhook error:",
      error.response?.data || error.message || error
    );
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
