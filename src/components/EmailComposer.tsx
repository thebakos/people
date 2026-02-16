"use client";

import { useState } from "react";
import { Person, EmailTemplate, DraftEmail } from "@/lib/types";

interface EmailComposerProps {
  people: Person[];
  selectedIds: Set<string>;
  onDraftsReady: (drafts: DraftEmail[]) => void;
}

const PLACEHOLDER_HELP = `Available placeholders:
  {{name}} - Person's full name
  {{firstName}} - Person's first name
  {{title}} - Job title
  {{company}} - Company name`;

const DEFAULT_TEMPLATE: EmailTemplate = {
  subject: "Hello {{firstName}} - Quick Introduction",
  body: `<p>Hi {{firstName}},</p>

<p>I came across your profile and was impressed by your work as {{title}} at {{company}}.</p>

<p>I'd love to connect and explore potential opportunities for collaboration.</p>

<p>Would you be open to a brief chat sometime this week?</p>

<p>Best regards</p>`,
};

export default function EmailComposer({
  people,
  selectedIds,
  onDraftsReady,
}: EmailComposerProps) {
  const [template, setTemplate] = useState<EmailTemplate>(DEFAULT_TEMPLATE);
  const [previewPersonId, setPreviewPersonId] = useState<string>("");

  const selectedPeople = people.filter((p) => selectedIds.has(p.id));
  const peopleWithEmail = selectedPeople.filter((p) => p.email);
  const previewPerson =
    people.find((p) => p.id === previewPersonId) || peopleWithEmail[0];

  function applyTemplate(templateStr: string, person: Person): string {
    const firstName = person.name.split(" ")[0] || person.name;
    return templateStr
      .replace(/\{\{name\}\}/g, person.name)
      .replace(/\{\{firstName\}\}/g, firstName)
      .replace(/\{\{title\}\}/g, person.title || "your role")
      .replace(/\{\{company\}\}/g, person.company || "your company");
  }

  function generateDrafts(): DraftEmail[] {
    return peopleWithEmail.map((person) => ({
      personId: person.id,
      to: person.email!,
      subject: applyTemplate(template.subject, person),
      body: applyTemplate(template.body, person),
    }));
  }

  const handleGenerateDrafts = () => {
    const drafts = generateDrafts();
    onDraftsReady(drafts);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-gray-900">Email Template</h3>
        <span className="text-xs text-gray-500">
          {peopleWithEmail.length} of {selectedPeople.length} selected have
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
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm font-mono"
        />
      </div>

      {previewPerson && (
        <div className="border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-gray-700">Preview</h4>
            {peopleWithEmail.length > 1 && (
              <select
                value={previewPersonId}
                onChange={(e) => setPreviewPersonId(e.target.value)}
                className="text-xs border border-gray-200 rounded px-2 py-1"
              >
                {peopleWithEmail.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="text-sm space-y-2">
            <p>
              <span className="text-gray-500">To:</span> {previewPerson.email}
            </p>
            <p>
              <span className="text-gray-500">Subject:</span>{" "}
              {applyTemplate(template.subject, previewPerson)}
            </p>
            <div className="border-t border-gray-100 pt-2 mt-2">
              <div
                dangerouslySetInnerHTML={{
                  __html: applyTemplate(template.body, previewPerson),
                }}
                className="prose prose-sm max-w-none"
              />
            </div>
          </div>
        </div>
      )}

      <button
        onClick={handleGenerateDrafts}
        disabled={peopleWithEmail.length === 0}
        className="w-full py-2.5 px-4 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
      >
        Generate {peopleWithEmail.length} Draft
        {peopleWithEmail.length !== 1 ? "s" : ""}
      </button>
    </div>
  );
}
