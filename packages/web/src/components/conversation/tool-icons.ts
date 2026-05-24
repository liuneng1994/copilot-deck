import { FileEdit, FileSearch, FileText, Globe, Terminal, Wrench } from "lucide-react";

export function iconForKind(kind: string) {
  switch (kind) {
    case "edit":
      return FileEdit;
    case "read":
      return FileText;
    case "search":
      return FileSearch;
    case "execute":
      return Terminal;
    case "fetch":
      return Globe;
    default:
      return Wrench;
  }
}
