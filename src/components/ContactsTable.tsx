"use client";

import { Contact } from "@/lib/types";

interface ContactsTableProps {
  contacts: Contact[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onUpdateContact: (id: string, updates: Partial<Contact>) => void;
  onRemoveContact: (id: string) => void;
}

export default function ContactsTable({
  contacts,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onUpdateContact,
  onRemoveContact,
}: ContactsTableProps) {
  if (contacts.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 text-sm">
        No contacts loaded. Upload a CSV or Excel file to get started.
      </div>
    );
  }

  const allSelected =
    contacts.length > 0 && selectedIds.size === contacts.length;

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
              Contact Name
            </th>
            <th className="py-2 px-2 text-left font-medium text-gray-700">
              Company Name
            </th>
            <th className="py-2 px-2 text-left font-medium text-gray-700">
              Email
            </th>
            <th className="py-2 px-2"></th>
          </tr>
        </thead>
        <tbody>
          {contacts.map((contact) => (
            <tr
              key={contact.id}
              className="border-b border-gray-100 hover:bg-gray-50"
            >
              <td className="py-2 px-2">
                <input
                  type="checkbox"
                  checked={selectedIds.has(contact.id)}
                  onChange={() => onToggleSelect(contact.id)}
                  className="rounded"
                />
              </td>
              <td className="py-2 px-2">
                <input
                  type="text"
                  value={contact.name}
                  onChange={(e) =>
                    onUpdateContact(contact.id, { name: e.target.value })
                  }
                  className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                />
              </td>
              <td className="py-2 px-2">
                <input
                  type="text"
                  value={contact.company}
                  onChange={(e) =>
                    onUpdateContact(contact.id, { company: e.target.value })
                  }
                  className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                />
              </td>
              <td className="py-2 px-2">
                <input
                  type="email"
                  value={contact.email}
                  onChange={(e) =>
                    onUpdateContact(contact.id, { email: e.target.value })
                  }
                  className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                />
              </td>
              <td className="py-2 px-2">
                <button
                  onClick={() => onRemoveContact(contact.id)}
                  className="text-gray-400 hover:text-red-500 transition-colors"
                  title="Remove contact"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
