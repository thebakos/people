"use client";

import { useState, useEffect } from "react";
import { Person } from "@/lib/types";

interface SaveLoadListProps {
  people: Person[];
  onLoadPeople: (people: Person[], listName: string) => void;
}

export default function SaveLoadList({
  people,
  onLoadPeople,
}: SaveLoadListProps) {
  const [listName, setListName] = useState("");
  const [savedLists, setSavedLists] = useState<string[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetchLists();
  }, []);

  const fetchLists = async () => {
    try {
      const response = await fetch("/api/people");
      const data = await response.json();
      setSavedLists(data.lists || []);
    } catch {
      console.error("Failed to fetch lists");
    }
  };

  const handleSave = async () => {
    if (!listName.trim() || people.length === 0) return;

    try {
      const response = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listName: listName.trim(), people }),
      });

      if (response.ok) {
        setMessage(`Saved "${listName}" (${people.length} people)`);
        fetchLists();
        setTimeout(() => setMessage(""), 3000);
      }
    } catch {
      setMessage("Failed to save list");
    }
  };

  const handleLoad = async (name: string) => {
    try {
      const response = await fetch(`/api/people?list=${encodeURIComponent(name)}`);
      const data = await response.json();
      if (data.people) {
        onLoadPeople(data.people, name);
        setListName(name);
        setMessage(`Loaded "${name}" (${data.people.length} people)`);
        setTimeout(() => setMessage(""), 3000);
      }
    } catch {
      setMessage("Failed to load list");
    }
  };

  const handleDelete = async (name: string) => {
    try {
      const response = await fetch(
        `/api/people?list=${encodeURIComponent(name)}`,
        { method: "DELETE" }
      );
      if (response.ok) {
        fetchLists();
        setMessage(`Deleted "${name}"`);
        setTimeout(() => setMessage(""), 3000);
      }
    } catch {
      setMessage("Failed to delete list");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          type="text"
          value={listName}
          onChange={(e) => setListName(e.target.value)}
          placeholder="List name..."
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
        />
        <button
          onClick={handleSave}
          disabled={!listName.trim() || people.length === 0}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm whitespace-nowrap"
        >
          Save List
        </button>
      </div>

      {message && (
        <p className="text-xs text-green-600">{message}</p>
      )}

      {savedLists.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
            Saved Lists
          </h4>
          <div className="space-y-1">
            {savedLists.map((name) => (
              <div
                key={name}
                className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gray-50"
              >
                <button
                  onClick={() => handleLoad(name)}
                  className="text-sm text-blue-600 hover:underline text-left flex-1"
                >
                  {name}
                </button>
                <button
                  onClick={() => handleDelete(name)}
                  className="text-xs text-red-500 hover:text-red-700 ml-2"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
