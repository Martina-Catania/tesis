import { GoogleGenAI } from "@google/genai";

const genai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
});

const DEFAULT_PROMPT =
    "Identifica el cliente, la dirección y la cant de paquetes entregados " +
    "(un numero en un circulo) en este remito. " +
    "Contesta con el formato: " +
    "'Cliente: [nombre del cliente]\\n Dir: [dirección del cliente]\\n Bultos: [cant de paquetes]'. " +
    "No agregues texto adicional, solo responde con el formato indicado.";

/**
 * Sends a base64-encoded image to Gemini Vision and returns the raw extracted text.
 */
export async function extractDataFromImage(
    imageBuffer: Buffer,
    mimeType: "image/jpeg" | "image/png" | "image/webp" = "image/jpeg",
    prompt = DEFAULT_PROMPT,
): Promise<string> {
    const base64Image = imageBuffer.toString("base64");

    const response = await genai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
            {
                parts: [
                    {
                        inlineData: {
                            mimeType,
                            data: base64Image,
                        },
                    },
                    {
                        text: prompt,
                    },
                ],
            },
        ],
    });

    return response.text ?? "No data extracted.";
}