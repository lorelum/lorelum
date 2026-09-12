import { createFileRoute } from '@tanstack/react-router';
import { LandingScreen, landingHead } from '@/features/landing';

export const Route = createFileRoute('/$lang/')({
  head: ({ params }) => landingHead(params.lang),
  component: Home,
});

function Home() {
  const { lang } = Route.useParams();
  return <LandingScreen lang={lang} />;
}
