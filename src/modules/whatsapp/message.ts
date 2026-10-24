// Raw shape of the webhook message payload from Meta
export interface RawMessage {
  id: string;
  from: string;
  type: string;
  text?: { body: string };
  image?: { id: string; caption?: string };
  document?: { id: string; filename?: string; mime_type?: string };
  interactive?: {
    type: 'button_reply' | 'list_reply';
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string };
  };
  context?: { id: string };
}

export type MessageType = 'text' | 'image' | 'document' | 'interactive' | 'unknown' | string;

export class Message {
  id: string;
  senderPhoneNumber: string;
  type: MessageType;
  text?: string;
  imageId?: string | null;
  caption?: string | null;
  documentId?: string | null;
  documentFilename?: string | null;
  documentMimeType?: string | null;
  contextMessageId?: string;
  interactiveReplyId?: string;

  constructor(rawMessage: RawMessage) {
    this.id = rawMessage.id;
    this.senderPhoneNumber = rawMessage.from;

    const type = rawMessage.type;

    if (type === 'text') {
      this.type = 'text';
      this.text = rawMessage.text?.body ?? '';
    } else if (type === 'image') {
      this.type = 'image';
      this.imageId = rawMessage.image?.id ?? null;
      this.caption = rawMessage.image?.caption ?? null;
    } else if (type === 'document') {
      this.type = 'document';
      this.documentId       = rawMessage.document?.id ?? null;
      this.documentFilename = rawMessage.document?.filename ?? null;
      this.documentMimeType = rawMessage.document?.mime_type ?? null;
    } else if (type === 'interactive') {
      this.type = 'interactive';
      this.contextMessageId = rawMessage.context?.id;
      const interactive = rawMessage.interactive!;
      this.interactiveReplyId =
        interactive.button_reply?.id ?? interactive.list_reply?.id;
    } else {
      this.type = 'unknown';
    }
  }
}