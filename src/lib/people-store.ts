import { promises as fs } from "fs";
import path from "path";
import { Person } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch {
    // directory already exists
  }
}

function getFilePath(listName: string): string {
  const sanitized = listName.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(DATA_DIR, `${sanitized}.json`);
}

export async function savePeopleList(
  listName: string,
  people: Person[]
): Promise<void> {
  await ensureDataDir();
  const filePath = getFilePath(listName);
  await fs.writeFile(
    filePath,
    JSON.stringify({ name: listName, people, updatedAt: new Date().toISOString() }, null, 2)
  );
}

export async function loadPeopleList(
  listName: string
): Promise<{ name: string; people: Person[]; updatedAt: string } | null> {
  const filePath = getFilePath(listName);
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function listPeopleLists(): Promise<string[]> {
  await ensureDataDir();
  const files = await fs.readdir(DATA_DIR);
  return files
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

export async function deletePeopleList(listName: string): Promise<void> {
  const filePath = getFilePath(listName);
  await fs.unlink(filePath);
}

export async function updatePersonInList(
  listName: string,
  personId: string,
  updates: Partial<Person>
): Promise<void> {
  const list = await loadPeopleList(listName);
  if (!list) throw new Error(`List "${listName}" not found`);

  list.people = list.people.map((p) =>
    p.id === personId ? { ...p, ...updates } : p
  );
  list.updatedAt = new Date().toISOString();
  await savePeopleList(listName, list.people);
}
