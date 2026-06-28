// ─── Package Types ───────────────────────────────────────────────────────────

export interface Package {
    length: number;
    width: number;
    height: number;
    quantity: number;
}

// ─── Delivery Types (Bultos) ─────────────────────────────────────────────────

export interface Delivery {
    client: string;
    packages: Package[];
    errors: string[];
}

export interface DeliveryInput {
    clientId: number;
    date: Date;
    periodId?: number;
    packages: Package[];
}

export interface DeliveryErrorInput {
    rawMessage: string;
    date: Date;
    clientName?: string;
    clientId?: number;
    packages?: Package[];
    errors: string[];
}

// ─── Message Types ───────────────────────────────────────────────────────────

export interface DeliveryMessage {
    date: Date;
    deliveries: Delivery[];
}

// ─── Remito Types ────────────────────────────────────────────────────────────

/**
 * Structured data extracted from a remito image by Gemini Vision.
 * All fields are optional since OCR may fail to identify any of them.
 */
export interface RemitoData {
    clientName?: string;
    address?: string;
    packages?: number;
}

/**
 * The result of parsing Gemini's raw text response.
 * Carries the extracted data alongside any errors that occurred.
 */
export interface ParsedRemito {
    data: RemitoData;
    errors: string[];
}

/**
 * Input for persisting a successfully parsed remito.
 */
export interface RemitoInput {
    date: Date;
    rawText: string;
    clientName?: string;
    address?: string;
    packages?: number;
    clientId?: number;
    addressId?: number;
}

/**
 * Input for persisting a remito that could not be fully parsed.
 */
export interface RemitoErrorInput {
    date: Date;
    rawText?: string;
    clientName?: string;
    address?: string;
    packages?: number;
    errors: string[];
}