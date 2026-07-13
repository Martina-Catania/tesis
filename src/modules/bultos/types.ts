// ─── Package Types ───────────────────────────────────────────────────────────

export interface Package {
    length: number;
    width: number;
    height: number;
    quantity: number;
}

// ─── Delivery Types ──────────────────────────────────────────────────────────

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

// ─── Pending Confirmation ─────────────────────────────────────────────────────

/**
 * State stored in Cache while waiting for the driver to confirm a parsed
 * bultos delivery message before it is saved to the database.
 * Keyed by the outgoing interactive message ID.
 */
export interface PendingBultosConfirmation {
    phoneNumberId: string;
    driverPhoneNumber: string;
    rawMessage: string;
    date: Date;

    deliveries: Array<{
        client: string;
        packages: Package[];
        errors: string[];
        clientId?: number;
        periodId?: number;
    }>;
}