import * as facebookNodejsBusinessSdk from 'facebook-nodejs-business-sdk';
import { config } from '../../shared';

const { FacebookAdsApi } = facebookNodejsBusinessSdk;
const token = config.accessToken as string;
const api = new FacebookAdsApi(token);

// ─── Option types for template methods ───────────────────────────────────────

export interface UtilityTemplateOptions {
  templateName: string;
  locale: string;
  imageLink: string;
}

export interface LimitedTimeOfferTemplateOptions {
  templateName: string;
  locale: string;
  imageLink: string;
  offerCode: string;
}

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

  static async messageWithUtilityTemplate(
    messageId: string | undefined,
    senderPhoneNumberId: string,
    recipientPhoneNumber: string,
    options: UtilityTemplateOptions,
  ): Promise<unknown> {
    const { templateName, locale, imageLink } = options;
    const requestBody = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipientPhoneNumber,
      type: 'template',
      template: {
        name: templateName,
        language: { code: locale },
        components: [
          {
            type: 'header',
            parameters: [{ type: 'image', image: { link: imageLink } }],
          },
        ],
      },
    };

    return this.#makeApiCall(messageId, senderPhoneNumberId, requestBody);
  }

  static async messageWithLimitedTimeOfferTemplate(
    messageId: string | undefined,
    senderPhoneNumberId: string,
    recipientPhoneNumber: string,
    options: LimitedTimeOfferTemplateOptions,
  ): Promise<unknown> {
    const { templateName, locale, imageLink, offerCode } = options;
    const futureTime = new Date(Date.now() + 48 * 60 * 60 * 1000);

    const requestBody = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipientPhoneNumber,
      type: 'template',
      template: {
        name: templateName,
        language: { code: locale },
        components: [
          {
            type: 'header',
            parameters: [{ type: 'image', image: { link: imageLink } }],
          },
          {
            type: 'limited_time_offer',
            parameters: [
              {
                type: 'limited_time_offer',
                limited_time_offer: { expiration_time_ms: futureTime.getTime() },
              },
            ],
          },
          {
            type: 'button',
            sub_type: 'copy_code',
            index: 0,
            parameters: [{ type: 'coupon_code', coupon_code: offerCode }],
          },
        ],
      },
    };

    return this.#makeApiCall(messageId, senderPhoneNumberId, requestBody);
  }

  static async messageWithMediaCardCarousel(
    messageId: string | undefined,
    senderPhoneNumberId: string,
    recipientPhoneNumber: string,
    options: MediaCardCarouselOptions,
  ): Promise<unknown> {
    const { templateName, locale, imageLinks } = options;
    const requestBody = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipientPhoneNumber,
      type: 'template',
      template: {
        name: templateName,
        language: { code: locale },
        components: [
          {
            type: 'carousel',
            cards: imageLinks.map((imageLink, idx) => ({
              card_index: idx,
              components: [
                {
                  type: 'header',
                  parameters: [{ type: 'image', image: { link: imageLink } }],
                },
              ],
            })),
          },
        ],
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