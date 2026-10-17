import type { Metadata } from "next";
import { FieldGuideButton } from "../../components/help/HelpProvider";
import { ArenaAtlas } from "../../components/site/ArenaAtlas";
import { SiteHeader } from "../../components/site/SiteHeader";

export const metadata: Metadata = { title: "Arena Lab" };

export default function PreviewPage() {
  return (
    <main className="site-page">
      <SiteHeader label="Arena Lab" rail>
        <FieldGuideButton tab="terrain" />
      </SiteHeader>
      <ArenaAtlas />
    </main>
  );
}
