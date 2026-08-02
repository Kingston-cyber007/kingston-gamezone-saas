import { createFileRoute } from "@tanstack/react-router";
import { ReglagesView } from "@/views/screens/Reglages";

export const Route = createFileRoute("/_authenticated/app/reglages")({
  component: () => <ReglagesView />,
});
