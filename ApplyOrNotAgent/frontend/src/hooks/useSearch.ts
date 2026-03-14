import { useState, useRef, useCallback } from 'react';
import type { Employer } from '../types';
import { searchEmployers } from '../api';

export function useSearch() {
  const [query, setQueryState] = useState('');
  const [results, setResults] = useState<Employer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const setQuery = useCallback((q: string) => {
    setQueryState(q);
    if (timerRef.current) clearTimeout(timerRef.current);

    if (q.trim().length < 2) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    timerRef.current = setTimeout(async () => {
      try {
        const data = await searchEmployers(q.trim());
        setResults(data);
      } catch {
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    }, 300);
  }, []);

  const clearSearch = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setQueryState('');
    setResults([]);
    setIsLoading(false);
  }, []);

  return { query, results, isLoading, setQuery, clearSearch };
}
