// SPDX-License-Identifier: AGPL-3.0-only
/** The public home page at `/`. Signed-in visitors see "Open SkillPouch" in the nav. */
import '@fontsource-variable/bricolage-grotesque/wght.css';
import './landing.css';
import { AssistantsStrip } from './assistants-strip';
import { Faq } from './faq';
import { FeatureBento } from './feature-bento';
import { Hero } from './hero';
import { ClosingCta, LandingFooter } from './landing-footer';
import { LandingNav } from './landing-nav';
import { Pricing } from './pricing';
import { ProductShot } from './product-shot';
import { SyncFlow } from './sync-flow';

export function LandingPage() {
	return (
		<div className="landing min-h-dvh bg-bg text-fg">
			<LandingNav />
			<main>
				<Hero />
				<AssistantsStrip />
				<ProductShot />
				<SyncFlow />
				<FeatureBento />
				<Pricing />
				<Faq />
				<ClosingCta />
			</main>
			<LandingFooter />
		</div>
	);
}
