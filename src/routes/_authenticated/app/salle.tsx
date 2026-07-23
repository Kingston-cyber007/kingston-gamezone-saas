import { createFileRoute } from "@tanstack/react-router";
import { SalleView } from "@/kingston/views/Salle";

export const Route = createFileRoute("/_authenticated/app/salle")({
  component: () => <SalleView />,
});
