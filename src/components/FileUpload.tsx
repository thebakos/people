"use client";

import { useState, useRef } from "react";
import { Contact } from "@/lib/types";
import { v4 as uuidv4 } from "uuid";

interface FileUploadProps {
  onContactsLoaded: (contacts: Contact[]) => void;
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z]/g, "");
}

function findColumn(headers: string[], candidates: string[]): number {
  return headers.findIndex((h) => candidates.includes(normalizeHeader(h)));
}

function parseRows(rows: string[][]): Contact[] {
  if (rows.length < 2) return [];

  const headers = rows[0];
  const nameCol = findColumn(headers, ["contactname", "name", "fullname", "contact"]);
  const companyCol = findColumn(headers, ["companyname", "company", "organization", "org"]);
  const emailCol = findColumn(headers, ["email", "emailaddress", "mail"]);

  if (nameCol === -1 && companyCol === -1 && emailCol === -1) {
    return [];
  }

  const contacts: Contact[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const name = (nameCol !== -1 ? row[nameCol] : "")?.trim() || "";
    const company = (companyCol !== -1 ? row[companyCol] : "")?.trim() || "";
    const email = (emailCol !== -1 ? row[emailCol] : "")?.trim() || "";

    if (name || email) {
      contacts.push({ id: uuidv4(), name, company, email });
    }
  }
  return contacts;
}

export default function FileUpload({ onContactsLoaded }: FileUploadProps) {
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = (file: File) => {
    setError("");
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = e.target?.result;
        if (!data) {
          setError("Could not read file.");
          return;
        }

        let rows: string[][] = [];

        if (file.name.endsWith(".csv")) {
          const text = data as string;
          rows = text
            .split(/\r?\n/)
            .filter((line) => line.trim())
            .map((line) => {
              // Handle quoted CSV fields
              const fields: string[] = [];
              let current = "";
              let inQuotes = false;
              for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (ch === '"') {
                  inQuotes = !inQuotes;
                } else if (ch === "," && !inQuotes) {
                  fields.push(current);
                  current = "";
                } else {
                  current += ch;
                }
              }
              fields.push(current);
              return fields;
            });
        } else {
          const XLSX = await import("xlsx");
          const workbook = XLSX.read(data, { type: "array" });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][];
        }

        const contacts = parseRows(rows);

        if (contacts.length === 0) {
          setError(
            'No contacts found. Make sure the file has columns like "Company Name", "Contact Name", and "Email".'
          );
          return;
        }

        onContactsLoaded(contacts);
      } catch {
        setError("Failed to parse file. Please check the format.");
      }
    };

    if (file.name.endsWith(".csv")) {
      reader.readAsText(file);
    } else {
      reader.readAsArrayBuffer(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
          isDragging
            ? "border-blue-500 bg-blue-50"
            : "border-gray-300 hover:border-gray-400 hover:bg-gray-50"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xls,.xlsx"
          onChange={handleFileChange}
          className="hidden"
        />
        <div className="text-gray-500">
          <svg
            className="mx-auto h-10 w-10 text-gray-400 mb-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
          <p className="text-sm font-medium text-gray-700">
            Drop your CSV or Excel file here, or click to browse
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Expected columns: Company Name, Contact Name, Email
          </p>
          {fileName && (
            <p className="text-xs text-blue-600 mt-2">Loaded: {fileName}</p>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}
    </div>
  );
}
