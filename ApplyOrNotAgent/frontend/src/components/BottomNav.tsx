type Tab = 'search' | 'chat';

interface BottomNavProps {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
}

export function BottomNav({ tab, onTabChange }: BottomNavProps) {
  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 bg-white border-t border-gray-200 pb-[env(safe-area-inset-bottom)]">
      <div className="flex h-14">
        <button
          onClick={() => onTabChange('search')}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
            tab === 'search' ? 'text-blue-600' : 'text-gray-400'
          }`}
        >
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span className="text-[11px] font-medium">Search</span>
        </button>
        <button
          onClick={() => onTabChange('chat')}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
            tab === 'chat' ? 'text-blue-600' : 'text-gray-400'
          }`}
        >
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
          <span className="text-[11px] font-medium">Chat</span>
        </button>
      </div>
    </nav>
  );
}
