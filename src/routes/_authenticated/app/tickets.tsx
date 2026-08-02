import { createFileRoute } from "@tanstack/react-router";
import { TicketsView } from "@/views/screens/Tickets";

export const Route = createFileRoute("/_authenticated/app/tickets")({
  component: () => <TicketsView />,
});
