import { createFileRoute } from "@tanstack/react-router";
import { StatistiquesView } from "@/kingston/views/Statistiques";

export const Route = createFileRoute("/_authenticated/app/stats")({
  component: () => <StatistiquesView />,
});
