import { useChild } from "../App";
import { useStore } from "../lib/store";
import { className } from "../lib/queries";
import { Segmented } from "./ui";

/** Lets a parent with several children pick which one they are looking at. */
export default function ChildSwitcher() {
  const { db, session } = useStore();
  const { childId, setChildId, children } = useChild();
  if (session?.role !== "parent" || children.length < 2) return null;
  return (
    <Segmented
      value={childId}
      onChange={setChildId}
      items={children.map((id) => {
        const s = db.students.find((x) => x.id === id)!;
        return { id, label: `${s.name.split(" ")[0]} · ${className(db, s.classId)}` };
      })}
    />
  );
}
