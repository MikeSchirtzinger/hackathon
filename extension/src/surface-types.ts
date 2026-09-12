import type { CardKind } from './cards';
// This is the complete page projection. No saved record IDs, URLs, keys or workspace state.
export interface SurfaceCard { kind: CardKind; title: string; body: string; meta?: string; actions: ('join' | 'review')[]; expiresAt: number; listening?: boolean }
export interface SurfaceAuthorization { tabId: number; documentId: string; url: string }
export interface SurfaceLease extends SurfaceAuthorization { nonce: string; payload: SurfaceCard; meetingId?: string; signalId?: string; frameId?: number; frameDocumentId?: string; shown?: boolean }
