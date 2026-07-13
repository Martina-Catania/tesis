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
 * The step we are waiting on from the driver in the remito interactive flow:
 *
 * - 'confirm_data':    driver reviews parsed fields (client, address, packages)
 *                      and confirms or rejects before anything is saved
 * - 'confirm_address': awaiting yes/no on whether an unknown address is valid
 * - 'select_zone':     awaiting zone selection after the driver accepted the address
 */
export type PendingAddressStep = 'confirm_data' | 'confirm_address' | 'select_zone';

/**
 * State stored in the Cache while waiting for a driver's interactive reply.
 * Keyed by the outgoing message ID that carried the interactive question.
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
    address?: string;
    packages?: number;
    clientId?: number;
    errors: string[];
}

// ─── Bultos Pending State ─────────────────────────────────────────────────────

/**
 * State stored in Cache while waiting for the driver to confirm a parsed
 * bultos delivery message before it is saved.
 */
export interface PendingBultosConfirmation {
    phoneNumberId: string;
    driverPhoneNumber: string;
    rawMessage: string;
    date: Date;

    // Each delivery in the message, serialised for storage
    deliveries: Array<{
        client: string;
        packages: Package[];
        errors: string[];
        // resolved client id — undefined if client was not found in DB
        clientId?: number;
        periodId?: number;
    }>;
}