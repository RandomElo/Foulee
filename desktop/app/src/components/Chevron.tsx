import { ChevronDown } from "lucide-react";

/** La flèche d'un bloc dépliable : assez grande pour être vue et visée, retournée quand le bloc est ouvert (voir index.css). */
export function Chevron() {
  return <ChevronDown aria-hidden size={24} strokeWidth={3} className="chevron shrink-0" />;
}
