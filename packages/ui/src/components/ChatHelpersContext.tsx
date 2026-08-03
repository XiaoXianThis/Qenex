import { createContext, useContext, type ReactNode } from "react";
import type { UseChatHelpers } from "@ai-sdk/react";
import type { UIMessage } from "ai";

export type QenexChatHelpers = UseChatHelpers<UIMessage>;

const ChatHelpersContext = createContext<QenexChatHelpers | null>(null);

export function ChatHelpersProvider({
  chat,
  children,
}: {
  chat: QenexChatHelpers;
  children: ReactNode;
}) {
  return (
    <ChatHelpersContext.Provider value={chat}>
      {children}
    </ChatHelpersContext.Provider>
  );
}

/** Live useChat helpers from AgentRuntimeProvider (AI SDK path). */
export function useChatHelpers(): QenexChatHelpers | null {
  return useContext(ChatHelpersContext);
}
