import { findClient } from '../../../shared/db/client';
import { Package, Delivery, DeliveryMessage } from '../types';

const DAY_NAMES: Record<string, number> = {
    "lunes": 1,
    "martes": 2,
    "miércoles": 3,
    "miercoles": 3,
    "jueves": 4,
    "viernes": 5,
    "sábado": 6,
    "sabado": 6,
    "domingo": 0,
};

// Returns the most recent occurrence of the given day of the week (0 = Sunday, 1 = Monday, ..., 6 = Saturday).
// If today is the target day, returns today.
function lastOccurrenceOfDay(targetDay: number): Date {
    const today = new Date();
    const currentDay = today.getDay();
    const daysAgo = (currentDay - targetDay + 7) % 7; // Calculate how many days ago the target day was
    const result = new Date(today);
    result.setDate(today.getDate() - daysAgo);
    return result;
}

/**
 * Tries to parse a line as a date.
 *
 * Supported formats:
 *   1. "Viernes", "lunes", etc.
 *   2. "DD/MM" or "DD/MM/YYYY"
 *
 * Returns a Date if matched, null otherwise.
 */
function parseDateLine(line: string): Date | null {
    // Day name
    const dayName = line.trim().toLowerCase();
    if (dayName in DAY_NAMES) {
        return lastOccurrenceOfDay(DAY_NAMES[dayName]);
    }

    // Numeric date: DD/MM or DD/MM/YYYY
    const match = line.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
    if (match) {
        const day = parseInt(match[1], 10);
        const month = parseInt(match[2], 10) - 1;
        const year = match[3] ? parseInt(match[3], 10) : new Date().getFullYear();

        const date = new Date(year, month, day);
        if (date.getDate() !== day || date.getMonth() !== month) return null;
        return date;
    }

    return null;
}

/**
 * Tries to parse a line as a package measurement.
 *
 * Supported formats:
 *   1. "LxWxH"         → quantity defaults to 1
 *   2. "Qty LxWxH"     → quantity before the dimensions
 *   3. "LxWxH Qty"     → quantity after the dimensions
 *
 * Returns a Package on success, or null if the line is not a measurement.
 */
function parseMeasurementLine(line: string): Package | null {
    line = line.trim();

    // qty first - "10x10x20x30" or "10 10x20x30"
    const qtyFirst = line.match(/^(\d+)(?:\s+|x)(\d+)x(\d+)x(\d+)$/);
    if (qtyFirst) {
        return {
            quantity: parseInt(qtyFirst[1], 10),
            length: parseInt(qtyFirst[2], 10),
            width: parseInt(qtyFirst[3], 10),
            height: parseInt(qtyFirst[4], 10),
        };
    }

    // qty last - "10x20x30 10"
    const qtyLast = line.match(/^(\d+)x(\d+)x(\d+)\s+(\d+)$/);
    if (qtyLast) {
        return {
            length: parseInt(qtyLast[1], 10),
            width: parseInt(qtyLast[2], 10),
            height: parseInt(qtyLast[3], 10),
            quantity: parseInt(qtyLast[4], 10),
        };
    }

    // only one package - "10x20x30"
    const dims = line.match(/^(\d+)x(\d+)x(\d+)$/);
    if (dims) {
        return {
            length: parseInt(dims[1], 10),
            width: parseInt(dims[2], 10),
            height: parseInt(dims[3], 10),
            quantity: 1,
        };
    }

    return null;
}

// Returns true if a line looks like a measurement (contains only digits, x's, and whitespace).
function looksLikeMeasurement(line: string): boolean {
    return /^[\dx\s]+$/i.test(line);
}

// Returns true if a delivery has any errors.
export function hasErrors(delivery: Delivery): boolean {
    return delivery.errors.length > 0;
}

/**
 * Parses a delivery message sent by a driver.
 *
 * The driver optionally includes a date on its own line, either as:
 *   - A Spanish day name (e.g. "Viernes") → resolves to the most recent occurrence of that day
 *   - A numeric date (e.g. "05/06" or "05/06/2025")
 * If no date is found, the current date is used.
 *
 * Client names are validated against the database via findClient.
 * Invalid or missing client names are recorded in the delivery's errors array.
 */
export async function parseDeliveryMessage(prisma: any, message: string): Promise<DeliveryMessage> {
    const lines = message.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    console.log(`[Bultos Parser] Parsing delivery message: ${lines.length} lines`);

    let date: Date | null = null;
    const deliveries: Delivery[] = [];
    let currentDelivery: Delivery | null = null;

    for (const line of lines) {
        const parsedDate = parseDateLine(line);
        if (parsedDate) {
            date = parsedDate;
            console.log(`[Bultos Parser] Date parsed from line "${line}": ${date.toISOString()}`);
            continue;
        }

        const pkg = parseMeasurementLine(line);

        if (pkg) {
            if (!currentDelivery) {
                // Measurements before any client name — collect them in a
                // temporary anonymous delivery that will be finalised below.
                console.log(`[Bultos Parser] Package line encountered before any client: "${line}", deferring to anonymous delivery`);
                currentDelivery = {
                    client: "Desconocido",
                    packages: [],
                    errors: ["No se encontró un cliente válido en el mensaje"],
                };
                deliveries.push(currentDelivery);
            }
            console.log(`[Bultos Parser] Package parsed from line "${line}": ${pkg.quantity}x ${pkg.length}x${pkg.width}x${pkg.height}`);
            currentDelivery.packages.push(pkg);
        } else if (looksLikeMeasurement(line)) {
            if (!currentDelivery) {
                currentDelivery = {
                    client: "Desconocido",
                    packages: [],
                    errors: [],
                };
                deliveries.push(currentDelivery);
            }
            console.log(`[Bultos Parser] Invalid measurement line: "${line}"`);
            currentDelivery.errors.push(`Medición inválida: "${line}"`);
        } else {
            const clientName = line;
            const found = await findClient(prisma, clientName);

            if (!found) {
                console.log(`[Bultos Parser] Client not recognised: "${clientName}"`);
            }

            currentDelivery = {
                client: clientName,
                packages: [],
                errors: found ? [] : ["Cliente no encontrado en la base de datos"],
            };
            deliveries.push(currentDelivery);
        }
    }

    // A delivery is only relevant if it has at least one package, OR if a
    // measurement line was attempted but failed to parse (i.e. errors that are
    // not solely "client not found" / "no valid client").  A bare client name
    // with no measurements — recognised or not — means the message was not
    // intended for this service.
    const CLIENT_ONLY_ERRORS = new Set([
        "Cliente no encontrado en la base de datos",
        "No se encontró un cliente válido en el mensaje",
    ]);
    const relevantDeliveries = deliveries.filter(
        (d) =>
            d.packages.length > 0 ||
            d.errors.some((e) => !CLIENT_ONLY_ERRORS.has(e)),
    );

    // Normalize date by zeroing milliseconds to avoid
    // flakiness in tests that compare Date equality or ISO strings.
    const finalDate = date ?? new Date();
    finalDate.setMilliseconds(0);

    const result: DeliveryMessage = {
        date: finalDate,
        deliveries: relevantDeliveries,
    };
    console.log(`[Bultos Parser] Parsing complete: ${relevantDeliveries.length} deliveries, date: ${result.date.toISOString()}`);
    return result;
}