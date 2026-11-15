import type { Workspace } from "./types";
import { rosterCsv } from "./export";
export function exportRoster(data: Workspace, start: string) {
  const blob = new Blob([rosterCsv(data, start)], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = `shiftflow-draft-${start}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
