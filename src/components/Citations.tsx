import type { CheckResult } from "@/lib/types";

/** The evidence behind a failed check: the invoice's value next to the ERP value it was checked against. */
export function Citations({ c }: { c: CheckResult }) {
  if (!c.citations.length) return null;
  return (
    <div className="mt-2 overflow-hidden rounded-md border border-line">
      <table className="w-full text-xs">
        <tbody>
          {c.citations.map((ci, i) => (
            <tr key={i} className="border-t border-line first:border-t-0">
              <td className="bg-gray-50 px-2 py-1.5 text-muted">{ci.doc}<div className="text-ink-2">{ci.field}</div></td>
              <td className="px-2 py-1.5 font-medium text-bad tabular-nums">{ci.value}</td>
              {ci.against ? (
                <>
                  <td className="px-1 text-muted">vs</td>
                  <td className="bg-gray-50 px-2 py-1.5 text-muted">{ci.against.doc}<div className="text-ink-2">{ci.against.field}</div></td>
                  <td className="px-2 py-1.5 font-medium text-ink tabular-nums">{ci.against.value}</td>
                </>
              ) : <td colSpan={3} />}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
