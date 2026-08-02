import { createFileRoute } from "@tanstack/react-router";
import { CaisseView } from "@/views/screens/Caisse";

export const Route = createFileRoute("/_authenticated/app/caisse")({
  component: () => <CaisseView />,
});
