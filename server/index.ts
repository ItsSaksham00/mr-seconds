
import "dotenv/config";
import express from "express";
import * as speechsdk from "microsoft-cognitiveservices-speech-sdk";
import { GoogleGenAI } from "@google/genai";

// ============================================
// MR. SECONDS V2.5
// GEMINI AI + AZURE SPEECH + LIP SYNC
// ============================================

const app = express();

const PORT = Number(
  process.env.SPEECH_SERVER_PORT || 3001
);

const REGION =
  process.env.AZURE_SPEECH_REGION || "eastus";

const VOICE =
  "en-US-DustinMultilingualNeural";

const GEMINI_MODEL =
  process.env.GEMINI_MODEL || "gemini-3.8-flash";

app.use(express.json({ limit: "16kb" }));

// ============================================
// GEMINI CONFIGURATION
// ============================================

const gemini = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
});

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

// ============================================
// GEMINI RETRY HANDLER
// Retries temporary server failures only.
// ============================================

async function generateWithRetry(
  params: Parameters<
    typeof gemini.models.generateContent
  >[0]
) {
  const maxAttempts = 3;

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt++
  ) {
    try {
      return await gemini.models.generateContent(
        params
      );
    } catch (error) {
      const status =
        typeof error === "object" &&
        error !== null &&
        "status" in error
          ? Number(error.status)
          : undefined;

      const retryable =
        status === 503 || status === 500;

      if (!retryable || attempt === maxAttempts) {
        throw error;
      }

      const delay =
        1000 * Math.pow(2, attempt - 1);

      console.warn(
        `[Gemini] Temporary error ${status}. ` +
        `Retrying (${attempt}/${maxAttempts - 1})...`
      );

      await new Promise<void>((resolve) => {
        setTimeout(resolve, delay);
      });
    }
  }

  throw new Error("Gemini retries exhausted.");
}

// ============================================
// AZURE SPEECH TYPES
// ============================================

type Viseme = {
  timeMs: number;
  id: number;
};

type SpeechOutput = {
  audioBase64: string;
  mimeType: string;
  voice: string;
  visemes: Viseme[];
};

// ============================================
// AZURE SPEECH GENERATOR
// ============================================

function synthesizeSpeech(
  text: string
): Promise<SpeechOutput> {
  const key = process.env.AZURE_SPEECH_KEY;

  if (
    !key ||
    key === "PASTE_YOUR_KEY_HERE"
  ) {
    return Promise.reject(
      new Error(
        "Azure Speech key is not configured."
      )
    );
  }

  return new Promise((resolve, reject) => {
    const config =
      speechsdk.SpeechConfig.fromSubscription(
        key,
        REGION
      );

    config.speechSynthesisVoiceName = VOICE;

    // Generate WAV audio for browser playback.
    config.speechSynthesisOutputFormat =
      speechsdk.SpeechSynthesisOutputFormat
        .Riff16Khz16BitMonoPcm;

    // Do not play audio on the backend machine.
    const synthesizer =
      new speechsdk.SpeechSynthesizer(
        config,
        null
      );

    const visemes: Viseme[] = [];

    // Azure returns timestamps in 100-ns units.
    synthesizer.visemeReceived = (
      _sender,
      event
    ) => {
      visemes.push({
        timeMs: event.audioOffset / 10000,
        id: event.visemeId,
      });
    };

    synthesizer.speakTextAsync(
      text,

      (result) => {
        try {
          if (
            result.reason !==
            speechsdk.ResultReason
              .SynthesizingAudioCompleted
          ) {
            const details =
              speechsdk
                .SpeechSynthesisCancellationDetails
                .fromResult(result);

            reject(
              new Error(
                details.errorDetails ||
                  "Azure speech synthesis failed."
              )
            );

            return;
          }

          const audio = Buffer.from(
            result.audioData
          );

          if (!audio.length) {
            throw new Error(
              "Azure returned empty audio."
            );
          }

          visemes.sort(
            (a, b) => a.timeMs - b.timeMs
          );

          resolve({
            audioBase64: audio.toString("base64"),
            mimeType: "audio/wav",
            voice: VOICE,
            visemes,
          });
        } catch (error) {
          reject(error);
        } finally {
          synthesizer.close();
        }
      },

      (error) => {
        synthesizer.close();

        reject(
          new Error(String(error))
        );
      }
    );
  });
}

// ============================================
// HEALTH CHECK
// ============================================

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "Mr. Seconds API",
    region: REGION,
    voice: VOICE,
    geminiModel: GEMINI_MODEL,

    azureConfigured: Boolean(
      process.env.AZURE_SPEECH_KEY
    ),

    geminiConfigured: Boolean(
      process.env.GEMINI_API_KEY
    ),
  });
});

// ============================================
// AZURE SPEECH ENDPOINT
// POST /api/speech
// ============================================

app.post("/api/speech", async (req, res) => {
  const text = req.body?.text;

  if (
    typeof text !== "string" ||
    !text.trim()
  ) {
    res.status(400).json({
      error: "Please provide text to speak.",
    });
    return;
  }

  if (text.length > 300) {
    res.status(400).json({
      error:
        "Maximum 300 characters per speech request.",
    });
    return;
  }

  try {
    const result = await synthesizeSpeech(
      text.trim()
    );

    res.setHeader(
      "Cache-Control",
      "no-store"
    );

    res.json(result);
  } catch (error) {
    console.error(
      "Azure Speech error:",
      error
    );

    res.status(502).json({
      error:
        "Speech generation failed. " +
        "Check the backend terminal.",
    });
  }
});

// ============================================
// GEMINI AI CHAT ENDPOINT
// POST /api/chat
// ============================================

app.post("/api/chat", async (req, res) => {
  const message = req.body?.message;
  const history = req.body?.history;

  // Validate incoming question.
  if (
    typeof message !== "string" ||
    !message.trim() ||
    message.length > 1000
  ) {
    res.status(400).json({
      error:
        "Please enter a question under 1000 characters.",
    });
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    res.status(503).json({
      error:
        "Gemini API key is not configured.",
    });
    return;
  }

  // Limit conversation history.
  const previous: ChatMessage[] =
    Array.isArray(history)
      ? history
          .filter(
            (item): item is ChatMessage =>
              item !== null &&
              typeof item === "object" &&
              (item.role === "user" ||
                item.role === "assistant") &&
              typeof item.content === "string" &&
              item.content.length <= 1000
          )
          .slice(-8)
      : [];

  try {
    // Convert chat history to Gemini's format.
    const contents = [
      ...previous.map((item) => ({
        role:
          item.role === "assistant"
            ? "model"
            : "user",

        parts: [
          { text: item.content },
        ],
      })),

      {
        role: "user",
        parts: [
          { text: message.trim() },
        ],
      },
    ];

    // Call Gemini with automatic retry.
    const response = await generateWithRetry({
      model: GEMINI_MODEL,

      contents,

      config: {
        systemInstruction: `
You are Mr. Seconds, a friendly and intelligent
personal AI companion represented by an
animated 3D clock character.

PERSONALITY:
- Friendly, warm, and thoughtful.
- Youthful, curious, and playful.
- Helpful, intelligent, and approachable.
- Speak naturally, like a friendly companion.
- Use humor occasionally when appropriate.
- Do not repeatedly introduce yourself.
- Always be truthful about your abilities.

VOICE:
Your voice is Dustin Multilingual from Azure Speech.
Your responses will be spoken aloud.

RESPONSE STYLE:
- Keep answers conversational and clear.
- Prefer one or two short sentences for simple questions.
- Aim for answers under 250 characters when practical.
- Avoid Markdown, lists, and unnecessary symbols.
- For complex questions, prioritize answering accurately
  rather than forcing an incomplete response.

LANGUAGE:
- English is your default language.
- Multilingual voice commands may be added later.
- Do not claim language switching is already implemented.

CAPABILITIES:
- You can answer general questions and chat.
- Do not claim access to calendars, devices,
  private accounts, or personal information unless
  those features are explicitly connected.
- Never claim to have completed an action that
  the application cannot perform.

Your goal is to be a trustworthy, helpful,
and delightful personal companion.
        `,

        temperature: 0.7,

        maxOutputTokens: 300,
      },
    });

    const answer = response.text?.trim();

    if (!answer) {
      throw new Error(
        "Gemini returned an empty response."
      );
    }

    res.setHeader(
      "Cache-Control",
      "no-store"
    );

    res.json({
      answer,
      model: GEMINI_MODEL,
    });
  } catch (error) {
    console.error(
      "Gemini AI error:",
      error
    );

    const status =
      typeof error === "object" &&
      error !== null &&
      "status" in error
        ? Number(error.status)
        : undefined;

    if (status === 503) {
      res.status(503).json({
        error:
          "Gemini is currently overloaded. " +
          "Please try again shortly.",
      });
      return;
    }

    if (status === 429) {
      res.status(429).json({
        error:
          "Gemini rate limit reached. " +
          "Check your Google AI Studio quota.",
      });
      return;
    }

    if (status === 404) {
      res.status(502).json({
        error:
          "The selected Gemini model is not available " +
          "for this API key. Check GEMINI_MODEL.",
      });
      return;
    }

    res.status(502).json({
      error:
        "Unable to generate an AI response. " +
        "Check the backend terminal.",
    });
  }
});

// ============================================
// START LOCAL SERVER
// ============================================

// Keep API accessible locally.
// Vite proxies /api requests to this port.


if (!process.env.VERCEL) {
  app.listen(PORT, "127.0.0.1", () => {
    console.log("===================================");
    console.log("MR. SECONDS V2.5 API SERVER");
    console.log(`http://127.0.0.1:${PORT}`);
    console.log(`Azure Region: ${REGION}`);
    console.log(`Azure Voice: ${VOICE}`);
    console.log(`Gemini Model: ${GEMINI_MODEL}`);
    console.log("===================================");
  });
}

export default app;
