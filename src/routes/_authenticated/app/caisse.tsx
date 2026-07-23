import { createFileRoute } from "@tanstack/react-router";
import { CaisseView } from "@/kingston/views/Caisse";

export const Route = createFileRoute("/_authenticated/app/caisse")({
  component: () => <CaisseView />,
});
