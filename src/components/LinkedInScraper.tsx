"use client";

import { useState, useCallback, useEffect } from "react";
import { ScraperResult, CompanySearchStatus, Contact } from "@/lib/types";
import { v4 as uuidv4 } from "uuid";

interface LinkedInScraperProps {
  onContactsFound: (contacts: Contact[]) => void;
}

export default function LinkedInScraper({
  onContactsFound,
}: LinkedInScraperProps) {
  const [urlInput, setUrlInput] = useState("");
  const [linkedinCookie, setLinkedinCookie] = useState("");
  const [showCookieInput, setShowCookieInput] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [companyStatuses, setCompanyStatuses] = useState<
    CompanySearchStatus[]
  >([]);
  const [allResults, setAllResults] = useState<ScraperResult[]>([]);
  const [error, setError] = useState("");

  // Restore cookie from sessionStorage
  useEffect(() => {
    const stored = sessionStorage.getItem("linkedin_cookie");
    if (stored) {
      setLinkedinCookie(stored);
      setShowCookieInput(true);
    }
  }, []);

  // Save cookie to sessionStorage when it changes
  useEffect(() => {
    if (linkedinCookie) {
      sessionStorage.setItem("linkedin_cookie", linkedinCookie);
    }
  }, [linkedinCookie]);

  const parseUrls = (input: string): string[] => {
    return input
      .split(/[\n,]+/)
      .map((u) => u.trim())
      .filter((u) => u.length > 0)
      .map((u) => {
        // Normalize URL
        if (!u.startsWith("http")) {
          u = "https://" + u;
        }
        // Remove trailing slash
        return u.replace(/\/+$/, "");
      });
  };

  const handleSearch = useCallback(async () => {
    const urls = parseUrls(urlInput);
    if (urls.length === 0) {
      setError("Please enter at least one LinkedIn company URL.");
      return;
    }

    const invalidUrls = urls.filter((u) => !u.includes("linkedin.com/company"));
    if (invalidUrls.length > 0) {
      setError(
        `Invalid LinkedIn company URL(s): ${invalidUrls.join(", ")}. URLs should look like https://www.linkedin.com/company/company-name`
      );
      return;
    }

    setError("");
    setIsSearching(true);
    setAllResults([]);

    // Initialize statuses
    const initialStatuses: CompanySearchStatus[] = urls.map((url) => ({
      url,
      status: "pending",
      results: [],
    }));
    setCompanyStatuses(initialStatuses);

    const accumulated: ScraperResult[] = [];

    // Process companies sequentially to avoid rate limiting
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];

      // Update status to searching
      setCompanyStatuses((prev) =>
        prev.map((s, idx) =>
          idx === i ? { ...s, status: "searching", message: "Searching..." } : s
        )
      );

      try {
        const response = await fetch("/api/scraper/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url,
            linkedinCookie: linkedinCookie || undefined,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          setCompanyStatuses((prev) =>
            prev.map((s, idx) =>
              idx === i
                ? { ...s, status: "error", message: data.error || "Failed" }
                : s
            )
          );
          continue;
        }

        const results: ScraperResult[] = data.results || [];
        accumulated.push(...results);
        setAllResults([...accumulated]);

        setCompanyStatuses((prev) =>
          prev.map((s, idx) =>
            idx === i
              ? {
                  ...s,
                  status: "done",
                  message: `Found ${results.length} contact(s)`,
                  results,
                }
              : s
          )
        );
      } catch {
        setCompanyStatuses((prev) =>
          prev.map((s, idx) =>
            idx === i
              ? { ...s, status: "error", message: "Network error" }
              : s
          )
        );
      }
    }

    setIsSearching(false);
  }, [urlInput, linkedinCookie]);

  const handleDownloadCSV = useCallback(() => {
    if (allResults.length === 0) return;

    const header = "Company Name,Contact Name,Email\n";
    const rows = allResults
      .map(
        (r) =>
          `"${escapeCsv(r.companyName)}","${escapeCsv(r.contactName)}","${escapeCsv(r.email)}"`
      )
      .join("\n");

    const csv = header + rows;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vc_contacts.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [allResults]);

  const handleUseContacts = useCallback(() => {
    const contacts: Contact[] = allResults
      .filter((r) => r.contactName)
      .map((r) => ({
        id: uuidv4(),
        name: r.contactName,
        company: r.companyName,
        email: r.email,
      }));
    onContactsFound(contacts);
  }, [allResults, onContactsFound]);

  const extractLabel = (url: string): string => {
    const match = url.match(/linkedin\.com\/company\/([^/?#]+)/);
    return match
      ? match[1].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
      : url;
  };

  return (
    <div>
      {/* LinkedIn Authentication */}
      <div className="mb-4">
        <button
          type="button"
          onClick={() => setShowCookieInput(!showCookieInput)}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors w-full text-left ${
            linkedinCookie
              ? "bg-green-50 text-green-700 border border-green-200"
              : "bg-amber-50 text-amber-700 border border-amber-200"
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${linkedinCookie ? "bg-green-500" : "bg-amber-500"}`} />
          {linkedinCookie
            ? "LinkedIn connected"
            : "Connect LinkedIn for better results"}
          <svg
            className={`w-4 h-4 ml-auto transition-transform ${showCookieInput ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showCookieInput && (
          <div className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              LinkedIn Session Cookie (li_at)
            </label>
            <input
              type="password"
              value={linkedinCookie}
              onChange={(e) => setLinkedinCookie(e.target.value.trim())}
              placeholder="Paste your li_at cookie value here..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <details className="mt-2">
              <summary className="text-xs text-blue-600 cursor-pointer hover:text-blue-700">
                How to get your li_at cookie
              </summary>
              <ol className="mt-1.5 text-xs text-gray-600 space-y-1 list-decimal list-inside">
                <li>Log in to LinkedIn in your browser</li>
                <li>Open DevTools (F12 or Cmd+Opt+I)</li>
                <li>Go to Application tab &rarr; Cookies &rarr; linkedin.com</li>
                <li>Find the cookie named <code className="bg-gray-200 px-1 rounded">li_at</code></li>
                <li>Copy the value and paste it above</li>
              </ol>
              <p className="mt-1.5 text-xs text-gray-500">
                Your cookie is only sent to LinkedIn and is stored in your browser session. It is never saved to any server.
              </p>
            </details>
            {linkedinCookie && (
              <button
                onClick={() => {
                  setLinkedinCookie("");
                  sessionStorage.removeItem("linkedin_cookie");
                }}
                className="mt-2 text-xs text-red-500 hover:underline"
              >
                Clear cookie
              </button>
            )}
          </div>
        )}
      </div>

      {/* URL Input */}
      <div className="mb-4">
        <label
          htmlFor="linkedin-urls"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          LinkedIn Company URLs
        </label>
        <textarea
          id="linkedin-urls"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder={`Paste LinkedIn company URLs, one per line:\nhttps://www.linkedin.com/company/sequoia-capital\nhttps://www.linkedin.com/company/andreessen-horowitz`}
          rows={5}
          disabled={isSearching}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:bg-gray-50 disabled:text-gray-400"
        />
        <p className="text-xs text-gray-500 mt-1">
          Enter one URL per line. Finds up to 10 employees per company
          {linkedinCookie ? "" : " (connect LinkedIn above for best results)"}.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        onClick={handleSearch}
        disabled={isSearching || !urlInput.trim()}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isSearching ? (
          <span className="flex items-center gap-2">
            <svg
              className="animate-spin h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Searching...
          </span>
        ) : (
          "Search for Contacts"
        )}
      </button>

      {/* Company processing status */}
      {companyStatuses.length > 0 && (
        <div className="mt-6 space-y-2">
          <h4 className="text-sm font-medium text-gray-700">Progress</h4>
          {companyStatuses.map((cs, i) => (
            <div
              key={i}
              className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg text-sm"
            >
              <StatusIcon status={cs.status} />
              <span className="font-medium text-gray-800 truncate flex-1">
                {extractLabel(cs.url)}
              </span>
              <span
                className={`text-xs ${
                  cs.status === "error" ? "text-red-500" : "text-gray-500"
                }`}
              >
                {cs.message || "Waiting..."}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Results table */}
      {allResults.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-gray-900">
              Results ({allResults.length} contacts)
            </h4>
            <div className="flex gap-2">
              <button
                onClick={handleDownloadCSV}
                className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 transition-colors"
              >
                Download CSV
              </button>
              <button
                onClick={handleUseContacts}
                className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors"
              >
                Use for Email Outreach
              </button>
            </div>
          </div>

          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-gray-700">
                    Company Name
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-gray-700">
                    Contact Name
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-gray-700">
                    Email
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-gray-700">
                    LinkedIn
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {allResults.map((r, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-800">
                      {r.companyName}
                    </td>
                    <td className="px-3 py-2 text-gray-800">
                      {r.contactName}
                    </td>
                    <td className="px-3 py-2">
                      {r.email ? (
                        <span className="text-gray-800">{r.email}</span>
                      ) : (
                        <span className="text-gray-400 italic">
                          Not found
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <a
                        href={r.linkedinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline truncate block max-w-[200px]"
                      >
                        Profile
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: CompanySearchStatus["status"] }) {
  if (status === "searching") {
    return (
      <svg
        className="animate-spin h-4 w-4 text-blue-600"
        viewBox="0 0 24 24"
        fill="none"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
    );
  }
  if (status === "done") {
    return (
      <svg
        className="h-4 w-4 text-green-600"
        viewBox="0 0 20 20"
        fill="currentColor"
      >
        <path
          fillRule="evenodd"
          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  if (status === "error") {
    return (
      <svg
        className="h-4 w-4 text-red-500"
        viewBox="0 0 20 20"
        fill="currentColor"
      >
        <path
          fillRule="evenodd"
          d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  return <span className="h-4 w-4 rounded-full bg-gray-300 block" />;
}

function escapeCsv(value: string): string {
  return value.replace(/"/g, '""');
}
