// SPDX-License-Identifier: AGPL-3.0-only
import { ContactLink, LegalLayout, LegalList, LegalSection } from './legal-layout';

export function PrivacyPage() {
	return (
		<LegalLayout title="Privacy Policy">
			<p>
				SkillPouch syncs your AI assistant skills, agents, MCP servers and instructions
				between your computers. This policy explains what we store about you, why, and what
				we cannot see.
			</p>

			<LegalSection title="What we cannot see">
				<p>
					Everything you sync is encrypted on your device or in your browser before it
					reaches us. That includes file contents and the names of your skills, agents and
					other items. We never receive your master password or your Recovery Key, so we
					cannot decrypt your data, and neither can anyone who gets access to our servers.
				</p>
			</LegalSection>

			<LegalSection title="What we store">
				<LegalList
					items={[
						'Account: your name, email address and profile picture from GitHub or Google, and which of them you sign in with.',
						'Sign-in sessions: the IP address and browser of each session, so you can see and end them.',
						'Devices: the name and operating system you give each connected computer, and a keyed hash of its IP address.',
						'Encrypted data: the encrypted files themselves, their sizes and timestamps.',
						'Security events: sign-ins, new devices, shares and similar account changes, with a keyed hash of the IP address.',
						'Billing: your plan and subscription status. Payment details are handled by our payment provider; we never see card numbers.',
					]}
				/>
			</LegalSection>

			<LegalSection title="Why we use it">
				<p>
					Only to run the service: signing you in, syncing your devices, showing you your
					account's security activity, preventing abuse, and billing. We do not sell your
					data, show ads, or use your data to train AI models.
				</p>
			</LegalSection>

			<LegalSection title="Cookies and tracking">
				<p>
					We use only the cookies needed to keep you signed in. There are no analytics,
					advertising or third-party tracking scripts.
				</p>
			</LegalSection>

			<LegalSection title="Services we rely on">
				<LegalList
					items={[
						'GitHub and Google, when you sign in with them.',
						'Polar, our merchant of record, for payments and invoices.',
						'Cloudflare, which carries traffic to our servers.',
					]}
				/>
				<p>Each of them processes data under its own privacy policy.</p>
			</LegalSection>

			<LegalSection title="How long we keep it">
				<p>
					Your data stays while your account exists. Sync history and older versions
					expire automatically according to your plan. When you delete your account,
					everything is deleted after a 7-day grace period in which you can change your
					mind.
				</p>
			</LegalSection>

			<LegalSection title="Your rights">
				<p>
					You can see your sessions, devices and security activity in your account
					settings, and delete your account at any time. To request a copy of the personal
					data we hold about you, or a correction, write to <ContactLink />.
				</p>
			</LegalSection>

			<LegalSection title="Children">
				<p>SkillPouch is not intended for anyone under 16.</p>
			</LegalSection>

			<LegalSection title="Changes">
				<p>
					If this policy changes, we update this page and the date above. For significant
					changes we also notify you by email or in the app.
				</p>
			</LegalSection>

			<LegalSection title="Contact">
				<p>
					Questions about privacy: <ContactLink />.
				</p>
			</LegalSection>
		</LegalLayout>
	);
}
