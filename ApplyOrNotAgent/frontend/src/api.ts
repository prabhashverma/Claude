import type { ChatMessage, Employer, SSEEvent } from './types';

export async function fetchStats(): Promise<Record<string, unknown>> {
  const res = await fetch('/api/stats');
  return res.json();
}

export async function searchEmployers(q: string, limit = 50): Promise<Employer[]> {
  const res = await fetch(`/api/employer-search?q=${encodeURIComponent(q)}&limit=${limit}`);
  return res.json();
}

export async function* streamChat(
  messages: { role: string; content: string }[]
): AsyncGenerator<SSEEvent> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });

  if (!res.ok) {
    throw new Error(`Chat API error: ${res.status}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    let currentEvent = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ') && currentEvent) {
        try {
          const data = JSON.parse(line.slice(6));
          yield { event: currentEvent, data };
        } catch {
          // skip malformed JSON
        }
        currentEvent = '';
      }
    }
  }
}

/** Build the messages array for multi-turn context */
export function buildMessages(
  history: ChatMessage[],
  newMessage: string
): { role: string; content: string }[] {
  const msgs: { role: string; content: string }[] = [];
  for (const msg of history) {
    if (msg.role === 'user') {
      msgs.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'assistant' && msg.explanation) {
      // Send a compact summary for context
      msgs.push({
        role: 'assistant',
        content: JSON.stringify({
          explanation: msg.explanation,
          sql: msg.sql,
          resultType: msg.resultType,
          rowCount: msg.rowCount,
        }),
      });
    }
  }
  msgs.push({ role: 'user', content: newMessage });
  return msgs;
}
