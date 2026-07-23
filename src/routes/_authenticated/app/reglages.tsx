import { createFileRoute } from "@tanstack/react-router";
import { ReglagesView } from "@/kingston/views/Reglages";

export const Route = createFileRoute("/_authenticated/app/reglages")({
  component: () => <ReglagesView />,
});
