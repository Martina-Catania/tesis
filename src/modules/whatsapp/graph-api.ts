import * as facebookNodejsBusinessSdk from 'facebook-nodejs-business-sdk';
import FormData from 'form-data';
import { config } from '../../shared/utils';

const { FacebookAdsApi } = facebookNodejsBusinessSdk;
const token = config.accessToken as string;
const api = new FacebookAdsApi(token);

// ─── Option types for template methods ───────────────────────────────────────

export interface MediaCardCarouselOptions {
  templateName: string;
  locale: string;
  imageLinks: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalizes recipient phone numbers to prevent crashes on AR/MX/BR numbers.
 * Meta does not consider this a bug and does not plan to fix it.
 */
function normalizeRecipientPhoneNumber(phoneNumber: string | undefined): string | undefined {
  if (!phoneNumber) return phoneNumber;

  const digitsOnly = String(phoneNumber).replace(/\D/g, '');
  if (digitsOnly.startsWith('549')) {
    return '54' + digitsOnly.slice(3);
  }

  return digitsOnly;
}

/**
 * Trims the description of an interactive list item to 72 characters, as required by Meta's API.
 * If the description is longer than 72 characters, it will be truncated and suffixed with "...".
 * If the description is undefined or shorter than 72 characters, it will be returned as-is.
 */
function trimInteractiveListDescription(description: string | undefined): string | undefined {
  if (!description) {
    return description;
  }

  return description.length > 72 ? `${description.slice(0, 69)}...` : description;
}

// ─── API class ───────────────────────────────────────────────────────────────

export class GraphApi {
  static async #makeApiCall(
    messageId: string | undefined,
    senderPhoneNumberId: string,
    requestBody: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      // Mark as read and show a typing indicator
      if (messageId) {
        const typingBody = {
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
          typing_indicator: { type: 'text' },
        };

        await api.call('POST', [`${senderPhoneNumberId}`, 'messages'], typingBody);
      }

      const normalizedBody = { ...requestBody };
      if (typeof normalizedBody.to === 'string') {
        normalizedBody.to = normalizeRecipientPhoneNumber(normalizedBody.to);
      }

      const response = await api.call(
        'POST',
        [`${senderPhoneNumberId}`, 'messages'],
        normalizedBody,
      );
      console.log('API call successful:', response);
      return response;
    } catch (error) {
      console.error('Error making API call:', error);
      throw error;
    }
  }

  static async sendTextMessage(
    messageId: string | undefined,
    senderPhoneNumberId: string,
    recipientPhoneNumber: string,
    text: string,
  ): Promise<unknown> {
    const requestBody = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipientPhoneNumber,
      type: 'text',
      text: { body: text },
    };

    return this.#makeApiCall(messageId, senderPhoneNumberId, requestBody);
  }

  static async messageWithInteractiveReply(
    messageId: string | undefined,
    senderPhoneNumberId: string,
    recipientPhoneNumber: string,
    messageText: string,
    replyCTAs: Array<{ id: string; title: string }>,
  ): Promise<unknown> {
    const requestBody = {
      messaging_product: 'whatsapp',
      to: recipientPhoneNumber,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: messageText },
        action: {
          buttons: replyCTAs.map(cta => ({
            type: 'reply',
            reply: { id: cta.id, title: cta.title },
          })),
        },
      },
    };

    return this.#makeApiCall(messageId, senderPhoneNumberId, requestBody);
  }

  /**
   * Sends a list-picker interactive message (supports more than 3 options,
   * unlike reply buttons which are capped at 3).
   */
  static async messageWithInteractiveList(
    messageId: string | undefined,
    senderPhoneNumberId: string,
    recipientPhoneNumber: string,
    messageText: string,
    buttonLabel: string,
    sections: Array<{
      title: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    }>,
  ): Promise<unknown> {
    const normalizedSections = sections.map(section => ({
      ...section,
      rows: section.rows.map(row => ({
        ...row,
        description: trimInteractiveListDescription(row.description),
      })),
    }));

    const requestBody = {
      messaging_product: 'whatsapp',
      to: recipientPhoneNumber,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: messageText },
        action: {
          button: buttonLabel,
          sections: normalizedSections,
        },
      },
    };

    return this.#makeApiCall(messageId, senderPhoneNumberId, requestBody);
  }

  static async getMediaUrl(mediaId: string): Promise<string> {
    const response = await api.call('GET', [mediaId], {}) as { url: string };
    return response.url;
  }

  static async downloadMedia(mediaUrl: string): Promise<Buffer> {
    const response = await fetch(mediaUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Failed to download media: ${response.statusText}`);
    return Buffer.from(await response.arrayBuffer());
  }
}