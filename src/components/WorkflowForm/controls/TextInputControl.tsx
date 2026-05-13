"use client";

import type { TextInputField } from "@/types/workflow";
import { getAtPath } from "@/lib/workflow-utils";
import { useWorkflowStore } from "@/store/useWorkflowStore";

export interface TextInputControlProps {
  field: TextInputField;
  error?: string;
}

export function TextInputControl({ field, error }: TextInputControlProps) {
  const path = useWorkflowStore((s) => s.fieldPaths[field.id]);
  const raw = useWorkflowStore((s) => (path ? getAtPath(s.parameters, path) : undefined));
  const setFieldValue = useWorkflowStore((s) => s.setFieldValue);
  const value = typeof raw === "string" ? raw : "";

  const className = `w-full rounded-md border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-800 ${
    error ? "border-red-300" : "border-neutral-300"
  }`;

  return (
    <div className="space-y-1">
      {field.multiline ? (
        <textarea
          id={field.id}
          rows={5}
          placeholder={field.placeholder}
          value={value}
          onChange={(e) => setFieldValue(field.id, e.target.value)}
          className={className}
        />
      ) : (
        <input
          id={field.id}
          type="text"
          placeholder={field.placeholder}
          value={value}
          onChange={(e) => setFieldValue(field.id, e.target.value)}
          className={className}
        />
      )}
      {field.description && <p className="text-xs text-neutral-500">{field.description}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
