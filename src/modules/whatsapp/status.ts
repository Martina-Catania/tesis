// Raw shape of the webhook status payload from Meta
export interface RawStatus {
  id: string;
  status: string;
  recipient_id: string;
}

export type DeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed' | string;

export class Status {
  /** The message ID this status update refers to */
  messageId: string;

  /** The delivery status (sent, delivered, read, failed, …) */
  status: DeliveryStatus;

  /** The recipient's phone number */
  recipientPhoneNumber: string;

  constructor(rawStatus: RawStatus) {
    this.messageId = rawStatus.id;
    this.status = rawStatus.status;
    this.recipientPhoneNumber = rawStatus.recipient_id;
  }
}