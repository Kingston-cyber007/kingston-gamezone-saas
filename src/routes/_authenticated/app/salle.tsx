import { createFileRoute } from "@tanstack/react-router";
import { SalleView } from "@/views/screens/Salle";

export const Route = createFileRoute("/_authenticated/app/salle")({
  component: () => <SalleView />,
});
