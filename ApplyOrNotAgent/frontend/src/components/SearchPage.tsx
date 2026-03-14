import { useSearch } from '../hooks/useSearch';
import { EmployerCard } from './EmployerCard';

export function SearchPage() {
  const { query, results, isLoading, setQuery, clearSearch } = useSearch();

  return (
    <div className="max-w-3xl mx-auto py-4">
      {/* Search input */}
      <div className="relative mb-4">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search employers..."
          className="w-full pl-10 pr-10 py-3 rounded-xl border border-gray-300 bg-white text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        {query && (
          <button
            onClick={clearSearch}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 hover:text-gray-600"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* States */}
      {!query && (
        <div className="text-center text-gray-400 mt-16">
          <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <p className="text-lg font-medium">Search immigration filings</p>
          <p className="text-sm mt-1">Find employers by name to view their PERM & H-1B filings</p>
        </div>
      )}

      {isLoading && (
        <div className="flex justify-center mt-12">
          <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!isLoading && query.length >= 2 && results.length > 0 && (
        <>
          <p className="text-sm text-gray-500 mb-3">{results.length} employer{results.length !== 1 ? 's' : ''} found</p>
          {results.map(emp => (
            <EmployerCard
              key={emp.FEIN}
              name={emp.CANONICAL_NAME}
              city={emp.CITY}
              state={emp.STATE}
              numEmployees={emp.NUM_EMPLOYEES}
              variants={emp.NAME_VARIANTS}
              permCount={emp.FILING_COUNT}
              lcaCount={emp.LCA_FILING_COUNT}
              filings={emp.filings}
              lcaFilings={emp.lca_filings}
            />
          ))}
        </>
      )}

      {!isLoading && query.length >= 2 && results.length === 0 && (
        <div className="text-center text-gray-400 mt-12">
          <p className="text-lg font-medium">No employers found</p>
          <p className="text-sm mt-1">Try a different search term</p>
        </div>
      )}
    </div>
  );
}
