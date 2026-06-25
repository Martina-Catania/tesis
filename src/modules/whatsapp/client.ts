import { GraphApi } from './graph-api';
import { Message, RawMessage } from './message';
import { Status, RawStatus } from './status';
import { Cache } from '../../shared/utils';
import { handleMeasurementMessage } from '../bultos/controllers';

export class Conversation {
	static async handleMessage(
		senderPhoneNumberId: string,
		rawMessage: RawMessage,
	): Promise<void> {
		const message = new Message(rawMessage);

		switch (message.type) {
			case 'text': {
				await handleMeasurementMessage(senderPhoneNumberId, message);
				break;
			}

			case 'image': {
				try {
					// 1. Get the media ID from the message (your Message class
					//    should expose this — see note below)
					const mediaId = message.imageId as string;

					// 2. Resolve the temporary download URL from WhatsApp
					const mediaUrl = await GraphApi.getMediaUrl(mediaId);

					// 3. Download the raw image bytes
					const imageBuffer = await GraphApi.downloadMedia(mediaUrl);

					// 4. Send to OpenAI Vision and get extracted data
					// const extractedData = await extractDataFromImage(imageBuffer);
					// console.log('Extracted image data:', extractedData);
					const extractedData = 'Placeholder.';
					// 5. Reply to the user with the result
					await GraphApi.sendTextMessage(
						message.id,
						senderPhoneNumberId,
						message.senderPhoneNumber,
						`${extractedData}`,
					);
				} catch (error) {
					console.error('Error processing image:', error);
					await GraphApi.sendTextMessage(
						message.id,
						senderPhoneNumberId,
						message.senderPhoneNumber,
						'Sorry, I had trouble processing your image. Please try again.',
					);
				}
				break;
			}

			default:
				await GraphApi.sendTextMessage(
					message.id,
					senderPhoneNumberId,
					message.senderPhoneNumber,
					'Sorry, I can only process text and image messages for now.',
				);
				break;
		}
	}

	static async handleStatus(
		senderPhoneNumberId: string,
		rawStatus: RawStatus,
	): Promise<void> {
		const status = new Status(rawStatus);

		if (status.status !== 'delivered' && status.status !== 'read') {
			return;
		}

		if (await Cache.remove(status.messageId)) {
			await GraphApi.sendTextMessage(
				undefined,
				senderPhoneNumberId,
				status.recipientPhoneNumber,
				'Sorry, I can only process text and image messages for now.',
			);
		}
	}
}