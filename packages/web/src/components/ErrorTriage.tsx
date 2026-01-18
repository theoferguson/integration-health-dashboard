import { useState } from 'react';
import type { IntegrationEvent } from '../types';
import { classifyEvent } from '../api/client';

interface ErrorTriageProps {
  event: IntegrationEvent;
  onClose: () => void;
  onClassified: (event: IntegrationEvent) => void;
}

const integrationLabels: Record<string, string> = {
  procore: 'Procore',
  gusto: 'Gusto',
  quickbooks: 'QuickBooks',
  stripe_issuing: 'Stripe Issuing',
  certified_payroll: 'Certified Payroll',
};

const severityColors: Record<string, string> = {
  low: 'bg-blue-100 text-blue-800 border-blue-200',
  medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  high: 'bg-orange-100 text-orange-800 border-orange-200',
  critical: 'bg-red-100 text-red-800 border-red-200',
};

const categoryLabels: Record<string, string> = {
  auth: 'Authentication',
  rate_limit: 'Rate Limit',
  data_validation: 'Data Validation',
  data_state_mismatch: 'Data State Mismatch',
  network: 'Network',
  spending_control: 'Spending Control',
  compliance: 'Compliance',
  unknown: 'Unknown',
};

export function ErrorTriage({ event, onClose, onClassified }: ErrorTriageProps) {
  const [isClassifying, setIsClassifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClassify = async () => {
    setIsClassifying(true);
    setError(null);

    try {
      const result = await classifyEvent(event.id);
      onClassified(result.event);
    } catch (err) {
      setError('Failed to classify error. Please try again.');
    } finally {
      setIsClassifying(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold">Error Triage</h2>
              <p className="text-sm text-gray-500">
                {integrationLabels[event.integration]} · {event.eventType}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Error Details */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 mb-2">
              Error Message
            </h3>
            <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800">
              {event.error?.message || 'No error message'}
            </div>
          </div>

          {event.error?.context && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Context</h3>
              <pre className="bg-gray-50 border rounded p-3 text-xs overflow-x-auto">
                {JSON.stringify(event.error.context, null, 2)}
              </pre>
            </div>
          )}

          {/* AI Classification */}
          {event.classification ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span
                  className={`px-3 py-1 rounded-full text-sm font-medium border ${
                    severityColors[event.classification.severity]
                  }`}
                >
                  {event.classification.severity.toUpperCase()}
                </span>
                <span className="text-sm text-gray-600">
                  {categoryLabels[event.classification.category]}
                </span>
              </div>

              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">
                  AI Analysis
                </h3>
                <p className="text-gray-800">{event.classification.cause}</p>
              </div>

              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">
                  Suggested Fix
                </h3>
                <p className="text-gray-800 bg-green-50 border border-green-200 rounded p-3">
                  {event.classification.suggestedFix}
                </p>
              </div>

              {event.classification.businessImpact && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">
                    Business Impact
                  </h3>
                  <p className="text-gray-600 text-sm">
                    {event.classification.businessImpact}
                  </p>
                </div>
              )}

              {event.classification.affectedData &&
                event.classification.affectedData.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">
                      Affected Data
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {event.classification.affectedData.map((item) => (
                        <span
                          key={item}
                          className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
            </div>
          ) : (
            <div className="text-center py-6">
              <p className="text-gray-600 mb-4">
                Click below to analyze this error with AI
              </p>
              <button
                onClick={handleClassify}
                disabled={isClassifying}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isClassifying ? (
                  <span className="flex items-center gap-2">
                    <svg
                      className="animate-spin h-4 w-4"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Analyzing...
                  </span>
                ) : (
                  'Analyze with AI'
                )}
              </button>
              {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
