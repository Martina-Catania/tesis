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

// ─── Interactive Reply / Pending State Types ──────────────────────────────────

/**
 * The zone options that match the Zone enum in the Prisma schema.
 * Used when creating a new address discovered via a remito.
 */
export type AddressZone = 'CABA' | 'AMBA_1' | 'AMBA_2' | 'AMBA_3';

/**
 * The step we are waiting on from the driver for a pending address confirmation.
 *
 * - 'confirm_address': awaiting a yes/no on whether the unknown address is valid
 * - 'select_zone':     awaiting zone selection after the driver confirmed the address
 */
export type PendingAddressStep = 'confirm_address' | 'select_zone';

/**
 * State stored in the Cache while waiting for a driver's interactive reply
 * about an unrecognised address found on a remito.
 *
 * Keyed by the outgoing message ID that carried the interactive question
 * (available via Cache.set / Cache.get with that message ID).
 */
export interface PendingAddressConfirmation {
    step: PendingAddressStep;

    // Originating phone number, needed to reply in subsequent turns
    phoneNumberId: string;
    driverPhoneNumber: string;

    // The full parsed remito data, preserved so we can save it once resolved
    date: Date;
    rawText: string;
    clientName?: string;
    address: string;       // guaranteed non-empty — we only reach this state when address was extracted
    packages?: number;
    clientId: number;      // guaranteed — we only reach this state when client was resolved
    errors: string[];      // non-address errors already present at time of discovery
}