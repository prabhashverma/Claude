import { useState } from 'react';
import { StatBar } from './components/StatBar';
import { ChatPanel } from './components/ChatPanel';
import { ChatInput } from './components/ChatInput';
import { SearchPage } from './components/SearchPage';
import { BottomNav } from './components/BottomNav';
import { useChat } from './hooks/useChat';

type Tab = 'search' | 'chat';

export default function App() {
  const [tab, setTab] = useState<Tab>('search');
  const { messages, isStreaming, sendMessage, clearMessages } = useChat();

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-gradient-to-br from-slate-900 via-[#1e3a5f] to-blue-600 px-5 py-4 text-center relative overflow-hidden shrink-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_0%,rgba(59,130,246,0.3)_0%,transparent_60%),radial-gradient(ellipse_at_70%_100%,rgba(99,102,241,0.2)_0%,transparent_50%)] pointer-events-none" />
        <div className="relative z-10">
          <div className="flex items-center justify-center gap-3">
            <h1 className="text-2xl font-extrabold text-white tracking-tight">GreenCardTracker</h1>
            {tab === 'chat' && messages.length > 0 && (
              <button
                onClick={clearMessages}
                className="text-xs text-white/50 hover:text-white/80 border border-white/20 px-2 py-0.5 rounded transition-colors cursor-pointer"
              >
                New chat
              </button>
            )}
          </div>
          <p className="text-white/70 text-sm mt-1">
            Ask anything about 3M+ Green Card & H-1B immigration filings
          </p>
          <StatBar />
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto px-4 pb-14">
        {tab === 'search' ? (
          <SearchPage />
        ) : (
          <>
            <div className="max-w-3xl mx-auto">
              <ChatPanel messages={messages} onSuggestedSelect={sendMessage} />
            </div>
            <ChatInput onSend={sendMessage} disabled={isStreaming} />
          </>
        )}
      </main>

      <BottomNav tab={tab} onTabChange={setTab} />
    </div>
  );
}
