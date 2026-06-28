import { GoogleGenAI } from "@google/genai";

const genai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
});

const DEFAULT_PROMPT =
    "Identifica el cliente, la dirección de envio (manuscrita usualmente) y la cantidad de paquetes entregados (un numero en un circulo) en este remito. Ignora cualquier texto tachado. Contesta con el formato: 'Cliente: [nombre del cliente]\\n Dir: [dirección del cliente]\\n Bultos: [cant de paquetes]'. No agregues texto adicional, solo responde con el formato indicado.";

// ─── Retry config ─────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 2_000; // 2 s → 4 s → 8 s

// HTTP status codes that are safe to retry (transient server-side issues).
const RETRYABLE_STATUSES = new Set([429, 503]);

// ─── Error type ───────────────────────────────────────────────────────────────

/**
 * Thrown when Gemini is unavailable after all retry attempts are exhausted.
 * The controller catches this to save a RemitoError and reply gracefully
 * instead of letting the process crash.
 */
export class GeminiUnavailableError extends Error {
    constructor(
        public readonly attempts: number,
        cause: unknown,
    ) {
        super(`Gemini unavailable after ${attempts} attempt(s)`);
        this.name = 'GeminiUnavailableError';
        this.cause = cause;
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isRetryable(error: unknown): boolean {
    // The SDK throws an ApiError whose message is a JSON string containing
    // the HTTP status code, e.g. {"error":{"code":503,...}}
    if (error instanceof Error) {
        try {
            const body = JSON.parse(error.message) as { error?: { code?: number } };
            const code = body?.error?.code;
            if (typeof code === 'number' && RETRYABLE_STATUSES.has(code)) return true;
        } catch {
            // message was not JSON — fall through
        }
        // Also check a `status` property some SDK versions expose directly
        const status = (error as { status?: number }).status;
        if (typeof status === 'number' && RETRYABLE_STATUSES.has(status)) return true;
    }
    return false;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Sends a base64-encoded image to Gemini Vision and returns the raw extracted text.
 */
export async function extractDataFromImage(
    imageBuffer: Buffer,
    mimeType: "image/jpeg" | "image/png" | "image/webp" = "image/jpeg",
    prompt = DEFAULT_PROMPT,
): Promise<string> {
    const base64Image = imageBuffer.toString("base64");
    const request = {
        model: "gemini-2.5-flash",
        contents: [
            {
                parts: [
                    { inlineData: { mimeType, data: base64Image } },
                    { text: prompt },
                ],
            },
        ],
    };

    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            console.log(`[Remitos Gemini] Attempt ${attempt}/${MAX_ATTEMPTS}`);
            const response = await genai.models.generateContent(request);
            return response.text ?? "No data extracted.";
        } catch (error) {
            lastError = error;

            if (!isRetryable(error) || attempt === MAX_ATTEMPTS) {
                break;
            }

            const delay = BASE_DELAY_MS * 2 ** (attempt - 1); // 2 s, 4 s, 8 s …
            console.warn(
                `[Remitos Gemini] Attempt ${attempt} failed with retryable error, ` +
                `retrying in ${delay}ms…`,
                error,
            );
            await sleep(delay);
        }
    }

    throw new GeminiUnavailableError(MAX_ATTEMPTS, lastError);
}
