// Mock client database — replace with real lookup as needed
const VALID_CLIENTS = new Set(["Cliente Valido", "Cliente Valido 2"]);

interface Package {
    length: number;
    width: number;
    height: number;
    quantity: number;
}

interface Delivery {
    client: string;
    packages: Package[];
    error?: string;
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

/**
 * Parses a delivery message sent by a driver.
 *
 * The driver optionally includes a client name on its own line before the
 * package measurements. The parser groups measurements under the most
 * recently seen client name, validates it against the database, and
 * attaches an error when validation fails.
 */
export function parseDeliveryMessage(message: string): Delivery[] {
    const lines = message.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

    const deliveries: Delivery[] = [];
    let currentDelivery: Delivery | null = null;

    for (const line of lines) {
        const pkg = parseMeasurementLine(line);

        if (pkg) {
            // Measurement line — attach to current delivery (or create anonymous one)
            if (!currentDelivery) {
                currentDelivery = {
                    client: "Desconocido",
                    packages: [],
                    error: "No se encontró un cliente válido en el mensaje",
                };
                deliveries.push(currentDelivery);
            }
            currentDelivery.packages.push(pkg);
        } else {
            // Non-measurement line → treat as a client name
            const clientName = line;
            const isValid = VALID_CLIENTS.has(clientName);

            currentDelivery = {
                client: clientName,
                packages: [],
                ...(isValid ? {} : { error: "Cliente no encontrado en la base de datos" }),
            };
            deliveries.push(currentDelivery);
        }
    }

    return deliveries;
}