import { useState, useEffect, useCallback } from 'react';
import type { IntegrationEvent, IntegrationType, ResolutionStatus } from '../types';
import { fetchEventsPaginated } from '../api/client';
import type { SortField, SortOrder } from '../api/client';

const integrationLabels: Record<string, string> = {
  procore: 'Procore',
  gusto: 'Gusto',
  quickbooks: 'QuickBooks',
  stripe_issuing: 'Stripe Issuing',
  certified_payroll: 'Certified Payroll',
};

const integrationOptions: IntegrationType[] = [
  'procore',
  'gusto',
  'quickbooks',
  'stripe_issuing',
  'certified_payroll',
];

const statusColors: Record<string, string> = {
  success: 'bg-green-100 text-green-700',
  failure: 'bg-red-100 text-red-700',
  pending: 'bg-gray-100 text-gray-700',
};

const resolutionColors: Record<string, string> = {
  open: 'bg-red-100 text-red-700',
  acknowledged: 'bg-yellow-100 text-yellow-700',
  resolved: 'bg-green-100 text-green-700',
};

const severityColors: Record<string, string> = {
  low: 'bg-blue-100 text-blue-700',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

interface EventsViewProps {
  onEventClick: (event: IntegrationEvent) => void;
}

export function EventsView({ onEventClick }: EventsViewProps) {
  const [events, setEvents] = useState<IntegrationEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pagination
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  // Filters
  const [integrationFilter, setIntegrationFilter] = useState<IntegrationType | ''>('');
  const [statusFilter, setStatusFilter] = useState<'success' | 'failure' | ''>('');
  const [resolutionFilter, setResolutionFilter] = useState<ResolutionStatus | ''>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Sorting
  const [sortBy, setSortBy] = useState<SortField>('timestamp');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(0); // Reset to first page on search
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const loadEvents = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await fetchEventsPaginated({
        integration: integrationFilter || undefined,
        status: statusFilter || undefined,
        resolutionStatus: resolutionFilter || undefined,
        limit: pageSize,
        offset: page * pageSize,
        sortBy,
        sortOrder,
        search: debouncedSearch || undefined,
      });
      setEvents(result.events);
      setTotal(result.total);
      setError(null);
    } catch {
      setError('Failed to load events');
    } finally {
      setIsLoading(false);
    }
  }, [integrationFilter, statusFilter, resolutionFilter, pageSize, page, sortBy, sortOrder, debouncedSearch]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
    setPage(0);
  };

  const handleExportCSV = () => {
    // Fetch all events with current filters for export
    fetchEventsPaginated({
      integration: integrationFilter || undefined,
      status: statusFilter || undefined,
      resolutionStatus: resolutionFilter || undefined,
      limit: 10000, // Get all events
      offset: 0,
      sortBy,
      sortOrder,
      search: debouncedSearch || undefined,
    }).then((result) => {
      const csv = generateCSV(result.events);
      downloadCSV(csv, `events-export-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
    });
  };

  const totalPages = Math.ceil(total / pageSize);

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortBy !== field) {
      return <span className="text-gray-300 ml-1">↕</span>;
    }
    return <span className="text-blue-600 ml-1">{sortOrder === 'asc' ? '↑' : '↓'}</span>;
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4">
        <div className="space-y-3 sm:space-y-0 sm:flex sm:flex-wrap sm:items-center sm:gap-4">
          {/* Search */}
          <div className="w-full sm:flex-1 sm:min-w-[200px]">
            <input
              type="text"
              placeholder="Search events..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Filter row on mobile */}
          <div className="grid grid-cols-2 sm:flex gap-2 sm:gap-4">
            {/* Integration filter */}
            <select
              value={integrationFilter}
              onChange={(e) => { setIntegrationFilter(e.target.value as IntegrationType | ''); setPage(0); }}
              className="px-2 sm:px-3 py-2 border border-gray-300 rounded-lg text-xs sm:text-sm bg-white"
            >
              <option value="">All Integrations</option>
              {integrationOptions.map((int) => (
                <option key={int} value={int}>{integrationLabels[int]}</option>
              ))}
            </select>

            {/* Status filter */}
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as 'success' | 'failure' | ''); setPage(0); }}
              className="px-2 sm:px-3 py-2 border border-gray-300 rounded-lg text-xs sm:text-sm bg-white"
            >
              <option value="">All Status</option>
              <option value="success">Success</option>
              <option value="failure">Failure</option>
            </select>

            {/* Resolution filter */}
            <select
              value={resolutionFilter}
              onChange={(e) => { setResolutionFilter(e.target.value as ResolutionStatus | ''); setPage(0); }}
              className="px-2 sm:px-3 py-2 border border-gray-300 rounded-lg text-xs sm:text-sm bg-white"
            >
              <option value="">All Resolution</option>
              <option value="open">Open</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="resolved">Resolved</option>
            </select>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 sm:gap-4">
            {/* Export button */}
            <button
              onClick={handleExportCSV}
              className="flex-1 sm:flex-initial px-3 sm:px-4 py-2 text-xs sm:text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="hidden sm:inline">Export CSV</span>
              <span className="sm:hidden">Export</span>
            </button>

            {/* Refresh */}
            <button
              onClick={loadEvents}
              className="flex-1 sm:flex-initial px-3 sm:px-4 py-2 text-xs sm:text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Results count */}
        <div className="mt-3 text-xs sm:text-sm text-gray-500">
          Showing {events.length} of {total} events
          {(integrationFilter || statusFilter || resolutionFilter || debouncedSearch) && (
            <button
              onClick={() => {
                setIntegrationFilter('');
                setStatusFilter('');
                setResolutionFilter('');
                setSearchQuery('');
                setPage(0);
              }}
              className="ml-2 text-blue-600 hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          {error}
        </div>
      )}

      {/* Events table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            No events found matching your filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('timestamp')}
                  >
                    Timestamp <SortIcon field="timestamp" />
                  </th>
                  <th
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('integration')}
                  >
                    Integration <SortIcon field="integration" />
                  </th>
                  <th
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('eventType')}
                  >
                    Event Type <SortIcon field="eventType" />
                  </th>
                  <th
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('status')}
                  >
                    Status <SortIcon field="status" />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Resolution
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Error / Classification
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {events.map((event) => (
                  <tr
                    key={event.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => onEventClick(event)}
                  >
                    <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
                      {new Date(event.timestamp).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {integrationLabels[event.integration] || event.integration}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {event.eventType}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs rounded ${statusColors[event.status]}`}>
                        {event.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {event.status === 'failure' && (
                        <span className={`px-2 py-1 text-xs rounded ${resolutionColors[event.resolution?.status || 'open']}`}>
                          {event.resolution?.status || 'open'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm max-w-xs">
                      {event.error && (
                        <div className="text-red-600 truncate" title={event.error.message}>
                          {event.error.message}
                        </div>
                      )}
                      {event.classification && (
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`px-2 py-0.5 text-xs rounded ${severityColors[event.classification.severity]}`}>
                            {event.classification.severity}
                          </span>
                          <span className="text-xs text-gray-500">
                            {event.classification.category.replace('_', ' ')}
                          </span>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-3 sm:px-4 py-3 border-t border-gray-200 bg-gray-50">
            <div className="flex items-center justify-between sm:justify-start gap-2">
              <span className="text-xs sm:text-sm text-gray-700">Rows:</span>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
                className="px-2 py-1 border border-gray-300 rounded text-xs sm:text-sm bg-white"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span className="text-xs sm:text-sm text-gray-700 sm:hidden">
                {page + 1}/{totalPages}
              </span>
            </div>

            <div className="flex items-center justify-center gap-1 sm:gap-2">
              <span className="text-sm text-gray-700 hidden sm:inline">
                Page {page + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage(0)}
                disabled={page === 0}
                className="px-2 py-1 text-xs sm:text-sm border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="hidden sm:inline">First</span>
                <span className="sm:hidden">«</span>
              </button>
              <button
                onClick={() => setPage(page - 1)}
                disabled={page === 0}
                className="px-2 py-1 text-xs sm:text-sm border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="hidden sm:inline">Prev</span>
                <span className="sm:hidden">‹</span>
              </button>
              <button
                onClick={() => setPage(page + 1)}
                disabled={page >= totalPages - 1}
                className="px-2 py-1 text-xs sm:text-sm border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="hidden sm:inline">Next</span>
                <span className="sm:hidden">›</span>
              </button>
              <button
                onClick={() => setPage(totalPages - 1)}
                disabled={page >= totalPages - 1}
                className="px-2 py-1 text-xs sm:text-sm border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="hidden sm:inline">Last</span>
                <span className="sm:hidden">»</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function generateCSV(events: IntegrationEvent[]): string {
  const headers = [
    'ID',
    'Timestamp',
    'Integration',
    'Event Type',
    'Status',
    'Resolution Status',
    'Error Message',
    'Error Code',
    'Classification Severity',
    'Classification Category',
    'Classification Cause',
    'Classification Suggested Fix',
    'Acknowledged At',
    'Acknowledged By',
    'Resolved At',
    'Resolved By',
    'Resolution Notes',
  ];

  const rows = events.map((event) => [
    event.id,
    new Date(event.timestamp).toISOString(),
    event.integration,
    event.eventType,
    event.status,
    event.resolution?.status || '',
    event.error?.message || '',
    event.error?.code || '',
    event.classification?.severity || '',
    event.classification?.category || '',
    event.classification?.cause || '',
    event.classification?.suggestedFix || '',
    event.resolution?.acknowledgedAt ? new Date(event.resolution.acknowledgedAt).toISOString() : '',
    event.resolution?.acknowledgedBy || '',
    event.resolution?.resolvedAt ? new Date(event.resolution.resolvedAt).toISOString() : '',
    event.resolution?.resolvedBy || '',
    event.resolution?.notes || '',
  ]);

  const escapeCSV = (value: string): string => {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };

  const csvContent = [
    headers.join(','),
    ...rows.map((row) => row.map((cell) => escapeCSV(String(cell))).join(',')),
  ].join('\n');

  return csvContent;
}

function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
