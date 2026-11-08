import { initials, personaColour } from "@/lib/narrate";
import { cx } from "@/components/ui";

/** The employee's face: a monogram in a colour that's stable for its name. */
export function Avatar({ name, size = 32, working = false }: { name: string; size?: number; working?: boolean }) {
  const c = personaColour(name);
  return (
    <span className="relative inline-grid shrink-0 place-items-center rounded-full font-semibold text-white select-none"
      style={{ width: size, height: size, background: c.bg, fontSize: Math.round(size * 0.38) }} aria-hidden>
      {initials(name)}
      {working && <span className={cx("absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-surface bg-ok", "presence-pulse")} />}
    </span>
  );
}
