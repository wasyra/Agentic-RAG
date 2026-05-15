import { ChatApp } from "@/components/chat-app";

export default function Home() {
  return (
    <div className="agentic-studio-shell flex h-dvh max-h-dvh min-h-0 w-full max-w-[100dvw] flex-col overflow-hidden">
      <ChatApp />
    </div>
  );
}
