interface PromptEditorProps {
  value: string;
  onChange: (value: string) => void;
  variables?: string[];
}

export default function PromptEditor({
  value,
  onChange,
  variables = [],
}: PromptEditorProps) {
  const safeValue = typeof value === "string" ? value : "";
  const safeVariables = Array.isArray(variables) ? variables : [];
  const detectedVariables = Array.from(safeValue.matchAll(/{{\s*([\w-]+)\s*}}/g)).map(
    (match) => match[1],
  );
  const allVariables = Array.from(new Set([...safeVariables, ...detectedVariables]));
  const safeAllVariables = Array.isArray(allVariables) ? allVariables : [];

  return (
    <div className="space-y-3">
      {safeAllVariables.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {safeAllVariables.map((variable) => (
            <span
              key={variable}
              className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700"
            >
              {"{{"}
              {variable}
              {"}}"}
            </span>
          ))}
        </div>
      )}

      <textarea
        value={safeValue}
        onChange={(event) => onChange(event.target.value)}
        rows={10}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm leading-6 text-gray-900 shadow-sm outline-none transition-colors placeholder:text-gray-400 focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
      />
    </div>
  );
}
