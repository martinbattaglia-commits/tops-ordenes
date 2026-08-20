export const CONNECT_READ_STATE_EVENT = "nexus:connect-read-state-changed";

export type ConnectReadStateDetail = { conversationId: string; upToSeq: number };

export function publishConnectReadState(conversationId: string, upToSeq: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ConnectReadStateDetail>(CONNECT_READ_STATE_EVENT, {
      detail: { conversationId, upToSeq },
    }),
  );
}
