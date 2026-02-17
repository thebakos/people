"use client";

import { useState, useEffect, useCallback } from "react";
import { Contact, DraftEmail, GmailTokens } from "@/lib/types";
import FileUpload from "@/components/FileUpload";
import ContactsTable from "@/components/ContactsTable";
import EmailComposer from "@/components/EmailComposer";
import GmailConnect from "@/components/GmailConnect";

type Step = "upload" | "compose" | "send";

export default function Home() {
  const [step, setStep] = useState<Step>("upload");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<DraftEmail[]>([]);
  const [gmailTokens, setGmailTokens] = useState<GmailTokens | null>(null);
  const [gmailEmail, setGmailEmail] = useState("");

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

  const handleContactsLoaded = (loaded: Contact[]) => {
    setContacts(loaded);
    setSelectedIds(new Set(loaded.map((c) => c.id)));
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
      prev.size === contacts.length
        ? new Set()
        : new Set(contacts.map((c) => c.id))
    );
  }, [contacts]);

  const handleUpdateContact = useCallback(
    (id: string, updates: Partial<Contact>) => {
      setContacts((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...updates } : c))
      );
    },
    []
  );

  const handleRemoveContact = useCallback((id: string) => {
    setContacts((prev) => prev.filter((c) => c.id !== id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

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

  const steps: { key: Step; label: string; num: number }[] = [
    { key: "upload", label: "Upload Contacts", num: 1 },
    { key: "compose", label: "Compose Email", num: 2 },
    { key: "send", label: "Create Drafts", num: 3 },
  ];

  const selectedWithEmail = contacts.filter(
    (c) => selectedIds.has(c.id) && c.email
  ).length;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <h1 className="text-xl font-bold text-gray-900">
            Email Outreach
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Upload contacts, compose a personalized email, and create Gmail
            drafts
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
                (s.key === "compose" && contacts.length === 0) ||
                (s.key === "send" && drafts.length === 0)
              }
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                step === s.key
                  ? "bg-blue-600 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
              }`}
            >
              {s.num}. {s.label}
            </button>
          ))}
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main content */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              {step === "upload" && (
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">
                    Upload Contact List
                  </h2>
                  <FileUpload onContactsLoaded={handleContactsLoaded} />

                  {contacts.length > 0 && (
                    <div className="mt-6">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-medium text-gray-900">
                          Contacts ({contacts.length})
                        </h3>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-gray-500">
                            {selectedIds.size} selected
                          </span>
                          <button
                            onClick={() => setStep("compose")}
                            disabled={selectedWithEmail === 0}
                            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                          >
                            Compose Email
                          </button>
                        </div>
                      </div>
                      <ContactsTable
                        contacts={contacts}
                        selectedIds={selectedIds}
                        onToggleSelect={handleToggleSelect}
                        onSelectAll={handleSelectAll}
                        onUpdateContact={handleUpdateContact}
                        onRemoveContact={handleRemoveContact}
                      />
                    </div>
                  )}
                </div>
              )}

              {step === "compose" && (
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">
                    Compose Email Template
                  </h2>
                  <EmailComposer
                    contacts={contacts}
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
            {contacts.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <h3 className="font-medium text-gray-900 mb-2">Summary</h3>
                <div className="space-y-1 text-sm text-gray-600">
                  <p>{contacts.length} contacts loaded</p>
                  <p>{selectedIds.size} selected</p>
                  <p>{selectedWithEmail} with email addresses</p>
                </div>
              </div>
            )}

            {gmailTokens ? (
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
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-sm text-gray-600 mb-2">
                  Connect Gmail to create drafts
                </p>
                <button
                  onClick={handleConnectGmail}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
                >
                  Connect Gmail
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
