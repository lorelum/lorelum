import { LandingPage } from "@/components/landing/landing-page";
import { LandingShell } from "@/components/landing/landing-shell";

/**
 * Landing 的页面组合入口。旧 components/landing 仍是临时实现，待首页
 * 重建时由 feature 内的新 sections、effects 和 motion 逐步替换。
 */
export function LandingScreen({ lang }: { lang: string }) {
  return (
    <LandingShell lang={lang}>
      <LandingPage lang={lang} />
    </LandingShell>
  );
}
