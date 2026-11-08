"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "./ui";

export type ChecklistState = {
  workspace: { id: string; internal: boolean; setupStartedAt: string | null; firstEmployeeAt: string | null; now: string };
  employee?: { name: string | null };
  steps: { key: string; label: string; href: string; done: boolean; detail: string }[];
};

export function useChecklist() {
  const [state, setState] = useState<ChecklistState | null>(null);
  const load = useCallback(() => api<ChecklistState>("/api/state").then(setState).catch(() => {}), []);
  useEffect(() => {
    load();
    window.addEventListener("app:refresh", load);
    return () => window.removeEventListener("app:refresh", load);
  }, [load]);
  return { state, reload: load };
}
