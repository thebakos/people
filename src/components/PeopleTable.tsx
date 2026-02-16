"use client";

import { Person } from "@/lib/types";

interface PeopleTableProps {
  people: Person[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onUpdatePerson: (id: string, updates: Partial<Person>) => void;
}

export default function PeopleTable({
  people,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onUpdatePerson,
}: PeopleTableProps) {
  if (people.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 text-sm">
        No people found. Run a search to get started.
      </div>
    );
  }

  const allSelected = people.length > 0 && selectedIds.size === people.length;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="py-2 px-2 text-left">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onSelectAll}
                className="rounded"
              />
            </th>
            <th className="py-2 px-2 text-left font-medium text-gray-700">
              Name
            </th>
            <th className="py-2 px-2 text-left font-medium text-gray-700">
              Title
            </th>
            <th className="py-2 px-2 text-left font-medium text-gray-700">
              Company
            </th>
            <th className="py-2 px-2 text-left font-medium text-gray-700">
              Email
            </th>
            <th className="py-2 px-2 text-left font-medium text-gray-700">
              Source
            </th>
          </tr>
        </thead>
        <tbody>
          {people.map((person) => (
            <tr
              key={person.id}
              className="border-b border-gray-100 hover:bg-gray-50"
            >
              <td className="py-2 px-2">
                <input
                  type="checkbox"
                  checked={selectedIds.has(person.id)}
                  onChange={() => onToggleSelect(person.id)}
                  className="rounded"
                />
              </td>
              <td className="py-2 px-2">
                <div className="font-medium text-gray-900">{person.name}</div>
                {person.linkedinUrl && (
                  <a
                    href={person.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline"
                  >
                    LinkedIn
                  </a>
                )}
              </td>
              <td className="py-2 px-2 text-gray-600">{person.title}</td>
              <td className="py-2 px-2 text-gray-600">{person.company}</td>
              <td className="py-2 px-2">
                <input
                  type="email"
                  value={person.email || ""}
                  onChange={(e) =>
                    onUpdatePerson(person.id, { email: e.target.value })
                  }
                  placeholder="Add email..."
                  className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                />
              </td>
              <td className="py-2 px-2">
                <span
                  className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                    person.source === "linkedin"
                      ? "bg-blue-100 text-blue-700"
                      : "bg-green-100 text-green-700"
                  }`}
                >
                  {person.source === "linkedin" ? "LinkedIn" : "Web"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
