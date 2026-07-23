import { createFileRoute } from "@tanstack/react-router";
import { TicketsView } from "@/kingston/views/Tickets";

export const Route = createFileRoute("/_authenticated/app/tickets")({
  component: () => <TicketsView />,
});
