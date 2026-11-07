// A template (unlike a layout) remounts on every navigation, so each step's page arrives
// with the same small settle while the checklist rail beside it stays put.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-enter">{children}</div>;
}
