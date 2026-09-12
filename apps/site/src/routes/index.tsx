import { createFileRoute } from '@tanstack/react-router';
import { LandingScreen, landingHead } from '@/features/landing';
import { i18n } from '@/shared/i18n/config';

export const Route = createFileRoute('/')({
  head: () => landingHead(i18n.defaultLanguage),
  component: Home,
});

function Home() {
  return <LandingScreen lang={i18n.defaultLanguage} />;
}
