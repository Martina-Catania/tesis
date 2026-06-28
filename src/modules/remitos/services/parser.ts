import { ParsedRemito, RemitoData } from '../types';

/**
 * Parses the raw text returned by Gemini Vision into structured remito data.
 *
 * Expected format (one field per line, in any order):
 *   Cliente: [name]
 *   Dir: [address]
 *   Bultos: [number]
 *
 * Any field that is missing or unparseable is omitted from the result
 * and an entry is added to the errors array.
 */
export function parseRemitoText(rawText: string): ParsedRemito {
    console.log(`[Remitos Parser] Parsing Gemini response (${rawText.length} chars)`);

    const data: RemitoData = {};
    const errors: string[] = [];

    const lines = rawText
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

    let clientFound = false;
    let addressFound = false;
    let packagesFound = false;

    for (const line of lines) {
        // Cliente: ...
        const clientMatch = line.match(/^Cliente:\s*(.+)$/i);
        if (clientMatch) {
            const value = clientMatch[1].trim();
            if (value) {
                data.clientName = value;
                clientFound = true;
                console.log(`[Remitos Parser] Client extracted: "${value}"`);
            }
            continue;
        }

        // Dir: ...
        const addressMatch = line.match(/^Dir:\s*(.+)$/i);
        if (addressMatch) {
            const value = addressMatch[1].trim();
            if (value) {
                data.address = value;
                addressFound = true;
                console.log(`[Remitos Parser] Address extracted: "${value}"`);
            }
            continue;
        }

        // Bultos: ...
        const packagesMatch = line.match(/^Bultos:\s*(\d+)$/i);
        if (packagesMatch) {
            data.packages = parseInt(packagesMatch[1], 10);
            packagesFound = true;
            console.log(`[Remitos Parser] Packages extracted: ${data.packages}`);
            continue;
        }

        // Non-empty line that matched nothing — Gemini added unexpected text
        console.log(`[Remitos Parser] Unrecognised line: "${line}"`);
    }

    if (!clientFound)   errors.push("No se pudo identificar el cliente en el remito");
    if (!addressFound)  errors.push("No se pudo identificar la dirección en el remito");
    if (!packagesFound) errors.push("No se pudo identificar la cantidad de bultos en el remito");

    console.log(
        `[Remitos Parser] Parse complete — errors: [${errors.join(', ') || 'none'}]`,
    );

    return { data, errors };
}

/**
 * Returns true if a parsed remito has any errors.
 */
export function hasErrors(remito: ParsedRemito): boolean {
    return remito.errors.length > 0;
}