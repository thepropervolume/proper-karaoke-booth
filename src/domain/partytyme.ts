import type { KaraFunAccountStatus, KaraFunPreparation } from './karafun';
/** Host-facing values deliberately omit account details, tokens and media URLs. */
export type PartyTymeStatus = KaraFunAccountStatus & {
    premium: boolean;
};
export type PartyTymeSong = {
    videoId: string;
    title: string;
    artist: string;
    durationSeconds: number | null;
    explicit: boolean | null;
};
export type PartyTymeSearchReply = {
    status: 'ok' | 'disconnected' | 'unavailable';
    searchId?: string;
    songs: PartyTymeSong[];
    message?: string;
};
export type PartyTymeBridge = {
    status(): Promise<PartyTymeStatus>;
    signIn(): Promise<PartyTymeStatus>;
    signOut(): Promise<PartyTymeStatus>;
    search(query: string): Promise<PartyTymeSearchReply>;
    request(input: {
        searchId: string;
        videoId: string;
        singerId: string | null;
        requestId: string;
    }): Promise<{
        ok: boolean;
        versionId?: string;
        error?: string;
        notice?: string;
    }>;
    preparations(): Promise<KaraFunPreparation[]>;
    retry(versionId: string): Promise<void>;
    subscribe(callback: (value: PartyTymeStatus) => void): () => void;
};
