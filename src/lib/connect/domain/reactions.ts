// Contrato compartido por cliente y servidor.
// Este módulo no puede convertirse en Server Action: la UI necesita iterar
// estos valores durante el render.
export const SUPPORTED_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

export type SupportedEmoji = (typeof SUPPORTED_EMOJIS)[number];
