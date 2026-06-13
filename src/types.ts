export interface User {
  id: number;
  username: string;
  publicKey?: string;
  avatarUrl?: string;
  lastSeen?: string;
}

export interface Attachment {
  type: 'image' | 'video' | 'audio' | 'file';
  url: string;
  name: string;
}

export interface Message {
  id: number;
  senderId: number;
  receiverId: number;
  content: string;
  isEncrypted: boolean;
  timestamp: string;
  attachment?: Attachment;
  replyToId?: number;
}

export interface TokenDecoded {
  id: number;
  username: string;
}
