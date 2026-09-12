import { createRootRoute, Outlet } from '@tanstack/react-router';
import { RootDocument } from '@/app/root-document';
import { getRootHead } from '@/app/root-head';

export const Route = createRootRoute({
  head: getRootHead,
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}
