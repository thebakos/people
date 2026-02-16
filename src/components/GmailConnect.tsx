"use client";

import { useState } from "react";
import { DraftEmail, GmailTokens } from "@/lib/types";

interface GmailConnectProps {
  tokens: GmailTokens | null;
  gmailEmail: string;
  onConnect: () => void;
  drafts: DraftEmail[];
}

export default function GmailConnect({
  tokens,
  gmailEmail,
  onConnect,
  drafts,
}: GmailConnectProps) {
  const [isSending, setIsSending] = useState(false);
  const [results, setResults] = useState<{
    success: number;
    failed: number;
    errors: string[];
  } | null>(null);

  const handleSendDrafts = async () => {
    if (!tokens || drafts.length === 0) return;

    setIsSending(true);
    setResults(null);

    try {
      const response = await fetch("/api/gmail/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokens, drafts }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create drafts");
      }

      setResults({
        success: data.results?.length || 0,
        failed: data.errors?.length || 0,
        errors: data.errors?.map(
          (e: { to: string; error: string }) => `${e.to}: ${e.error}`
        ) || [],
      });
    } catch (error) {
      setResults({
        success: 0,
        failed: drafts.length,
        errors: [error instanceof Error ? error.message : "Unknown error"],
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-gray-900">Gmail Integration</h3>
        {tokens && gmailEmail && (
          <span className="text-xs text-green-600 flex items-center gap-1">
            <span className="w-2 h-2 bg-green-500 rounded-full"></span>
            Connected as {gmailEmail}
          </span>
        )}
      </div>

      {!tokens ? (
        <div className="text-center py-6">
          <p className="text-sm text-gray-600 mb-3">
            Connect your Gmail account to create drafts directly in your inbox.
          </p>
          <button
            onClick={onConnect}
            className="px-6 py-2.5 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors text-sm"
          >
            Connect Gmail Account
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            {drafts.length} draft{drafts.length !== 1 ? "s" : ""} ready to be
            created in your Gmail account.
          </p>

          <button
            onClick={handleSendDrafts}
            disabled={isSending || drafts.length === 0}
            className="w-full py-2.5 px-4 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
          >
            {isSending
              ? "Creating Drafts..."
              : `Create ${drafts.length} Draft${drafts.length !== 1 ? "s" : ""} in Gmail`}
          </button>

          {results && (
            <div
              className={`rounded-lg p-3 text-sm ${
                results.failed === 0
                  ? "bg-green-50 text-green-800"
                  : results.success === 0
                    ? "bg-red-50 text-red-800"
                    : "bg-yellow-50 text-yellow-800"
              }`}
            >
              <p className="font-medium">
                {results.success} draft{results.success !== 1 ? "s" : ""}{" "}
                created successfully
                {results.failed > 0 &&
                  `, ${results.failed} failed`}
              </p>
              {results.errors.length > 0 && (
                <ul className="mt-1 text-xs space-y-0.5">
                  {results.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
