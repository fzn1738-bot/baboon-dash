import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Generate Financial Analysis based on dashboard metrics
 */
export const getMarketAnalysis = async (
  role: 'INVESTOR' | 'ADMIN',
  metrics: any,
  recentTrades: any[]
): Promise<string> => {
  try {
    const systemInstruction = role === 'INVESTOR'
      ? "You are a Senior Portfolio Manager at TradeFlow. Analyze the user's portfolio metrics and recent trades. Provide concise, actionable investment insights, risk warnings, and performance observations. Keep it professional, data-driven, and under 150 words."
      : "You are the Chief Risk Officer for a Trading Platform. Analyze the system metrics and user activity. Identify potential anomalies, liquidity risks, or system health issues. Provide a brief executive summary for the administrator.";

    // Construct a prompt from the data
    const prompt = `
      Current Metrics: ${JSON.stringify(metrics)}
      Recent Activity: ${JSON.stringify(recentTrades.slice(0, 5))}
      
      Please provide your analysis.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.3, // Lower temperature for more analytical/consistent results
      },
    });

    return response.text || "Analysis currently unavailable.";
  } catch (error) {
    console.error("AI Analysis error:", error);
    return "Unable to generate analysis at this time. Market data connection interrupted.";
  }
};

/**
 * Send a chat message with history
 */
export const sendChatMessage = async (message: string, history: any[]): Promise<string> => {
  try {
    // The history passed from the component includes the current user message at the end.
    // We should remove it when initializing the chat history to avoid duplication/confusion,
    // as we send the message explicitly via chat.sendMessage().
    const historyForChat = history.length > 0 && history[history.length - 1].role === 'user'
      ? history.slice(0, -1)
      : history;

    const chat = ai.chats.create({
      model: 'gemini-3-flash-preview',
      history: historyForChat,
      config: {
        systemInstruction: "You are the Chief Baboon, a helpful and slightly mischievous AI assistant.",
      },
    });

    const response = await chat.sendMessage({ message });
    return response.text || "No response.";
  } catch (error) {
    console.error("Chat error:", error);
    throw error;
  }
};

/**
 * Analyze an image with a prompt
 */
export const analyzeImage = async (imageBase64: string, prompt: string): Promise<string> => {
  try {
    // Extract mimeType and base64 data from the Data URL (e.g., "data:image/png;base64,...")
    const matches = imageBase64.match(/^data:(.+);base64,(.+)$/);
    if (!matches) {
      throw new Error("Invalid image format");
    }
    const mimeType = matches[1];
    const data = matches[2];

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: data,
            },
          },
          { text: prompt },
        ],
      },
    });

    return response.text || "Could not analyze image.";
  } catch (error) {
    console.error("Vision error:", error);
    throw error;
  }
};

/**
 * Generate a creative image from a prompt
 */
export const generateCreativeImage = async (prompt: string): Promise<string> => {
  try {
    // Using gemini-2.5-flash-image for image generation
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [{ text: prompt }],
      },
      config: {
        imageConfig: {
          aspectRatio: "1:1",
        }
      },
    });

    // Iterate through parts to find the image data
    for (const candidate of response.candidates || []) {
      for (const part of candidate.content?.parts || []) {
        if (part.inlineData) {
          return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
      }
    }

    throw new Error("No image generated in response");
  } catch (error) {
    console.error("Image generation error:", error);
    throw error;
  }
};