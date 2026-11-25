import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const models = [
  "gemini-3.5-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.6-flash",
];

for (const model of models) {
  console.log(`Testing ${model}...`);

  try {
    const response = await ai.models.generateContent({
      model,
      contents: "Say hello in five words or fewer.",
      config: {
        maxOutputTokens: 80,
      },
    });

    console.log("SUCCESS:", model);
    console.log("Response:", response.text);
    break;
  } catch (error) {
    console.log(
      "FAILED:",
      model,
      "Status:",
      error.status ?? "unknown"
    );
  }
}