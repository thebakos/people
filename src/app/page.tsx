"use client";

import { useState, useEffect, useCallback } from "react";
import { Person, SearchParams, DraftEmail, GmailTokens } from "@/lib/types";
import SearchForm from "@/components/SearchForm";
import PeopleTable from "@/components/PeopleTable";
import EmailComposer from "@/components/EmailComposer";
import GmailConnect from "@/components/GmailConnect";
import SaveLoadList from "@/components/SaveLoadList";

type Step = "search" | "review" | "email" | "send";

export default function Home() {
  const [step, setStep] = useState<Step>("search");
  const [people, setPeople] = useState<Person[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [drafts, setDrafts] = useState<DraftEmail[]>([]);
  const [gmailTokens, setGmailTokens] = useState<GmailTokens | null>(null);
  const [gmailEmail, setGmailEmail] = useState("");
  const [currentListName, setCurrentListName] = useState("");

  // Handle Gmail OAuth callback params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    if (params.get("gmail_connected") === "true") {
      const email = params.get("gmail_email") || "";
      const tokensB64 = params.get("gmail_tokens") || "";
      if (tokensB64) {
        try {
          const tokens = JSON.parse(atob(tokensB64));
          setGmailTokens(tokens);
          setGmailEmail(email);
          sessionStorage.setItem("gmail_tokens", tokensB64);
          sessionStorage.setItem("gmail_email", email);
        } catch {
          console.error("Failed to parse Gmail tokens");
        }
      }
      // Clean up URL
      window.history.replaceState({}, "", "/");
    }

    // Restore from session storage
    const storedTokens = sessionStorage.getItem("gmail_tokens");
    const storedEmail = sessionStorage.getItem("gmail_email");
    if (storedTokens) {
      try {
        setGmailTokens(JSON.parse(atob(storedTokens)));
        setGmailEmail(storedEmail || "");
      } catch {
        // ignore
      }
    }
  }, []);

  const handleSearch = async (params: SearchParams) => {
    setIsSearching(true);
    setSearchError("");

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Search failed");
      }

      setPeople(data.results || []);
      setSelectedIds(new Set((data.results || []).map((p: Person) => p.id)));
      setStep("review");
    } catch (error) {
      setSearchError(
        error instanceof Error ? error.message : "Search failed"
      );
    } finally {
      setIsSearching(false);
    }
  };

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds((prev) =>
      prev.size === people.length
        ? new Set()
        : new Set(people.map((p) => p.id))
    );
  }, [people]);

  const handleUpdatePerson = useCallback(
    (id: string, updates: Partial<Person>) => {
      setPeople((prev) =>
        prev.map((p) => (p.id === id ? { ...p, ...updates } : p))
      );
    },
    []
  );

  const handleLoadPeople = (loadedPeople: Person[], listName: string) => {
    setPeople(loadedPeople);
    setSelectedIds(new Set(loadedPeople.map((p) => p.id)));
    setCurrentListName(listName);
    setStep("review");
  };

  const handleDraftsReady = (newDrafts: DraftEmail[]) => {
    setDrafts(newDrafts);
    setStep("send");
  };

  const handleConnectGmail = async () => {
    try {
      const response = await fetch("/api/gmail/auth");
      const data = await response.json();
      if (data.authUrl) {
        window.location.href = data.authUrl;
      } else {
        alert(data.error || "Failed to get auth URL");
      }
    } catch {
      alert("Failed to connect to Gmail");
    }
  };

  const steps: { key: Step; label: string }[] = [
    { key: "search", label: "1. Search" },
    { key: "review", label: "2. Review" },
    { key: "email", label: "3. Email" },
    { key: "send", label: "4. Send" },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <h1 className="text-xl font-bold text-gray-900">
            People Finder & Email Outreach
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Search LinkedIn & the web, build lists, and draft personalized
            emails
          </p>
        </div>
      </header>

      {/* Step indicator */}
      <div className="max-w-5xl mx-auto px-4 py-3">
        <div className="flex gap-1">
          {steps.map((s) => (
            <button
              key={s.key}
              onClick={() => setStep(s.key)}
              disabled={
                (s.key === "review" && people.length === 0) ||
                (s.key === "email" && selectedIds.size === 0) ||
                (s.key === "send" && drafts.length === 0)
              }
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                step === s.key
                  ? "bg-blue-600 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main content */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              {step === "search" && (
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">
                    Search for People
                  </h2>
                  <SearchForm
                    onSearch={handleSearch}
                    isLoading={isSearching}
                  />
                  {searchError && (
                    <div className="mt-3 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                      {searchError}
                    </div>
                  )}
                </div>
              )}

              {step === "review" && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-gray-900">
                      People List
                      {currentListName && (
                        <span className="text-sm font-normal text-gray-500 ml-2">
                          ({currentListName})
                        </span>
                      )}
                    </h2>
                    <div className="flex items-center gap-3 text-sm text-gray-500">
                      <span>
                        {selectedIds.size} of {people.length} selected
                      </span>
                      <button
                        onClick={() => setStep("email")}
                        disabled={selectedIds.size === 0}
                        className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                      >
                        Compose Emails
                      </button>
                    </div>
                  </div>
                  <PeopleTable
                    people={people}
                    selectedIds={selectedIds}
                    onToggleSelect={handleToggleSelect}
                    onSelectAll={handleSelectAll}
                    onUpdatePerson={handleUpdatePerson}
                  />
                </div>
              )}

              {step === "email" && (
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">
                    Compose Email Template
                  </h2>
                  <EmailComposer
                    people={people}
                    selectedIds={selectedIds}
                    onDraftsReady={handleDraftsReady}
                  />
                </div>
              )}

              {step === "send" && (
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">
                    Create Gmail Drafts
                  </h2>
                  <GmailConnect
                    tokens={gmailTokens}
                    gmailEmail={gmailEmail}
                    onConnect={handleConnectGmail}
                    drafts={drafts}
                  />

                  {drafts.length > 0 && (
                    <div className="mt-4 border-t border-gray-200 pt-4">
                      <h4 className="text-sm font-medium text-gray-700 mb-2">
                        Draft Preview ({drafts.length} emails)
                      </h4>
                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {drafts.map((draft, i) => (
                          <div
                            key={i}
                            className="p-2 bg-gray-50 rounded text-xs"
                          >
                            <p>
                              <span className="text-gray-500">To:</span>{" "}
                              {draft.to}
                            </p>
                            <p>
                              <span className="text-gray-500">Subject:</span>{" "}
                              {draft.subject}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="font-medium text-gray-900 mb-3">
                Save / Load Lists
              </h3>
              <SaveLoadList
                people={people}
                onLoadPeople={handleLoadPeople}
              />
            </div>

            {gmailTokens && (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                  <span className="text-sm text-gray-700">
                    Gmail: {gmailEmail}
                  </span>
                </div>
                <button
                  onClick={() => {
                    setGmailTokens(null);
                    setGmailEmail("");
                    sessionStorage.removeItem("gmail_tokens");
                    sessionStorage.removeItem("gmail_email");
                  }}
                  className="text-xs text-red-500 hover:underline mt-1"
                >
                  Disconnect
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
