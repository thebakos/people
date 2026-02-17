"use client";

import { useState } from "react";
import { Contact, EmailTemplate, DraftEmail } from "@/lib/types";

interface EmailComposerProps {
  contacts: Contact[];
  selectedIds: Set<string>;
  onDraftsReady: (drafts: DraftEmail[]) => void;
}

const PLACEHOLDER_HELP = `Available placeholders:
  {{name}}      - Contact's full name
  {{firstName}} - Contact's first name
  {{company}}   - Company name`;

const DEFAULT_TEMPLATE: EmailTemplate = {
  subject: "",
  body: "",
};

export default function EmailComposer({
  contacts,
  selectedIds,
  onDraftsReady,
}: EmailComposerProps) {
  const [template, setTemplate] = useState<EmailTemplate>(DEFAULT_TEMPLATE);
  const [previewContactId, setPreviewContactId] = useState<string>("");

  const selectedContacts = contacts.filter((c) => selectedIds.has(c.id));
  const contactsWithEmail = selectedContacts.filter((c) => c.email);
  const previewContact =
    contacts.find((c) => c.id === previewContactId) || contactsWithEmail[0];

  function applyTemplate(templateStr: string, contact: Contact): string {
    const firstName = contact.name.split(" ")[0] || contact.name;
    return templateStr
      .replace(/\{\{name\}\}/g, contact.name)
      .replace(/\{\{firstName\}\}/g, firstName)
      .replace(/\{\{company\}\}/g, contact.company || "your company");
  }

  function generateDrafts(): DraftEmail[] {
    return contactsWithEmail.map((contact) => ({
      contactId: contact.id,
      to: contact.email,
      subject: applyTemplate(template.subject, contact),
      body: applyTemplate(template.body, contact),
    }));
  }

  const handleGenerateDrafts = () => {
    const drafts = generateDrafts();
    onDraftsReady(drafts);
  };

  const noSubject = !template.subject.trim();
  const noBody = !template.body.trim();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-gray-900">Email Template</h3>
        <span className="text-xs text-gray-500">
          {contactsWithEmail.length} of {selectedContacts.length} selected have
          emails
        </span>
      </div>

      <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 font-mono whitespace-pre">
        {PLACEHOLDER_HELP}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Subject
        </label>
        <input
          type="text"
          value={template.subject}
          onChange={(e) =>
            setTemplate({ ...template, subject: e.target.value })
          }
          placeholder="e.g. Partnership Opportunity with {{company}}"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Body (HTML supported)
        </label>
        <textarea
          value={template.body}
          onChange={(e) => setTemplate({ ...template, body: e.target.value })}
          rows={10}
          placeholder={"<p>Hi {{firstName}},</p>\n\n<p>I wanted to reach out regarding...</p>"}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm font-mono"
        />
      </div>

      {previewContact && !noSubject && !noBody && (
        <div className="border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-gray-700">Preview</h4>
            {contactsWithEmail.length > 1 && (
              <select
                value={previewContactId}
                onChange={(e) => setPreviewContactId(e.target.value)}
                className="text-xs border border-gray-200 rounded px-2 py-1"
              >
                {contactsWithEmail.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="text-sm space-y-2">
            <p>
              <span className="text-gray-500">To:</span> {previewContact.email}
            </p>
            <p>
              <span className="text-gray-500">Subject:</span>{" "}
              {applyTemplate(template.subject, previewContact)}
            </p>
            <div className="border-t border-gray-100 pt-2 mt-2">
              <div
                dangerouslySetInnerHTML={{
                  __html: applyTemplate(template.body, previewContact),
                }}
                className="prose prose-sm max-w-none"
              />
            </div>
          </div>
        </div>
      )}

      <button
        onClick={handleGenerateDrafts}
        disabled={contactsWithEmail.length === 0 || noSubject || noBody}
        className="w-full py-2.5 px-4 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
      >
        Generate {contactsWithEmail.length} Draft
        {contactsWithEmail.length !== 1 ? "s" : ""}
      </button>
    </div>
  );
}
