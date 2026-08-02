import { createFileRoute } from "@tanstack/react-router";
import { StatistiquesView } from "@/views/screens/Statistiques";

export const Route = createFileRoute("/_authenticated/app/stats")({
  component: () => <StatistiquesView />,
});
