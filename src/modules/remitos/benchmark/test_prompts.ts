import { GoogleGenAI } from "@google/genai";
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";

const MODEL = "gemini-3.5-flash-lite";
const TEST_DIR = path.resolve(process.cwd(), "test_remitos");
const FEW_SHOT_DIR = path.resolve(process.cwd(), "few_shot_examples"); // carpeta con imágenes de ejemplo
const OUTPUT_DIR = path.resolve(process.cwd(), "benchmark_results");
const TOTAL = 10;
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 2_000;
const EXTRA_BUFFER_MS = 10_000;

// ─── Prompts ──────────────────────────────────────────────────────────────────

// Texto base compartido por todos los prompts
const EXTRACTION_TASK =
    "Extraé exactamente tres campos de este remito:\n" +
    "Cliente: <valor o ILEGIBLE>\n" +
    "Dir: <valor o ILEGIBLE>\n" +
    "Bultos: <número entero>\n" +
    "No agregues texto antes ni después.";

const PROMPTS: Record<string, string> = {
    declarative_prompt:
        "Identifica el cliente (ignorando números antes del nombre), " +
        "la dirección de envío (manuscrita usualmente o agregada como observación; " +
        "ignorá localidades y número de piso) y la cantidad de paquetes entregados " +
        "(número dentro de un círculo) en este remito. " +
        "Ignorá cualquier texto tachado. " +
        "Si un campo es ilegible escribí ILEGIBLE (texto) o 0 (bultos). " +
        "Respondé solo con:\n" +
        "Cliente: [nombre]\nDir: [dirección]\nBultos: [número]",

    structured_prompt:
        "Sos un sistema de extracción de datos de remitos argentinos.\n" +
        "Extraé exactamente tres campos:\n\n" +
        "1. CLIENTE — nombre del destinatario, sin números previos al nombre.\n" +
        "2. DIRECCIÓN — dirección de entrega (suele ser manuscrita). Solo calle y número, sin localidad ni piso.\n" +
        "3. BULTOS — número entero dentro de un círculo en el documento.\n\n" +
        "Reglas:\n" +
        "- Ignorá texto tachado.\n" +
        "- Campo ilegible → ILEGIBLE (texto) o 0 (bultos).\n" +
        "- Respondé únicamente con el bloque de salida, sin texto adicional.\n\n" +
        "Cliente: <valor o ILEGIBLE>\n" +
        "Dir: <valor o ILEGIBLE>\n" +
        "Bultos: <número entero>",

    // few_shot_prompt ya no lleva ejemplos de texto — se inyectan como imágenes en buildFewShotContents()
    few_shot_prompt:
        "Sos un sistema de extracción de datos de remitos argentinos.\n" +
        "Reglas:\n" +
        "- CLIENTE: nombre del destinatario, sin números previos.\n" +
        "- DIRECCIÓN: solo calle y número, sin localidad ni piso.\n" +
        "- BULTOS: número entero dentro de un círculo.\n" +
        "- Ignorá texto tachado.\n" +
        "- Campo ilegible → ILEGIBLE (texto) o 0 (bultos).\n" +
        "- Nunca omitas una línea.\n" +
        "- No agregues texto antes ni después.",
};

// ─── Few-shot examples ────────────────────────────────────────────────────────

/**
 * Cada ejemplo tiene:
 *   - filename: imagen real de un remito conocido (en ./few_shot_examples/)
 *   - output:   respuesta esperada tal como debe contestar el modelo
 *
 * Usá remitos distintos a los 10 de test para no contaminar el benchmark.
 */
const FEW_SHOT_EXAMPLES: Array<{ filename: string; output: string }> = [
    {
        filename: "ejemplo-1.png",
        output: "Cliente: MILLENNIALS EMPRESA CONSTRUCTORA\nDir: ARISMENDI 2608\nBultos: 1",
    },
    {
        filename: "ejemplo-2.png",
        output: "Cliente: SUAREZ SERGIO\nDir:AUSTRIA 2512\nBultos: 1",
    },
    {
        filename: "ejemplo-3.png", // ejemplo con dirección ilegible
        output: "Cliente: SABBAGH, EZRA MARTIN\nDir: ILEGIBLE\nBultos: 0",
    },
];

// ─── Ground truth ─────────────────────────────────────────────────────────────

type Expected = { clientName?: string; address?: string; packages?: number };

const EXPECTED: Expected[] = [
    { clientName: "MIZRAHI SANTIAGO", address: "FLORIDA 650", packages: 3 },
    { clientName: "CHEEK S.A.", address: "CATAMARCA 1725", packages: 12 },
    { clientName: "GULMA SRL", address: "COUNTRY MAYLIGHT", packages: 1 },
    { clientName: "DUECK COHEN, FORTUNATA CLAUDIA", address: "CORDOBA 2919", packages: 1 },
    { clientName: "FUNDACION UNIVERSIDAD DE", address: "PARAGUAY 1338", packages: 3 },
    { clientName: "MIZRAHI SANTIAGO", address: "FLORIDA 650", packages: 3 },
    { clientName: "SEGOVIA, ARNALDO SALVADOR", address: "SUAREZ 228", packages: 2 },
    { clientName: "GOLUBICKI NATASHA", address: "URIARTE 2217", packages: 2 },
    { clientName: "COHEN MARCELO", address: "CABRERA 5128", packages: 2 },
    { clientName: "NEW ZAPATA", address: "JORGE NEWBERY 2497", packages: 2 },
];

// ─── Types ────────────────────────────────────────────────────────────────────

type Fields = { clientName?: string; address?: string; packages?: number };
type FieldKey = "clientName" | "address" | "packages";

// Tipos de partes de contenido compatibles con @google/genai
type InlineDataPart = { inlineData: { mimeType: string; data: string } };
type TextPart = { text: string };
type Part = InlineDataPart | TextPart;
type ContentPart = { role: string; parts: Part[] };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RETRYABLE = new Set([429, 503]);

function isRetryable(err: unknown): boolean {
    if (err instanceof Error) {
        try {
            const body = JSON.parse(err.message) as { error?: { code?: number } };
            if (typeof body?.error?.code === "number" && RETRYABLE.has(body.error.code)) return true;
        } catch { /* not JSON */ }
        const status = (err as { status?: number }).status;
        if (typeof status === "number" && RETRYABLE.has(status)) return true;
    }
    return false;
}

function parseRetryDelay(err: unknown): number | null {
    if (!(err instanceof Error)) return null;
    try {
        const body = JSON.parse(err.message) as {
            error?: {
                details?: Array<{ "@type"?: string; retryDelay?: string }>;
            };
        };
        const retryInfo = body?.error?.details?.find(
            d => d["@type"] === "type.googleapis.com/google.rpc.RetryInfo"
        );
        const delay = retryInfo?.retryDelay;
        if (delay) return parseInt(delay, 10) * 1000;
    } catch { /* not JSON */ }
    return null;
}

function parseResponse(raw: string): Fields {
    const result: Fields = {};
    for (const line of raw.split("\n").map(l => l.trim())) {
        const c = line.match(/^Cliente:\s*(.+)$/i);
        if (c) { result.clientName = c[1].trim(); continue; }
        const d = line.match(/^Dir:\s*(.+)$/i);
        if (d) { result.address = d[1].trim(); continue; }
        const b = line.match(/^Bultos:\s*(\d+)$/i);
        if (b) { result.packages = parseInt(b[1], 10); }
    }
    return result;
}

function fieldErrors(parsed: Fields, expected: Expected): FieldKey[] {
    const norm = (s: string) => s.trim().toLowerCase();
    const errors: FieldKey[] = [];
    if (expected.clientName && norm(parsed.clientName ?? "") !== norm(expected.clientName)) errors.push("clientName");
    if (expected.address && norm(parsed.address ?? "") !== norm(expected.address)) errors.push("address");
    if (expected.packages !== undefined && parsed.packages !== expected.packages) errors.push("packages");
    return errors;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function readImageAsBase64(filePath: string): string {
    return fs.readFileSync(filePath).toString("base64");
}

function writePromptReport(key: string, counts: Record<FieldKey, number>, failedImages: string[]) {
    const pct = (n: number) => `${n}/${TOTAL} (${Math.round(n / TOTAL * 100)}%)`;
    const lines = [
        `Prompt: ${key}`,
        `Failed Images: ${failedImages.length}/${TOTAL}`,
        `Cliente: ${pct(counts.clientName)}`,
        `Dir: ${pct(counts.address)}`,
        `Bultos: ${pct(counts.packages)}`,
        "",
        failedImages.length ? `Failed files: ${failedImages.join(", ")}` : "Failed files: none",
        "",
    ];

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const outputPath = path.join(OUTPUT_DIR, `${key}.txt`);
    fs.writeFileSync(outputPath, lines.join("\n"), "utf8");
    // console.log(`📝 Result written to ${outputPath}`);
}

// ─── Few-shot content builder ─────────────────────────────────────────────────

/**
 * Construye el array de contents para el few_shot_prompt.
 * Cada ejemplo se envía como un turn user (imagen + "Extraé los campos")
 * seguido de un turn model (la respuesta esperada).
 * Al final se agrega el turn user con la imagen objetivo.
 *
 * Si algún archivo de ejemplo no existe, se omite ese par y se avisa por consola.
 */
function buildFewShotContents(
    systemPrompt: string,
    targetBase64: string
): ContentPart[] {
    const contents: ContentPart[] = [];

    // Turn inicial con las instrucciones del sistema (como primer mensaje user)
    contents.push({
        role: "user",
        parts: [{ text: systemPrompt }],
    });
    contents.push({
        role: "model",
        parts: [{ text: "Entendido. Estoy listo para extraer los campos de cada remito." }],
    });

    // Pares imagen ejemplo → respuesta esperada
    for (const example of FEW_SHOT_EXAMPLES) {
        const examplePath = path.join(FEW_SHOT_DIR, example.filename);

        if (!fs.existsSync(examplePath)) {
            console.warn(`  ⚠️  Few-shot example not found, skipping: ${example.filename}`);
            continue;
        }

        const exampleBase64 = readImageAsBase64(examplePath);

        contents.push({
            role: "user",
            parts: [
                { inlineData: { mimeType: "image/jpeg", data: exampleBase64 } },
                { text: EXTRACTION_TASK },
            ],
        });
        contents.push({
            role: "model",
            parts: [{ text: example.output }],
        });
    }

    // Turn final con la imagen objetivo
    contents.push({
        role: "user",
        parts: [
            { inlineData: { mimeType: "image/jpeg", data: targetBase64 } },
            { text: EXTRACTION_TASK },
        ],
    });

    return contents;
}

// ─── API call ─────────────────────────────────────────────────────────────────

async function callModel(
    genai: GoogleGenAI,
    promptKey: string,
    prompt: string,
    imageBase64: string
): Promise<string> {
    if (promptKey === "few_shot_prompt") {
        // Few-shot multimodal: conversación multi-turn con imágenes reales
        const contents = buildFewShotContents(prompt, imageBase64);
        const res = await (genai.models.generateContent as Function)({
            model: MODEL,
            contents,
        });
        return res.text ?? "";
    }

    // Otros prompts: llamada simple imagen + texto
    const res = await genai.models.generateContent({
        model: MODEL,
        contents: [{
            parts: [
                { inlineData: { mimeType: "image/jpeg", data: imageBase64 } },
                { text: prompt },
            ],
        }],
    });
    return res.text ?? "";
}

// ─── Run benchmark ────────────────────────────────────────────────────────────

async function main() {
    if (!process.env.GEMINI_API_KEY) { console.error("❌ GEMINI_API_KEY not set"); process.exit(1); }
    if (!fs.existsSync(TEST_DIR)) { console.error(`❌ Folder not found: ${TEST_DIR}`); process.exit(1); }

    if (!fs.existsSync(FEW_SHOT_DIR)) {
        console.warn(`⚠️  Few-shot examples folder not found: ${FEW_SHOT_DIR}`);
        console.warn("   El few_shot_prompt correrá sin ejemplos visuales.\n");
    }

    const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    console.log(`\n🔍 ${MODEL} | ${TOTAL} images | ${Object.keys(PROMPTS).length} prompts\n`);

    const summary: Record<string, Record<FieldKey, number>> = {};
    const failures: Record<string, string[]> = {};

    for (const [key, prompt] of Object.entries(PROMPTS)) {
        console.log(`\n▶ ${key}${key === "few_shot_prompt" ? " (multimodal)" : ""}`);
        summary[key] = { clientName: 0, address: 0, packages: 0 };
        failures[key] = [];

        for (let i = 1; i <= TOTAL; i++) {
            const filename = `remito-${i}.jpeg`;
            const imgPath = path.join(TEST_DIR, filename);

            if (!fs.existsSync(imgPath)) {
                console.warn(`  ⚠️  ${filename} not found`);
                summary[key].clientName++; summary[key].address++; summary[key].packages++;
                failures[key].push(filename);
                continue;
            }

            const base64 = readImageAsBase64(imgPath);
            process.stdout.write(`  ${filename} … `);

            let raw = "";
            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                try {
                    raw = await callModel(genai, key, prompt, base64);
                    break;
                } catch (err) {
                    const retryDelay = parseRetryDelay(err);

                    if (!isRetryable(err) || attempt === MAX_ATTEMPTS) {
                        if (retryDelay) {
                            const totalDelay = retryDelay + EXTRA_BUFFER_MS;
                            console.warn(`\n  ⏳ Quota exhausted. Waiting ${(totalDelay / 1000).toFixed(1)}s before continuing…`);
                            await sleep(totalDelay);
                        } else {
                            console.error(`\n  ERROR after ${attempt} attempt(s): ${err}`);
                        }
                        break;
                    }

                    const delay = (retryDelay ?? BASE_DELAY_MS * 2 ** (attempt - 1)) + EXTRA_BUFFER_MS;
                    console.warn(`\n  ⚠️  503/429 on attempt ${attempt}, retrying in ${(delay / 1000).toFixed(1)}s…`);
                    await sleep(delay);
                }
            }

            console.log(`\n--- Gemini raw response for ${filename} ---`);
            console.log(raw || "<empty response>");
            console.log(`--- end raw response ---`);

            const parsed = parseResponse(raw);
            const errs = fieldErrors(parsed, EXPECTED[i - 1]);

            console.log(errs.length === 0 ? "✅\n" : `❌ (${errs.join(", ")})\n`);
            for (const f of errs) summary[key][f]++;
            if (errs.length) failures[key].push(filename);

            await sleep(500);
        }
    }

    // ─── Report ───────────────────────────────────────────────────────────────

    const pct = (n: number) => `${n}/${TOTAL} (${Math.round(n / TOTAL * 100)}%)`;
    const col = (s: string, w: number) => s.padEnd(w).slice(0, w);

    console.log("\n\n" + "═".repeat(72));
    console.log("  RESULTS");
    console.log("═".repeat(72));
    console.log(`  ${col("Prompt", 22)} │ ${col("Failed", 10)} │ ${col("Cliente", 10)} │ ${col("Dir", 10)} │ Bultos`);
    console.log("  " + "─".repeat(70));

    for (const [key, counts] of Object.entries(summary)) {
        const failed = failures[key].length;
        console.log(`  ${col(key, 22)} │ ${col(pct(failed), 10)} │ ${col(pct(counts.clientName), 10)} │ ${col(pct(counts.address), 10)} │ ${pct(counts.packages)}`);
        writePromptReport(key, counts, failures[key]);
    }

    for (const [key, imgs] of Object.entries(failures)) {
        console.log(`\n─── ${key} — failed images ───`);
        console.log(imgs.length ? imgs.join(", ") : "(all passed ✅)");
    }

    const winner = Object.entries(failures).sort((a, b) => a[1].length - b[1].length)[0];
    console.log(`\n🏆 Best prompt: ${winner[0]} (${winner[1].length}/${TOTAL} failures)\n`);
}

main().catch(err => { console.error(err); process.exit(1); });